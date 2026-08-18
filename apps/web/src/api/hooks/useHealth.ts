import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "../client";
import { qk } from "../queryKeys";

/** GET /health 轮询，顶栏连接指示用；不代表业务数据就绪。 */
export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: () => unwrap(api.GET("/health")),
    refetchInterval: 30_000,
    retry: 1,
  });
}
