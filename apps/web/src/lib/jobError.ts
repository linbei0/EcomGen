import type { Job } from "../api/adapters/projectDetail";

/** Job.error 契约仅为 object|null，防御式读取 message / requestId。 */
export function jobErrorText(job: Job): string | null {
  if (job.status !== "FAILED") return null;
  if (!job.error || typeof job.error !== "object") return "任务失败";
  const record = job.error as Record<string, unknown>;
  const message = typeof record.message === "string" && record.message ? record.message : "任务失败";
  const requestId = typeof record.requestId === "string" ? record.requestId : undefined;
  return requestId ? `${message}（请求 ID：${requestId}）` : message;
}
