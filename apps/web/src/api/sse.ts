import { qk } from "./queryKeys";

export const SSE_EVENT_NAMES = [
  "connected",
  "job.updated",
  "storyboard.updated",
  "output.created",
  "export.updated",
  "provider.updated",
] as const;

export type SseEventName = (typeof SSE_EVENT_NAMES)[number];

/** 从事件 envelope 提取任务 ID；解析失败时由调用方继续按项目维度失效。 */
export function eventJobId(data: string): string | undefined {
  try {
    const envelope = JSON.parse(data) as { data?: { id?: unknown } };
    return typeof envelope.data?.id === "string" ? envelope.data.id : undefined;
  } catch {
    return undefined;
  }
}

/** 按事件名失效缓存；job.updated 额外精准失效任务缓存。 */
export function invalidateKeysForEvent(
  projectId: string,
  event: string,
  jobId?: string,
): readonly (readonly unknown[])[] {
  switch (event) {
    case "job.updated": {
      const keys: (readonly unknown[])[] = [qk.project(projectId), qk.exports(projectId)];
      if (jobId) keys.push(qk.job(jobId));
      return keys;
    }
    case "storyboard.updated":
      return [qk.storyboard(projectId), qk.project(projectId)];
    case "output.created":
      return [qk.project(projectId), qk.storyboard(projectId)];
    case "export.updated":
      return [qk.exports(projectId), qk.project(projectId)];
    case "provider.updated":
      return [qk.providers];
    default:
      return [];
  }
}
