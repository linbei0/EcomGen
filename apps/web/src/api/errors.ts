/**
 * 契约错误规范化。后端统一返回 { error: { code, message, details?, requestId } }，
 * 前端只按 code 分支处理（docs/09 8.4）；非契约响应体降级为 UNKNOWN，不猜测结构。
 */
export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "CAPABILITY_UNSUPPORTED",
  "RATE_LIMITED",
  "PROVIDER_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && (API_ERROR_CODES as readonly string[]).includes(value);
}

export class ApiError extends Error {
  readonly code: ApiErrorCode | "UNKNOWN";
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(shape: {
    code: ApiErrorCode | "UNKNOWN";
    message: string;
    status: number;
    details?: unknown;
    requestId?: string;
  }) {
    super(shape.message);
    this.name = "ApiError";
    this.code = shape.code;
    this.status = shape.status;
    this.details = shape.details;
    this.requestId = shape.requestId;
  }
}

interface ErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    requestId?: unknown;
  };
}

export function toApiError(status: number, body: unknown): ApiError {
  const error = (body as ErrorBody | null | undefined)?.error;
  if (error && typeof error.message === "string") {
    return new ApiError({
      code: isApiErrorCode(error.code) ? error.code : "UNKNOWN",
      message: error.message,
      status,
      details: error.details,
      requestId: typeof error.requestId === "string" ? error.requestId : undefined,
    });
  }
  return new ApiError({ code: "UNKNOWN", message: `请求失败（HTTP ${status}）`, status });
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
