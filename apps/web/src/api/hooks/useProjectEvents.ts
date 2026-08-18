import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { API_BASE_URL } from "../../config/env";
import { invalidateKeysForEvent, SSE_EVENT_NAMES } from "../sse";

export type EventConnection = "idle" | "open" | "retrying";

/** 工作台挂载时订阅 SSE；只按事件名失效缓存，不解析 payload。 */
export function useProjectEvents(projectId: string | undefined): EventConnection {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<EventConnection>("idle");

  useEffect(() => {
    if (!projectId || typeof EventSource === "undefined") return;
    const source = new EventSource(`${API_BASE_URL}/events?projectId=${encodeURIComponent(projectId)}`);
    setConnection("retrying");

    const onOpen = () => setConnection("open");
    const onError = () => setConnection("retrying");
    const onNamed = (event: Event) => {
      const type = event.type;
      if (type === "connected") {
        setConnection("open");
        return;
      }
      for (const key of invalidateKeysForEvent(projectId, type)) {
        void queryClient.invalidateQueries({ queryKey: [...key] });
      }
    };

    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);
    for (const name of SSE_EVENT_NAMES) {
      source.addEventListener(name, onNamed);
    }

    return () => {
      source.close();
      setConnection("idle");
    };
  }, [projectId, queryClient]);

  return connection;
}
