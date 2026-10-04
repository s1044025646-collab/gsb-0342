import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  quineMcCluskey,
  patternOf,
  coversIndex,
  verifyExpression,
  buildExpression,
} from "../src/qm";
import { Store, validateSpec } from "../src/store";
import { DEMO_CASES } from "../src/demo";

/** 暴力枚举全部 0/1/- 模式，返回“合法、最大、覆盖至少一个 ON”的模式集合 */
function bruteForcePrimes(
  nvars: number,
  on: number[],
  dc: number[]
): Set<string> {
  const size = 1 << nvars;
  const onSet = new Set(on);
  const dcSet = new Set(dc);
  const legal = (mask: number, bits: number): boolean => {
    for (let idx = 0; idx < size; idx++) {
      if (coversIndex(mask, bits, idx) && !onSet.has(idx) && !dcSet.has(idx)) {
        return false;
      }
    }
    return true;
  };
  const coversSomeOn = (mask: number, bits: number): boolean => {
    for (const m of on) if (coversIndex(mask, bits, m)) return true;
    return false;
  };
  const result = new Set<string>();
  const total = 3 ** nvars;
  for (let code = 0; code < total; code++) {
    let x = code;
    let mask = 0;
    let bits = 0;
    for (let i = 0; i < nvars; i++) {
      const d = x % 3;
      x = Math.floor(x / 3);
      const bit = 1 << (nvars - 1 - i);
      if (d === 0) mask |= bit;
      else if (d === 1) {
        mask |= bit;
        bits |= bit;
      }
    }
    if (!coversSomeOn(mask, bits)) continue;
    if (!legal(mask, bits)) continue;
    // 最大性：任意固定位改为无关位后不再合法
    let maximal = true;
    for (let i = 0; i < nvars && maximal; i++) {
      const bit = 1 << (nvars - 1 - i);
      if (mask & bit) {
        if (legal(mask & ~bit, bits & ~bit)) maximal = false;
      }
    }
    if (maximal) result.add(patternOf(mask, bits, nvars));
  }
  return result;
}

function checkAgainstBruteForce(nvars: number, on: number[], dc: number[]) {
  const r = quineMcCluskey(nvars, on, dc);
  const got = new Set(r.primes.map((p) => patternOf(p.mask, p.bits, nvars)));
  const want = bruteForcePrimes(nvars, on, dc);
  assert.deepEqual(got, want, `n=${nvars} on=[${on}] dc=[${dc}]`);
  return r;
}

test("演示用例：表达式真值核验全部通过", () => {
  for (const c of DEMO_CASES) {
    const n = c.spec.variables.length;
    const r = quineMcCluskey(n, c.spec.on, c.spec.dc);
    assert.equal(r.uncoveredOn.length, 0, c.name);
    const v = verifyExpression(r.selected, n, c.spec.on, c.spec.dc);
    assert.ok(v.ok, c.name + " 失配 " + JSON.stringify(v.mismatches));
  }
});

test("n<=4 随机用例与暴力枚举的素蕴含项集合一致", () => {
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let n = 1; n <= 4; n++) {
    const size = 1 << n;
    for (let iter = 0; iter < 40; iter++) {
      const on: number[] = [];
      const dc: number[] = [];
      for (let i = 0; i < size; i++) {
        const r = rand();
        if (r < 0.4) on.push(i);
        else if (r < 0.6) dc.push(i);
      }
      const r = checkAgainstBruteForce(n, on, dc);
      // 同时核验表达式真值
      const v = verifyExpression(r.selected, n, on, dc);
      assert.ok(v.ok, `n=${n} on=[${on}] dc=[${dc}]`);
      assert.equal(r.uncoveredOn.length, 0);
    }
  }
});

test("集合重排不影响结果", () => {
  const a = quineMcCluskey(4, [4, 5, 6, 8, 9, 10, 13], [0, 7, 15]);
  const b = quineMcCluskey(4, [13, 10, 9, 8, 6, 5, 4], [15, 7, 0]);
  const pa = a.primes.map((p) => patternOf(p.mask, p.bits, 4));
  const pb = b.primes.map((p) => patternOf(p.mask, p.bits, 4));
  assert.deepEqual(pa, pb);
  const ea = buildExpression(a.selected, ["A", "B", "C", "D"], true);
  const eb = buildExpression(b.selected, ["A", "B", "C", "D"], true);
  assert.equal(ea, eb);
});

test("重复合并来源被完整记录且产物去重", () => {
  // 2 变量全开：4 个最小项两两合并出 4 个中间项，再合成一个常真项
  const r = quineMcCluskey(2, [0, 1, 2, 3], []);
  assert.equal(r.rounds.length, 3);
  const round2 = r.rounds[2].terms;
  assert.equal(round2.length, 1);
  assert.equal(patternOf(round2[0].mask, round2[0].bits, 2), "--");
  // 常真项有两组不同来源对
  assert.ok(round2[0].sourcePairs.length >= 2);
  assert.equal(r.primes.length, 1);
  assert.equal(patternOf(r.primes[0].mask, r.primes[0].bits, 2), "--");
});

test("空 ON 规范结果为假，即使 DC 非空", () => {
  const r = quineMcCluskey(3, [], [1, 3, 5]);
  assert.equal(r.primes.length, 0);
  assert.equal(r.selected.length, 0);
  const expr = buildExpression(r.selected, ["A", "B", "C"], false);
  assert.equal(expr, "0");
  const v = verifyExpression(r.selected, 3, [], [1, 3, 5]);
  assert.ok(v.ok);
});

test("常真：全部位置为 ON 时得到全无关位项", () => {
  const on = [0, 1, 2, 3, 4, 5, 6, 7];
  const r = quineMcCluskey(3, on, []);
  assert.equal(r.primes.length, 1);
  assert.equal(patternOf(r.primes[0].mask, r.primes[0].bits, 3), "---");
  const expr = buildExpression(r.selected, ["A", "B", "C"], true);
  assert.equal(expr, "1");
});

test("DC 帮助合并：只覆盖 DC 的中间项不进入素蕴含项表", () => {
  const r = quineMcCluskey(3, [0, 2], [4, 6]);
  const patterns = r.primes.map((p) => patternOf(p.mask, p.bits, 3)).sort();
  assert.deepEqual(patterns, ["--0"]);
  // 每个素蕴含项都至少覆盖一个 ON
  for (const p of r.primes) assert.ok(p.coversOn.length > 0);
});

test("参数校验错误码", () => {
  const expectCode = (fn: () => void, code: string) =>
    assert.throws(fn, (e: unknown) => (e as { code: string }).code === code);
  expectCode(() => validateSpec({ variables: [], on: [], dc: [] }), "INVALID_VAR_COUNT");
  expectCode(
    () => validateSpec({ variables: ["A", "B", "C", "D", "E", "F", "G"], on: [] }),
    "INVALID_VAR_COUNT"
  );
  expectCode(() => validateSpec({ variables: ["A", "A"], on: [] }), "DUP_VARIABLE");
  expectCode(() => validateSpec({ variables: ["A", "B"], on: [4] }), "INDEX_OUT_OF_RANGE");
  expectCode(
    () => validateSpec({ variables: ["A", "B"], on: [1], dc: [1] }),
    "ON_DC_OVERLAP"
  );
  // 集合内重复编号去重
  const s = validateSpec({ variables: ["A", "B"], on: [1, 1, 2], dc: [] });
  assert.deepEqual(s.on, [1, 2]);
});

test("SQLite 持久化：重启后仍可查询与求值，修改集合产生新版本", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qm-test-"));
  const dbPath = path.join(dir, "test.sqlite");
  const spec = {
    variables: ["A", "B", "C", "D"],
    on: [4, 5, 6, 8, 9, 10, 13],
    dc: [0, 7, 15],
  };
  let fid: number;
  {
    const store = new Store(dbPath);
    fid = store.createFunction(validateSpec(spec));
    const f = store.getFunction(fid);
    assert.equal(f.status, "verified");
    assert.ok(f.expression);
    store.close();
  }
  // 模拟重启：重新打开同一数据库文件
  {
    const store = new Store(dbPath);
    const f = store.getFunction(fid);
    assert.equal(f.status, "verified");
    const primes = store.getPrimes(fid);
    assert.ok(primes.length > 0);
    const rounds = store.getRounds(fid);
    assert.ok(rounds.length > 0);
    // 求值与真值表一致
    const n = 4;
    for (let idx = 0; idx < 1 << n; idx++) {
      const v = store.evalAt(fid, idx);
      if (spec.on.includes(idx)) assert.ok(v, "ON " + idx);
      else if (!spec.dc.includes(idx)) assert.ok(!v, "OFF " + idx);
    }
    // 修改集合 → 新版本
    const nid = store.createFunction(
      validateSpec({ ...spec, on: [4, 5, 6] }),
      f.groupId
    );
    const nf = store.getFunction(nid);
    assert.equal(nf.groupId, f.groupId);
    assert.equal(nf.version, f.version + 1);
    store.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
