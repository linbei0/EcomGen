import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "../client";
import { qk } from "../queryKeys";
import type { PlanningConfigSnapshot } from "../adapters/projectDetail";

export function usePlanningConfigSnapshots(projectId: string) {
  return useQuery({
    queryKey: qk.planningSnapshots(projectId),
    queryFn: async () => (await unwrap(api.GET("/projects/{projectId}/planning-config-snapshots", { params: { path: { projectId } } }))) as unknown as PlanningConfigSnapshot[],
  });
}

export function useApplyPlanningConfigSnapshot(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (snapshotId: string) => (await unwrap(api.POST("/projects/{projectId}/planning-config-snapshots/{snapshotId}/apply", { params: { path: { projectId, snapshotId } } }))) as unknown as { project: object; snapshot: PlanningConfigSnapshot },
    onSuccess: (result) => {
      queryClient.setQueryData(qk.project(projectId), (current: unknown) => current ? { ...(current as object), ...result.project } : current);
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.planningSnapshots(projectId) });
    },
  });
}
