import { translateErrorMessage } from "./userText";

/**
 * Job.error 契约仅为 object|null，防御式读取 message / requestId。
 * 参数取最小结构而非适配层 Job 类型：项目域任务与全局任务（模特/花型）返回的都是原始契约 Job，两侧共用。
 */
export function jobErrorText(job: { status: string; error?: unknown } | null | undefined): string | null {
  if (!job || job.status !== "FAILED") return null;
  if (!job.error || typeof job.error !== "object") return "任务失败";
  const record = job.error as Record<string, unknown>;
  const message = typeof record.message === "string" && record.message ? translateErrorMessage(record.message) : "任务失败";
  const requestId = typeof record.requestId === "string" ? record.requestId : undefined;
  return requestId ? `${message}（请求 ID：${requestId}）` : message;
}
