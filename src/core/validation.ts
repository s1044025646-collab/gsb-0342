import { QmcError } from '../common/errors.js';
import { MAX_VARS, MAX_MINTERMS, MIN_VARS, isValidVariableName } from '../common/limits.js';
import type { FunctionSpec, ValidatedSpec } from './types.js';

/**
 * 校验并规范化函数描述：
 * - 变量数 1..6；变量名非空、合法且不重复（保持输入顺序）。
 * - ON/DC 元素必须为安全整数且在 [0, 2^n-1] 内。
 * - 集合内重复编号明确去重；ON 与 DC 不允许重叠。
 */
export function validateFunctionSpec(input: unknown): ValidatedSpec {
  if (typeof input !== 'object' || input === null) {
    throw new QmcError('BAD_REQUEST', '请求体必须是 JSON 对象');
  }
  const obj = input as Record<string, unknown>;
  const variablesInput = obj.variables;
  const onInput = obj.on;
  const dcInput = obj.dc;

  if (!Array.isArray(variablesInput)) {
    throw new QmcError('BAD_REQUEST', 'variables 必须是字符串数组');
  }
  const variableCount = variablesInput.length;
  if (!Number.isInteger(variableCount) || variableCount < MIN_VARS || variableCount > MAX_VARS) {
    throw new QmcError(
      'INVALID_VAR_COUNT',
      `变量数必须在 ${MIN_VARS} 到 ${MAX_VARS} 之间，当前为 ${variableCount}`,
    );
  }

  const variables: string[] = [];
  const seenNames = new Set<string>();
  for (const raw of variablesInput) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new QmcError('EMPTY_VAR_NAME', '变量名必须是非空字符串');
    }
    const name = raw.trim();
    if (!isValidVariableName(name)) {
      throw new QmcError(
        'INVALID_VAR_NAME',
        `变量名 "${name}" 不合法：须以字母开头，仅含字母、数字、下划线，且不能是保留字`,
      );
    }
    const key = name.toLowerCase();
    if (seenNames.has(key)) {
      throw new QmcError('DUPLICATE_VAR_NAME', `变量名重复：${name}`);
    }
    seenNames.add(key);
    variables.push(name);
  }

  const maxIndex = (1 << variableCount) - 1;
  const normalizeSet = (value: unknown, field: string): number[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      throw new QmcError('BAD_REQUEST', `${field} 必须是整数数组`);
    }
    const result: number[] = [];
    for (const item of value) {
      if (typeof item !== 'number' || !Number.isInteger(item)) {
        throw new QmcError('MINTERM_NOT_INTEGER', `${field} 中的编号必须是整数，收到 ${String(item)}`);
      }
      if (item < 0 || item > maxIndex) {
        throw new QmcError(
          'MINTERM_OUT_OF_RANGE',
          `${field} 编号 ${item} 越界：${variableCount} 个变量时合法范围为 0..${maxIndex}`,
        );
      }
      if (!result.includes(item)) result.push(item);
    }
    return result.sort((a, b) => a - b);
  };

  const on = normalizeSet(onInput, 'on');
  const dc = normalizeSet(dcInput, 'dc');

  const onSet = new Set(on);
  const overlap = dc.filter((m) => onSet.has(m));
  if (overlap.length > 0) {
    throw new QmcError(
      'ON_DC_OVERLAP',
      `ON 与 DC 不能包含相同编号，冲突编号：${overlap.join(', ')}`,
      400,
      { overlap },
    );
  }

  return { variables, on, dc, variableCount };
}

/** 校验单个查询输入编号是否合法。 */
export function validateInputNumber(value: unknown, variableCount: number): number {
  const maxIndex = Math.min(MAX_MINTERMS - 1, (1 << variableCount) - 1);
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new QmcError('INVALID_INPUT_NUMBER', `输入编号必须是整数，收到 ${String(value)}`);
  }
  if (value < 0 || value > maxIndex) {
    throw new QmcError(
      'INVALID_INPUT_NUMBER',
      `输入编号 ${value} 越界：${variableCount} 个变量时合法范围为 0..${maxIndex}`,
    );
  }
  return value;
}

export function assertSpec(spec: ValidatedSpec): FunctionSpec {
  return { variables: spec.variables, on: spec.on, dc: spec.dc };
}
