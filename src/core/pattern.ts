/**
 * 模式（零一横线）工具。
 * pattern[j] 对应 variables[j]（最高位变量），
 * 即最小项编号 m 的 bit (n-1-j)。
 */

/** 由最小项编号生成固定模式（全部 0/1，无 '-'）。 */
export function mintermToPattern(minterm: number, variableCount: number): string {
  let out = '';
  for (let j = 0; j < variableCount; j += 1) {
    const bit = (minterm >> (variableCount - 1 - j)) & 1;
    out += bit === 1 ? '1' : '0';
  }
  return out;
}

/** 展开模式覆盖的全部最小项编号（每个 '-' 产生两个分支）。 */
export function expandPattern(pattern: string): number[] {
  const results: number[] = [0];
  const n = pattern.length;
  for (let j = 0; j < n; j += 1) {
    const ch = pattern[j] as string;
    const bitIndex = n - 1 - j;
    const size = results.length;
    for (let k = 0; k < size; k += 1) {
      const base = results[k] as number;
      if (ch === '-') {
        results[k] = base;
        results.push(base | (1 << bitIndex));
      } else if (ch === '1') {
        results[k] = base | (1 << bitIndex);
      }
    }
  }
  return results.sort((a, b) => a - b);
}

/**
 * 判断两个同长度模式能否合并：
 * 所有固定位置必须一致，且恰好有一个位置一边 '0' 一边 '1'。
 * 返回可合并位置索引；不可合并返回 -1。
 */
export function mergePosition(a: string, b: string): number {
  if (a.length !== b.length) return -1;
  let differingFixed = -1;
  for (let i = 0; i < a.length; i += 1) {
    const ca = a[i] as string;
    const cb = b[i] as string;
    if (ca === cb) continue;
    if (ca === '-' || cb === '-') return -1; // 固定位与无关位冲突
    if (differingFixed !== -1) return -1; // 超过一个相反固定位
    differingFixed = i;
  }
  return differingFixed;
}

export function mergePatterns(a: string, b: string, position: number): string {
  return a.slice(0, position) + '-' + a.slice(position + 1);
}

/** 判断具体赋值（最小项编号）是否匹配模式。 */
export function patternMatches(pattern: string, minterm: number): boolean {
  const n = pattern.length;
  for (let j = 0; j < n; j += 1) {
    const ch = pattern[j] as string;
    if (ch === '-') continue;
    const bit = (minterm >> (n - 1 - j)) & 1;
    if ((ch === '1') !== (bit === 1)) return false;
  }
  return true;
}

export function countOnes(pattern: string): number {
  let count = 0;
  for (const ch of pattern) if (ch === '1') count += 1;
  return count;
}

export function countLiterals(pattern: string): number {
  let count = 0;
  for (const ch of pattern) if (ch !== '-') count += 1;
  return count;
}

/**
 * 固定排序：字符序 '-' < '0' < '1'，按模式从左至右字典序。
 * 用于贪心平局时的确定性裁决，保证结果可复现。
 */
export function comparePattern(a: string, b: string): number {
  const rank = (ch: string): number => (ch === '-' ? 0 : ch === '0' ? 1 : 2);
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const diff = rank(a[i] as string) - rank(b[i] as string);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

/** 编号 -> n 位二进制字符串（用于真值表展示）。 */
export function mintermToAssignment(minterm: number, variableCount: number): string {
  return minterm.toString(2).padStart(variableCount, '0');
}
