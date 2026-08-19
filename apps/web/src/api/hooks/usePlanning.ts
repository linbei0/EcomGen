import { useMutation, useQueryClient } from "@tanstack/react-query";

import { adaptJob, type Job } from "../adapters/projectDetail";
import { api } from "../client";
import { ApiError } from "../errors";
import { qk } from "../queryKeys";
import type { PlanningJobInput } from "../serializePlanningBody";
import { serializePlanningBody } from "../serializePlanningBody";

export type PlanningJobResult = Job & { reused: boolean };

export function useCreatePlanningJob(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PlanningJobInput): Promise<PlanningJobResult> => {
      const { data, response } = await api.POST("/projects/{projectId}/planning-jobs", {
        params: { path: { projectId } },
        body: input,
        bodySerializer: serializePlanningBody,
      });
      const raw = data ?? (response.ok ? await response.clone().json() : undefined);
      const job = adaptJob(raw);
      if (!job) {
        throw new ApiError({ code: "UNKNOWN", message: "规划任务响应无法解析", status: response.status });
      }
      return { ...job, reused: response.status === 200 };
    },
    onSuccess: (job) => {
      queryClient.setQueryData(qk.job(job.id), job);
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}
