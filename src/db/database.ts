import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ALGORITHM_VERSION } from '../common/limits.js';
import { SCHEMA_SQL } from './schema.js';
import { notFound } from '../common/errors.js';
import type { QmcResult, ValidatedSpec } from '../core/types.js';

export interface StoredVersion {
  versionId: number;
  functionId: number;
  versionNo: number;
  variables: string[];
  on: number[];
  dc: number[];
  algorithmVersion: string;
  status: 'computed' | 'failed';
  expression: string | null;
  constant: string | null;
  verificationPassed: boolean;
  result: QmcResult | null;
  createdAt: string;
}

export interface StoredFunction {
  functionId: number;
  name: string;
  createdAt: string;
  latestVersionNo: number;
}

/**
 * SQLite 存储层。
 * 每个函数的变量顺序/ON/DC 被冻结在一个版本中；
 * 修改集合会创建新版本，旧版本永久保留并可在重启后查询、求值。
 */
export class QmcDatabase {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    const absolute = resolve(dbPath);
    mkdirSync(dirname(absolute), { recursive: true });
    this.db = new DatabaseSync(absolute);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  createFunction(name: string): StoredFunction {
    const now = new Date().toISOString();
    const info = this.db
      .prepare('INSERT INTO functions (name, created_at) VALUES (?, ?)')
      .run(name, now);
    const functionId = Number(info.lastInsertRowid);
    return { functionId, name, createdAt: now, latestVersionNo: 0 };
  }

  getFunction(functionId: number): StoredFunction {
    const row = this.db
      .prepare('SELECT id, name, created_at FROM functions WHERE id = ?')
      .get(functionId) as
      | { id: number; name: string; created_at: string }
      | undefined;
    if (!row) {
      throw notFound('FUNCTION_NOT_FOUND', `函数 id=${functionId} 不存在`);
    }
    const latest = this.db
      .prepare('SELECT COALESCE(MAX(version_no), 0) AS v FROM versions WHERE function_id = ?')
      .get(functionId) as { v: number };
    return {
      functionId: row.id,
      name: row.name,
      createdAt: row.created_at,
      latestVersionNo: latest.v,
    };
  }

  listFunctions(): StoredFunction[] {
    const rows = this.db
      .prepare('SELECT id FROM functions ORDER BY id')
      .all() as Array<{ id: number }>;
    return rows.map((r) => this.getFunction(r.id));
  }

  /**
   * 在单个事务里完成「计算并发布」：
   * result 仅在真值核验通过后写入 status='computed'；
   * 核验失败写入 status='failed' 且不发布表达式，绝无半份覆盖。
   */
  addComputedVersion(
    functionId: number,
    spec: ValidatedSpec,
    result: QmcResult | null,
    failure: { code: string; message: string } | null,
  ): StoredVersion {
    this.getFunction(functionId); // 不存在则 404
    const nextVersionNo = this.getFunction(functionId).latestVersionNo + 1;
    const now = new Date().toISOString();

    const insert = this.db.prepare(`
      INSERT INTO versions (
        function_id, version_no, variables_json, on_json, dc_json,
        algorithm_version, status, expression, constant, verification_passed,
        result_json, error_code, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.exec.bind(this.db, 'BEGIN');
    tx();
    try {
      const info = insert
        .run(
          functionId,
          nextVersionNo,
          JSON.stringify(spec.variables),
          JSON.stringify(spec.on),
          JSON.stringify(spec.dc),
          ALGORITHM_VERSION,
          result ? 'computed' : 'failed',
          result ? result.expression : null,
          result ? result.constant : null,
          result && result.verification.passed ? 1 : 0,
          result ? JSON.stringify(result) : null,
          failure ? failure.code : null,
          failure ? failure.message : null,
          now,
        );
      this.db.exec('COMMIT');
      const versionId = Number(info.lastInsertRowid);
      return this.getVersion(functionId, versionId);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  getVersion(functionId: number, versionId: number): StoredVersion {
    const row = this.db
      .prepare('SELECT * FROM versions WHERE id = ? AND function_id = ?')
      .get(versionId, functionId) as VersionRow | undefined;
    if (!row) {
      throw notFound('VERSION_NOT_FOUND', `版本 id=${versionId}（函数 ${functionId}）不存在`);
    }
    return mapRow(row);
  }

  getVersionByNo(functionId: number, versionNo: number): StoredVersion {
    const row = this.db
      .prepare('SELECT * FROM versions WHERE function_id = ? AND version_no = ?')
      .get(functionId, versionNo) as VersionRow | undefined;
    if (!row) {
      throw notFound('VERSION_NOT_FOUND', `函数 ${functionId} 不存在版本号 ${versionNo}`);
    }
    return mapRow(row);
  }

  listVersions(functionId: number): Array<{
    versionId: number;
    versionNo: number;
    status: string;
    expression: string | null;
    createdAt: string;
  }> {
    this.getFunction(functionId);
    const rows = this.db
      .prepare(
        `SELECT id, version_no, status, expression, created_at
         FROM versions WHERE function_id = ? ORDER BY version_no`,
      )
      .all(functionId) as Array<{
        id: number;
        version_no: number;
        status: string;
        expression: string | null;
        created_at: string;
      }>;
    return rows.map((r) => ({
      versionId: r.id,
      versionNo: r.version_no,
      status: r.status,
      expression: r.expression,
      createdAt: r.created_at,
    }));
  }

  /** 取某函数最新的 computed 版本，供重启后继续求值。 */
  getLatestComputed(functionId: number): StoredVersion {
    const fn = this.getFunction(functionId);
    if (fn.latestVersionNo === 0) {
      throw notFound('NOT_COMPUTED', `函数 id=${functionId} 尚无任何已计算版本`);
    }
    const version = this.getVersionByNo(functionId, fn.latestVersionNo);
    if (version.status !== 'computed' || !version.result) {
      throw notFound('NOT_COMPUTED', `函数 id=${functionId} 的最新版本未成功计算`);
    }
    return version;
  }
}

interface VersionRow {
  id: number;
  function_id: number;
  version_no: number;
  variables_json: string;
  on_json: string;
  dc_json: string;
  algorithm_version: string;
  status: 'computed' | 'failed';
  expression: string | null;
  constant: string | null;
  verification_passed: number;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

function mapRow(row: VersionRow): StoredVersion {
  return {
    versionId: row.id,
    functionId: row.function_id,
    versionNo: row.version_no,
    variables: JSON.parse(row.variables_json) as string[],
    on: JSON.parse(row.on_json) as number[],
    dc: JSON.parse(row.dc_json) as number[],
    algorithmVersion: row.algorithm_version,
    status: row.status,
    expression: row.expression,
    constant: row.constant,
    verificationPassed: row.verification_passed === 1,
    result: row.result_json ? (JSON.parse(row.result_json) as QmcResult) : null,
    createdAt: row.created_at,
  };
}
