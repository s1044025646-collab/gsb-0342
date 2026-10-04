import { countLiterals } from './pattern.js';

/**
 * 将零一横线模式转成乘积文字：
 * - 第 j 位 '1' -> variables[j]；'0' -> 变量名加撇号（如 A'）；'-' 消去。
 * - 全 '-'（0 个文字）为常真，由调用方渲染为 '1'。
 */
export function patternToTerm(pattern: string, variables: string[]): string {
  const literals: string[] = [];
  for (let j = 0; j < pattern.length; j += 1) {
    const ch = pattern[j] as string;
    const name = variables[j] as string;
    if (ch === '1') literals.push(name);
    else if (ch === '0') literals.push(`${name}'`);
  }
  return literals.join('·');
}

/** 一组模式 -> 积之和表达式。空选择为 '0'（常假）。 */
export function buildExpression(patterns: string[], variables: string[]): string {
  if (patterns.length === 0) return '0';
  const terms = patterns.map((p) => (countLiterals(p) === 0 ? '1' : patternToTerm(p, variables)));
  if (terms.includes('1')) return '1';
  return terms.join(' + ');
}
