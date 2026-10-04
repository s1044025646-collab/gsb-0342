import { validateFunctionSpec } from './validation.js';
import { runQuineMcCluskey } from './quineMcCluskey.js';
import { verifyResult } from './verify.js';
import { patternMatches } from './pattern.js';
import { QmcError } from '../common/errors.js';
import type { QmcResult, ValidatedSpec } from './types.js';

export interface ComputeOutcome {
  spec: ValidatedSpec;
  result: QmcResult;
}

/**
 * 计算完整流水线：校验 -> QM 合并 -> 覆盖选择 -> 真值核验。
 * 只有核验通过的结果才允许落库发布；核验失败抛出，不产生半份覆盖。
 */
export function computeQmc(rawInput: unknown): ComputeOutcome {
  const spec = validateFunctionSpec(rawInput);
  const result = runQuineMcCluskey(spec);
  const verification = verifyResult(result);
  if (!verification.passed) {
    throw new QmcError('BAD_REQUEST', '真值核验失败：最终表达式未能正确区分 ON/OFF', 500, {
      verification,
    });
  }
  return { spec, result };
}

/** 对已保存结果求指定输入编号的输出值（DC 由表达式实际取值返回并标注）。 */
export function evaluateResult(result: QmcResult, minterm: number): {
  minterm: number;
  assignment: string;
  spec: 'ON' | 'OFF' | 'DC';
  value: 0 | 1;
} {
  const onSet = new Set(result.on);
  const dcSet = new Set(result.dc);
  const value: 0 | 1 = result.selections.some((s) => patternMatches(s.pattern, minterm)) ? 1 : 0;
  const assignment = minterm
    .toString(2)
    .padStart(result.variables.length, '0');
  return {
    minterm,
    assignment,
    spec: onSet.has(minterm) ? 'ON' : dcSet.has(minterm) ? 'DC' : 'OFF',
    value,
  };
}
