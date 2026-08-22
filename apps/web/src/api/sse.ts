import { qk } from "./queryKeys";

export const SSE_EVENT_NAMES = [
  "connected",
  "job.updated",
  "storyboard.updated",
  "output.created",
  "edit-session.updated",
  "edit-turn.updated",
  "export.updated",
  "provider.updated",
] as const;

export type SseEventName = (typeof SSE_EVENT_NAMES)[number];

type EventEnvelope = { data?: { id?: unknown; export?: { id?: unknown }; turn?: { id?: unknown } } };

/** 从事件 envelope 提取事件对应资源 ID；解析失败时由调用方按项目维度失效。 */
export function eventResourceId(data: string, event: string): string | undefined {
  try {
    const envelope = JSON.parse(data) as EventEnvelope;
    const id = event === "export.updated"
      ? envelope.data?.export?.id
      : event === "edit-turn.updated"
        ? envelope.data?.turn?.id
        : envelope.data?.id;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

/** 从 job.updated envelope 提取任务 ID。 */
export function eventJobId(data: string): string | undefined {
  return eventResourceId(data, "job.updated");
}

/** 按事件名失效缓存；事件具备资源 ID 时同时精准失效详情缓存。 */
export function invalidateKeysForEvent(
  projectId: string,
  event: string,
  resourceId?: string,
): readonly (readonly unknown[])[] {
    switch (event) {
      case "job.updated": {
      const keys: (readonly unknown[])[] = [qk.project(projectId), qk.exports(projectId)];
      if (resourceId) keys.push(qk.job(resourceId));
      return keys;
    }
    case "storyboard.updated":
      return [qk.storyboard(projectId), qk.project(projectId)];
    case "output.created":
    case "edit-session.updated":
      return [qk.project(projectId), qk.storyboard(projectId)];
    case "edit-turn.updated": {
      const keys: (readonly unknown[])[] = [qk.project(projectId), qk.storyboard(projectId)];
      if (resourceId) keys.push(qk.editTurn(resourceId));
      return keys;
    }
    case "export.updated":
      return resourceId
        ? [qk.exports(projectId), qk.project(projectId), qk.export(resourceId)]
        : [qk.exports(projectId), qk.project(projectId)];
    case "provider.updated":
      return [qk.providers];
    default:
      return [];
  }
}
