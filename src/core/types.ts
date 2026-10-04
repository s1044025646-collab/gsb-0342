/**
 * 核心数据结构。
 *
 * 位序约定（与 README 一致）：
 * - 变量数组 variables[0..n-1] 为有序变量，variables[0] 是最高位（MSB）。
 * - 最小项编号 m 的二进制为 n 位：变量 variables[j] 取 bit (n-1-j)。
 * - 例如 n=3，变量 [A,B,C]，编号 6 = 110 表示 A=1,B=1,C=0。
 * - 模式（pattern）为长度 n 的字符串，字符为 '0' | '1' | '-'，
 *   第 j 个字符对应 variables[j]（MSB 起始），'-' 表示该变量已被消去。
 */

export interface FunctionSpec {
  variables: string[];
  on: number[];
  dc: number[];
}

export interface ValidatedSpec extends FunctionSpec {
  variableCount: number;
}

/** 一轮合并中参与 QM 表格的一个条目（可能是最小项或带无关位的蕴含项）。 */
export interface MergeEntry {
  /** 零一横线模式，长度等于变量数，第 0 个字符对应最高位变量。 */
  pattern: string;
  /** 该条目展开覆盖的全部最小项编号（ON 与 DC 都可能包含）。 */
  minterms: number[];
  /** 该条目内固定为 1 的比特数（即 1 的个数，不含 '-'），用于分组。 */
  ones: number;
  /** 该条目在本轮是否继续参与了某次合并；为 false 时即为素蕴含项候选。 */
  merged: boolean;
}

/** 一次成功的合并记录：两个来源合并为结果。 */
export interface MergeStep {
  round: number;
  left: string;
  right: string;
  result: string;
}

export interface MergeRound {
  /** 轮次从 0 开始；第 0 轮是最小项起点。 */
  round: number;
  entries: MergeEntry[];
}

export interface PrimeImplicant {
  pattern: string;
  minterms: number[];
  /** 该素蕴含项覆盖的 ON 编号（DC-only 的项不进入可用表）。 */
  coversOn: number[];
  /** 文字数：模式中非 '-' 的字符数；全 '-' 常真项为 0。 */
  literals: number;
}

export type SelectionReason = 'essential' | 'greedy';

export interface CoverageSelection {
  pattern: string;
  reason: SelectionReason;
  /** 选择该模式的人类可读解释（中文）。 */
  rationale: string;
  /** 选择时相对此前已选集合新增覆盖的 ON 编号。 */
  newlyCovered: number[];
  /** essential：必需项依据（只被它覆盖的 ON）；greedy：用于打破平局的排序键。 */
  basis: string;
}

export interface CoverageRow {
  pattern: string;
  /** 与请求的 onMinterms 对齐的覆盖标记，'1' 覆盖 '0' 不覆盖。 */
  marks: string[];
}

export interface QmcResult {
  variables: string[];
  on: number[];
  dc: number[];
  rounds: MergeRound[];
  mergeSteps: MergeStep[];
  /** 全部素蕴含项（包含只覆盖 DC 的项，供完整审计）。 */
  allPrimeImplicants: PrimeImplicant[];
  /** 可用素蕴含项：至少覆盖一个 ON 的项，构成覆盖表。 */
  usablePrimeImplicants: PrimeImplicant[];
  coverageTable: {
    onMinterms: number[];
    rows: CoverageRow[];
  };
  selections: CoverageSelection[];
  /** 最终积之和；空 ON 为 '0'，全无关模式为 '1'。 */
  expression: string;
  /** 最终表达式覆盖的全部最小项（展开）。 */
  expressionMinterms: number[];
  /** 真值核验结果：逐输入枚举的判定。 */
  verification: VerificationReport;
  /** 结果是否为常量。 */
  constant: 'none' | 'true' | 'false';
}

export interface TruthRow {
  minterm: number;
  assignment: string;
  spec: 'ON' | 'OFF' | 'DC';
  expressionValue: 0 | 1;
  passed: boolean;
}

export interface VerificationReport {
  passed: boolean;
  rows: TruthRow[];
  checkedAt: string;
}
