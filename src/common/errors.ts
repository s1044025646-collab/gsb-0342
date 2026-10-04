/**
 * 统一错误类型与错误码。
 * API 层根据 httpStatus 映射 HTTP 状态码；CLI 层直接打印 message。
 */
export type ErrorCode =
  | 'INVALID_VAR_COUNT'
  | 'EMPTY_VAR_NAME'
  | 'DUPLICATE_VAR_NAME'
  | 'INVALID_VAR_NAME'
  | 'MINTERM_OUT_OF_RANGE'
  | 'MINTERM_NOT_INTEGER'
  | 'ON_DC_OVERLAP'
  | 'FUNCTION_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'NOT_COMPUTED'
  | 'INVALID_INPUT_NUMBER'
  | 'INVALID_LITERALS'
  | 'INVALID_PAGINATION'
  | 'STALE_VERSION'
  | 'BAD_REQUEST';

export class QmcError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, httpStatus = 400, details?: unknown) {
    super(message);
    this.name = 'QmcError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function notFound(code: ErrorCode, message: string): QmcError {
  return new QmcError(code, message, 404);
}
