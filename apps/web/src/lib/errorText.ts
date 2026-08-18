import { isApiError } from "../api/errors";

/** 面向用户的错误文案：契约错误附请求 ID 便于排障，非契约错误兜底。 */
export function errorText(error: unknown): string {
  if (isApiError(error)) {
    return error.requestId
      ? `${error.message}（请求 ID：${error.requestId}）`
      : error.message;
  }
  return error instanceof Error ? error.message : "未知错误";
}
