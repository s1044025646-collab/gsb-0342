/** 全局规模限制：变量 1..6 个，最小项编号最大 2^6-1 = 63。 */
export const MIN_VARS = 1;
export const MAX_VARS = 6;
export const MAX_MINTERMS = 1 << MAX_VARS; // 64

/** 算法版本号：修改算法时提升，旧版本结果永久保留在数据库中。 */
export const ALGORITHM_VERSION = 'qm-1.0.0';

/** 合法变量名：字母开头，仅含字母/数字/下划线；保留名称 not/and/or 禁止使用。 */
const RESERVED_NAMES = new Set(['not', 'and', 'or']);
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export function isValidVariableName(name: string): boolean {
  return NAME_RE.test(name) && !RESERVED_NAMES.has(name.toLowerCase());
}
