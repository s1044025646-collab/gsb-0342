/**
 * SQLite 存储层（node:sqlite，无需原生依赖）。
 * 冻结变量顺序、ON/DC、算法版本、合并关系、覆盖选择与表达式。
 * 修改集合会创建新版本；结果先完成真值核验，再以 verified 状态整体提交。
 */
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ALGO_VERSION,
  MAX_VARS,
  Prime,
  QmError,
  buildExpression,
  quineMcCluskey,
  verifyExpression,
} from "./qm";

export interface FunctionSpec {
  variables: string[];
  on: number[];
  dc: number[];
}

export function validateSpec(spec: unknown): FunctionSpec {
  if (typeof spec !== "object" || spec === null) {
    throw new QmError("BAD_REQUEST", "请求体必须是对象");
  }
  const s = spec as Record<string, unknown>;
  const variables = s.variables;
  if (!Array.isArray(variables) || variables.length === 0) {
    throw new QmError("INVALID_VAR_COUNT", "variables 必须是非空数组");
  }
  if (variables.length > MAX_VARS) {
    throw new QmError(
      "INVALID_VAR_COUNT",
      "变量数必须在 1.." + MAX_VARS + " 之间，收到 " + variables.length
    );
  }
  for (const v of variables) {
    if (typeof v !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(v)) {
      throw new QmError(
        "INVALID_VAR_NAME",
        "变量名必须是以字母开头的标识符：" + JSON.stringify(v)
      );
    }
  }
  if (new Set(variables).size !== variables.length) {
    throw new QmError("DUP_VARIABLE", "变量名不能重复");
  }
  const size = 1 << variables.length;
  const parseSet = (raw: unknown, name: string): number[] => {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      throw new QmError("BAD_REQUEST", name + " 必须是编号数组");
    }
    const out: number[] = [];
    for (const x of raw) {
      if (!Number.isInteger(x)) {
        throw new QmError("BAD_REQUEST", name + " 中存在非整数编号：" + x);
      }
      const n = x as number;
      if (n < 0 || n >= size) {
        throw new QmError(
          "INDEX_OUT_OF_RANGE",
          name + " 中编号 " + n + " 越界（合法范围 0.." + (size - 1) + "）"
        );
      }
      out.push(n);
    }
    return [...new Set(out)].sort((a, b) => a - b); // 集合内重复编号明确去重
  };
  const on = parseSet(s.on, "on");
  const dc = parseSet(s.dc, "dc");
  const dcSet = new Set(dc);
  const overlap = on.filter((x) => dcSet.has(x));
  if (overlap.length > 0) {
    throw new QmError(
      "ON_DC_OVERLAP",
      "ON 与 DC 存在重叠编号：" + overlap.join(", ")
    );
  }
  return { variables: variables as string[], on, dc };
}

export class Store {
  db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS functions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        variables TEXT NOT NULL,
        on_set TEXT NOT NULL,
        dc_set TEXT NOT NULL,
        algo_version TEXT NOT NULL,
        status TEXT NOT NULL,
        expression TEXT,
        verify_ok INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS terms (
        function_id INTEGER NOT NULL,
        term_id INTEGER NOT NULL,
        round INTEGER NOT NULL,
        mask INTEGER NOT NULL,
        bits INTEGER NOT NULL,
        merged INTEGER NOT NULL,
        sources TEXT NOT NULL,
        source_pairs TEXT NOT NULL,
        covers TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS primes (
        function_id INTEGER NOT NULL,
        mask INTEGER NOT NULL,
        bits INTEGER NOT NULL,
        covers_on TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cover_choices (
        function_id INTEGER NOT NULL,
        step INTEGER NOT NULL,
        mask INTEGER NOT NULL,
        bits INTEGER NOT NULL,
        reason TEXT NOT NULL,
        newly_covered TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /** 创建函数（或基于 groupId 创建新版本），同步完成计算与核验 */
  createFunction(spec: FunctionSpec, groupId?: number): number {
    const result = quineMcCluskey(spec.variables.length, spec.on, spec.dc);
    const expression = buildExpression(
      result.selected,
      spec.variables,
      spec.on.length > 0
    );
    const verify = verifyExpression(
      result.selected,
      spec.variables.length,
      spec.on,
      spec.dc
    );
    const ok = verify.ok && result.uncoveredOn.length === 0;
    const status = ok ? "verified" : "failed";

    let gid = groupId;
    if (gid === undefined) {
      const row = this.db
        .prepare("SELECT COALESCE(MAX(group_id), 0) + 1 AS g FROM functions")
        .get() as { g: number };
      gid = row.g;
    }
    const vrow = this.db
      .prepare(
        "SELECT COALESCE(MAX(version), 0) + 1 AS v FROM functions WHERE group_id = ?"
      )
      .get(gid) as { v: number };

    this.db.exec("BEGIN");
    try {
      const ins = this.db
        .prepare(
          `INSERT INTO functions
           (group_id, version, variables, on_set, dc_set, algo_version, status, expression, verify_ok, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          gid,
          vrow.v,
          JSON.stringify(spec.variables),
          JSON.stringify(spec.on),
          JSON.stringify(spec.dc),
          ALGO_VERSION,
          status,
          ok ? expression : null,
          ok ? 1 : 0,
          new Date().toISOString()
        );
      const fid = Number(ins.lastInsertRowid);
      if (ok) {
        const tIns = this.db.prepare(
          `INSERT INTO terms (function_id, term_id, round, mask, bits, merged, sources, source_pairs, covers)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const r of result.rounds) {
          for (const t of r.terms) {
            tIns.run(
              fid,
              t.id,
              t.round,
              t.mask,
              t.bits,
              t.merged ? 1 : 0,
              JSON.stringify(t.sources),
              JSON.stringify(t.sourcePairs),
              JSON.stringify(t.covers)
            );
          }
        }
        const pIns = this.db.prepare(
          "INSERT INTO primes (function_id, mask, bits, covers_on) VALUES (?, ?, ?, ?)"
        );
        for (const p of result.primes) {
          pIns.run(fid, p.mask, p.bits, JSON.stringify(p.coversOn));
        }
        const cIns = this.db.prepare(
          `INSERT INTO cover_choices (function_id, step, mask, bits, reason, newly_covered)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        for (const c of result.coverChoices) {
          cIns.run(
            fid,
            c.step,
            c.mask,
            c.bits,
            c.reason,
            JSON.stringify(c.newlyCovered)
          );
        }
      }
      this.db.exec("COMMIT");
      return fid;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  getFunction(id: number) {
    const row = this.db
      .prepare("SELECT * FROM functions WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) throw new QmError("NOT_FOUND", "函数不存在：" + id);
    return {
      id: row.id as number,
      groupId: row.group_id as number,
      version: row.version as number,
      variables: JSON.parse(row.variables as string) as string[],
      on: JSON.parse(row.on_set as string) as number[],
      dc: JSON.parse(row.dc_set as string) as number[],
      algoVersion: row.algo_version as string,
      status: row.status as string,
      expression: row.expression as string | null,
      verifyOk: (row.verify_ok as number) === 1,
      createdAt: row.created_at as string,
    };
  }

  listFunctions() {
    const rows = this.db
      .prepare(
        "SELECT id, group_id, version, variables, status, expression, created_at FROM functions ORDER BY id"
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as number,
      groupId: r.group_id as number,
      version: r.version as number,
      variables: JSON.parse(r.variables as string),
      status: r.status as string,
      expression: r.expression as string | null,
      createdAt: r.created_at as string,
    }));
  }

  private requireVerified(id: number) {
    const f = this.getFunction(id);
    if (f.status !== "verified") {
      throw new QmError(
        "NOT_VERIFIED",
        "函数 " + id + " 未通过真值核验，覆盖结果不可用"
      );
    }
    return f;
  }

  getRounds(id: number) {
    this.requireVerified(id);
    const rows = this.db
      .prepare(
        "SELECT * FROM terms WHERE function_id = ? ORDER BY round, term_id"
      )
      .all(id) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      termId: r.term_id as number,
      round: r.round as number,
      mask: r.mask as number,
      bits: r.bits as number,
      merged: (r.merged as number) === 1,
      sources: JSON.parse(r.sources as string) as number[],
      sourcePairs: JSON.parse(r.source_pairs as string) as Array<
        [number, number]
      >,
      covers: JSON.parse(r.covers as string) as number[],
    }));
  }

  getPrimes(id: number): Prime[] {
    this.requireVerified(id);
    const rows = this.db
      .prepare("SELECT mask, bits, covers_on FROM primes WHERE function_id = ?")
      .all(id) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      mask: r.mask as number,
      bits: r.bits as number,
      coversOn: JSON.parse(r.covers_on as string) as number[],
    }));
  }

  getCoverChoices(id: number) {
    this.requireVerified(id);
    const rows = this.db
      .prepare("SELECT * FROM cover_choices WHERE function_id = ? ORDER BY step")
      .all(id) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      step: r.step as number,
      mask: r.mask as number,
      bits: r.bits as number,
      reason: r.reason as string,
      newlyCovered: JSON.parse(r.newly_covered as string) as number[],
    }));
  }

  /** 求指定输入编号的表达式值（选中项已冻结，重启后仍可求值） */
  evalAt(id: number, idx: number): boolean {
    const f = this.requireVerified(id);
    const size = 1 << f.variables.length;
    if (!Number.isInteger(idx) || idx < 0 || idx >= size) {
      throw new QmError(
        "INDEX_OUT_OF_RANGE",
        "输入编号越界（合法范围 0.." + (size - 1) + "）"
      );
    }
    const choices = this.getCoverChoices(id);
    return choices.some((c) => (idx & c.mask) === c.bits);
  }
}
