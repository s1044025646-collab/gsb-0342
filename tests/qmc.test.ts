import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { computeQmc, evaluateResult } from '../src/core/service.js';
import { crossCheckPrimeImplicants } from '../src/core/verify.js';
import { expandPattern, mergePosition } from '../src/core/pattern.js';
import { QmcDatabase } from '../src/db/database.js';
import { QmcError } from '../src/common/errors.js';

describe('Quine–McCluskey 核心', () => {
  test('DC 帮助扩大蕴含项，且 DC-only 中间项不进可用表', () => {
    const { result } = computeQmc({ variables: ['A', 'B', 'C'], on: [4], dc: [5] });
    // 100 + 101 -> 10- = A·B\'
    assert.ok(result.usablePrimeImplicants.some((p) => p.pattern === '10-'));
    assert.equal(result.expression, "A·B'");
    // 合并来源保留
    assert.ok(result.mergeSteps.some((s) => s.left === '100' && s.right === '101' && s.result === '10-'));
    // DC-only 项不会出现在可用表，但出现在全部素蕴含项里（本例无 DC-only 素项；验证机制本身）
    for (const p of result.usablePrimeImplicants) assert.ok(p.coversOn.length > 0);
  });

  test('DC-only 素蕴含项被排除在覆盖表之外', () => {
    // m0 为 ON，m3 为 DC 且与任何 ON 不相邻 -> m3 展开的项只覆盖 DC
    const { result } = computeQmc({ variables: ['A', 'B'], on: [0], dc: [3] });
    const dcOnly = result.allPrimeImplicants.filter((p) => p.coversOn.length === 0);
    assert.ok(dcOnly.some((p) => p.pattern === '11'));
    assert.ok(!result.usablePrimeImplicants.some((p) => p.pattern === '11'));
    assert.equal(result.expression, "A'·B'");
  });

  test('多素蕴含项：XOR 两个最小项互不可合并', () => {
    const { result } = computeQmc({ variables: ['A', 'B'], on: [1, 2], dc: [] });
    const patterns = result.usablePrimeImplicants.map((p) => p.pattern).sort();
    assert.deepEqual(patterns, ['01', '10']);
    assert.equal(result.verification.passed, true);
    // 两项都是必需
    assert.deepEqual(result.selections.map((s) => s.reason).sort(), ['essential', 'essential']);
  });

  test('必需项已覆盖全部 ON：单个合并项即解决', () => {
    const { result } = computeQmc({ variables: ['A', 'B', 'C'], on: [4, 5], dc: [] });
    assert.ok(result.usablePrimeImplicants.some((p) => p.pattern === '10-'));
    assert.deepEqual(result.selections.map((s) => s.reason), ['essential']);
    assert.deepEqual(result.selections[0]?.newlyCovered, [4, 5]);
    assert.equal(result.expression, "A·B'");
  });

  test('还需贪心补选：存在非必需选择并给出理由与新增覆盖', () => {
    const { result } = computeQmc({ variables: ['A', 'B', 'C'], on: [0, 2, 3, 4, 5, 7], dc: [] });
    const reasons = result.selections.map((s) => s.reason);
    assert.ok(reasons.includes('greedy'));
    // 每个贪心选择都有非空新增覆盖与依据
    for (const s of result.selections) {
      assert.ok(s.newlyCovered.length > 0);
      assert.ok(s.rationale.length > 0);
    }
    // 覆盖集合 = ON
    assert.deepEqual(result.expressionMinterms, [0, 2, 3, 4, 5, 7]);
  });

  test('空 ON 即使 DC 非空也规范为常假 0', () => {
    const { result } = computeQmc({ variables: ['A', 'B'], on: [], dc: [1, 2] });
    assert.equal(result.constant, 'false');
    assert.equal(result.expression, '0');
    assert.deepEqual(result.selections, []);
    assert.equal(result.usablePrimeImplicants.length, 0);
    assert.equal(evaluateResult(result, 1).value, 0);
  });

  test('全表为真时得到全无关常真项 1', () => {
    const { result } = computeQmc({ variables: ['A', 'B'], on: [0, 1, 2, 3], dc: [] });
    assert.ok(result.usablePrimeImplicants.some((p) => p.pattern === '--'));
    assert.equal(result.expression, '1');
    assert.equal(result.constant, 'true');
    assert.deepEqual(result.expressionMinterms, [0, 1, 2, 3]);
  });

  test('全表 ON+DC 混合也产生常真项', () => {
    const { result } = computeQmc({ variables: ['A', 'B'], on: [0, 3], dc: [1, 2] });
    assert.equal(result.expression, '1');
    assert.equal(result.verification.passed, true);
  });

  test('集合内重复编号明确去重，结果等价于无重复输入', () => {
    const a = computeQmc({ variables: ['A', 'B', 'C'], on: [1, 1, 2, 2], dc: [3, 3] });
    const b = computeQmc({ variables: ['A', 'B', 'C'], on: [1, 2], dc: [3] });
    assert.deepEqual(a.result.expression, b.result.expression);
    assert.deepEqual(a.spec.on, [1, 2]);
    assert.deepEqual(a.spec.dc, [3]);
  });

  test('重复合并来源：同一结果多对来源时来源去重保留', () => {
    // 3 变量函数使某轮同一模式可由多对得到；检查 steps 不重复且完整
    const { result } = computeQmc({ variables: ['A', 'B', 'C'], on: [0, 1, 2, 3], dc: [] });
    const keys = result.mergeSteps.map((s) => `${s.round}:${s.left}+${s.right}=${s.result}`);
    assert.equal(new Set(keys).size, keys.length);
    // 00- 与 0-0 等合并最终汇聚为 0-- = A\'
    assert.ok(result.usablePrimeImplicants.some((p) => p.pattern === '0--'));
  });
});

describe('独立枚举核验', () => {
  test('<=4 变量：穷举 3^n 模式与素蕴含项集合一致（多个随机函数）', () => {
    const fixtures = [
      { n: 2, on: [0, 3], dc: [1] },
      { n: 3, on: [0, 2, 5, 7], dc: [3] },
      { n: 3, on: [1, 3, 4, 6], dc: [] },
      { n: 4, on: [0, 1, 3, 5, 9, 14], dc: [6, 10] },
      { n: 4, on: [2, 4, 7, 8, 11, 13, 15], dc: [] },
    ];
    for (const f of fixtures) {
      const vars = f.n === 2 ? ['A', 'B'] : f.n === 3 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
      const { result } = computeQmc({ variables: vars, on: f.on, dc: f.dc });
      const cross = crossCheckPrimeImplicants(f.n, result.on, result.dc, result.usablePrimeImplicants);
      assert.ok(cross.passed, JSON.stringify(cross));
      assert.equal(result.verification.passed, true);
      // 表达式绝不覆盖 OFF，且覆盖全部 ON
      const covered = new Set(result.expressionMinterms);
      for (const m of f.on) assert.ok(covered.has(m));
      for (const m of covered) assert.ok(f.on.includes(m) || f.dc.includes(m));
    }
  });

  test('mergePosition 仅在固定位一致且恰好一位相反时合并', () => {
    assert.equal(mergePosition('10-', '11-'), 1);
    assert.equal(mergePosition('10-', '10-'), -1);
    assert.equal(mergePosition('10-', '00-'), 0);
    assert.equal(mergePosition('10-', '1-1'), -1);
    assert.equal(mergePosition('10-0', '11-1'), -1);
  });

  test('expandPattern 正确展开无关位', () => {
    assert.deepEqual(expandPattern('1--'), [4, 5, 6, 7]);
    assert.deepEqual(expandPattern('-0-'), [0, 1, 4, 5]);
  });
});

describe('参数校验与错误码', () => {
  test('非法变量数', () => {
    assert.throws(() => computeQmc({ variables: [], on: [], dc: [] }), (e: unknown) =>
      e instanceof QmcError && e.code === 'INVALID_VAR_COUNT');
    assert.throws(() => computeQmc({ variables: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], on: [] }),
      (e: unknown) => e instanceof QmcError && e.code === 'INVALID_VAR_COUNT');
  });

  test('重复变量名与非法名称', () => {
    assert.throws(() => computeQmc({ variables: ['A', 'a'], on: [] }),
      (e: unknown) => e instanceof QmcError && e.code === 'DUPLICATE_VAR_NAME');
    assert.throws(() => computeQmc({ variables: ['1A'], on: [] }),
      (e: unknown) => e instanceof QmcError && e.code === 'INVALID_VAR_NAME');
  });

  test('越界编号与非整数', () => {
    assert.throws(() => computeQmc({ variables: ['A', 'B'], on: [4], dc: [] }),
      (e: unknown) => e instanceof QmcError && e.code === 'MINTERM_OUT_OF_RANGE');
    assert.throws(() => computeQmc({ variables: ['A', 'B'], on: [1.5], dc: [] }),
      (e: unknown) => e instanceof QmcError && e.code === 'MINTERM_NOT_INTEGER');
  });

  test('ON/DC 重叠被拒绝', () => {
    assert.throws(() => computeQmc({ variables: ['A', 'B'], on: [1], dc: [1] }),
      (e: unknown) => e instanceof QmcError && e.code === 'ON_DC_OVERLAP');
  });
});

describe('SQLite 版本化与重启查询', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qmc-test-'));
  });

  test('修改集合创建新版本，旧版本保留且可求值', () => {
    const dbFile = join(dir, 'q.db');
    const db = new QmcDatabase(dbFile);
    const fn = db.createFunction('f');
    const v1Input = computeQmc({ variables: ['A', 'B'], on: [1], dc: [] });
    const v1 = db.addComputedVersion(fn.functionId, v1Input.spec, v1Input.result, null);
    const v2Input = computeQmc({ variables: ['A', 'B'], on: [1, 2], dc: [3] });
    const v2 = db.addComputedVersion(fn.functionId, v2Input.spec, v2Input.result, null);
    assert.equal(v1.versionNo, 1);
    assert.equal(v2.versionNo, 2);
    db.close();

    // 模拟重启：重新打开同一文件，旧报告仍可求值
    const reopened = new QmcDatabase(dbFile);
    const old = reopened.getVersionByNo(fn.functionId, 1);
    assert.ok(old.result);
    assert.equal(evaluateResult(old.result!, 1).value, 1);
    const listed = reopened.listVersions(fn.functionId);
    assert.equal(listed.length, 2);
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
