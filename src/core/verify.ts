import { buildExpression } from './expression.js';
import { expandPattern, mintermToAssignment, patternMatches } from './pattern.js';
import type { PrimeImplicant, QmcResult, TruthRow, VerificationReport } from './types.js';

/**
 * 独立真值核验：枚举全部 2^n 个输入，
 * 要求表达式在 ON 上为 1、OFF 上为 0；DC 取值任意。
 * 同时要求覆盖集合 ⊆ ON∪DC（绝不覆盖 OFF）且包含全部 ON。
 * 核验结果写回 result.expression 与 result.verification。
 */
export function verifyResult(result: QmcResult): VerificationReport {
  const n = result.variables.length;
  const total = 1 << n;
  const onSet = new Set(result.on);
  const dcSet = new Set(result.dc);
  const chosenPatterns = result.selections.map((s) => s.pattern);
  result.expression = buildExpression(chosenPatterns, result.variables);

  const rows: TruthRow[] = [];
  let passed = true;

  for (let m = 0; m < total; m += 1) {
    const value: 0 | 1 = chosenPatterns.some((p) => patternMatches(p, m)) ? 1 : 0;
    const spec: TruthRow['spec'] = onSet.has(m) ? 'ON' : dcSet.has(m) ? 'DC' : 'OFF';
    const rowPassed = spec === 'ON' ? value === 1 : spec === 'OFF' ? value === 0 : true;
    if (!rowPassed) passed = false;
    rows.push({
      minterm: m,
      assignment: mintermToAssignment(m, n),
      spec,
      expressionValue: value,
      passed: rowPassed,
    });
  }

  const coveredSet = new Set(result.expressionMinterms);
  for (const m of result.on) {
    if (!coveredSet.has(m)) passed = false;
  }
  for (const m of coveredSet) {
    if (!onSet.has(m) && !dcSet.has(m)) passed = false;
  }

  const report: VerificationReport = { passed, rows, checkedAt: new Date().toISOString() };
  result.verification = report;
  return report;
}

/**
 * 独立枚举全部零一横线模式（n<=4，共 3^n 个），
 * 计算其中「合法（不覆盖 OFF）、极大（不能再消去一个文字）、覆盖 ON」的集合，
 * 与 QM 产出的可用素蕴含项集合做一致性交叉核对。
 */
export function crossCheckPrimeImplicants(
  variableCount: number,
  on: number[],
  dc: number[],
  usable: Pick<PrimeImplicant, 'pattern'>[],
): {
  passed: boolean;
  expected: string[];
  actual: string[];
  onlyInExpected: string[];
  onlyInActual: string[];
} {
  const onSet = new Set(on);
  const dcSet = new Set(dc);
  const offSet = new Set<number>();
  for (let m = 0; m < 1 << variableCount; m += 1) {
    if (!onSet.has(m) && !dcSet.has(m)) offSet.add(m);
  }

  const isImplicant = (pattern: string): boolean =>
    expandPattern(pattern).every((m) => !offSet.has(m));

  const expected = enumeratePatterns(variableCount)
    .filter((pattern) => {
      if (!isImplicant(pattern)) return false;
      if (!expandPattern(pattern).some((m) => onSet.has(m))) return false;
      for (let i = 0; i < pattern.length; i += 1) {
        if (pattern[i] === '-') continue;
        const generalized = pattern.slice(0, i) + '-' + pattern.slice(i + 1);
        if (isImplicant(generalized)) return false;
      }
      return true;
    })
    .sort();

  const actual = usable.map((p) => p.pattern).sort();
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    passed: expected.length === actual.length && expected.every((p) => actualSet.has(p)),
    expected,
    actual,
    onlyInExpected: expected.filter((p) => !actualSet.has(p)),
    onlyInActual: actual.filter((p) => !expectedSet.has(p)),
  };
}

function enumeratePatterns(variableCount: number): string[] {
  const result: string[] = [];
  const walk = (prefix: string, depth: number): void => {
    if (depth === variableCount) {
      result.push(prefix);
      return;
    }
    walk(prefix + '-', depth + 1);
    walk(prefix + '0', depth + 1);
    walk(prefix + '1', depth + 1);
  };
  walk('', 0);
  return result;
}
