import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { API_BASE_URL } from "../../config/env";
import { eventResourceId, invalidateKeysForEvent, SSE_EVENT_NAMES } from "../sse";
import { qk } from "../queryKeys";

export type EventConnection = "idle" | "open" | "retrying";

/** 工作台挂载时订阅 SSE；事件只负责触发查询失效，REST 响应仍是状态真相。 */
export function useProjectEvents(projectId: string | undefined): EventConnection {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<EventConnection>("idle");

  useEffect(() => {
    if (!projectId || typeof EventSource === "undefined") return;
    const source = new EventSource(`${API_BASE_URL}/events?projectId=${encodeURIComponent(projectId)}`);
    setConnection("retrying");

    const pending = new Map<string, number>();
    const timers = new Set<number>();
    const invalidate = (key: readonly unknown[]) => {
      const serialized = JSON.stringify(key);
      if (pending.has(serialized)) return;
      const timer = window.setTimeout(() => {
        pending.delete(serialized);
        timers.delete(timer);
        void queryClient.invalidateQueries({ queryKey: [...key] });
      }, 25);
      pending.set(serialized, timer);
      timers.add(timer);
    };
    const resync = () => {
      for (const key of [qk.project(projectId), qk.storyboard(projectId), qk.exports(projectId), ["exports"] as const]) invalidate(key);
    };

    const onOpen = () => {
      setConnection("open");
      resync();
    };
    const onError = () => setConnection("retrying");
    const onNamed = (event: MessageEvent<string>) => {
      const type = event.type;
      if (type === "connected") {
        setConnection("open");
        resync();
        return;
      }
      for (const key of invalidateKeysForEvent(projectId, type, eventResourceId(event.data, type))) invalidate(key);
    };

    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);
    for (const name of SSE_EVENT_NAMES) {
      source.addEventListener(name, onNamed);
    }

    return () => {
      source.close();
      for (const timer of timers) window.clearTimeout(timer);
      setConnection("idle");
    };
  }, [projectId, queryClient]);

  return connection;
}
