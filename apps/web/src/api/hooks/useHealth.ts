import { useQuery } from "@tanstack/react-query";

import { API_BASE_URL } from "../../config/env";
import { healthUrl } from "../../lib/healthUrl";
import { qk } from "../queryKeys";

/** GET {origin}/health 轮询，顶栏连接指示用；不代表业务数据就绪。 */
export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: async () => {
      const response = await fetch(healthUrl(API_BASE_URL));
      if (!response.ok) throw new Error(`health check failed: ${response.status}`);
      return (await response.json()) as { status: string };
    },
    refetchInterval: 30_000,
    retry: 1,
  });
}
