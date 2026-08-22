import { isApiError } from "../api/errors";
import { translateErrorMessage } from "./userText";

/** 面向用户的错误文案：契约错误附请求 ID 便于排障，非契约错误兜底。 */
export function errorText(error: unknown): string {
  if (isApiError(error)) {
    const message = translateErrorMessage(error.message);
    return error.requestId
      ? `${message}（请求 ID：${error.requestId}）`
      : message;
  }
  return error instanceof Error ? translateErrorMessage(error.message) : "未知错误";
}
