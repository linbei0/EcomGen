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

/** 仅按事件名失效缓存；不解析 payload（缺口 13.10）。 */
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
