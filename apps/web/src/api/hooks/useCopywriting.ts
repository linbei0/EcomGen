import { useMutation, useQuery } from "@tanstack/react-query";

import type { components } from "../schema.d.ts";
import { adaptJob, type Job } from "../adapters/projectDetail";
import { api, unwrap } from "../client";
import { ApiError } from "../errors";
import { qk } from "../queryKeys";

export type CopywritingTarget = components["schemas"]["CopywritingTarget"];
export type CopywritingResult = components["schemas"]["CopywritingResult"];

export function useCreateCopywritingJob(projectId: string) {
  return useMutation({
    mutationFn: async (body: components["schemas"]["CreateCopywritingJobInput"]): Promise<Job> => {
      const job = adaptJob(await unwrap(api.POST("/projects/{projectId}/copywriting-jobs", {
        params: { path: { projectId } },
        body,
      })));
      if (!job) throw new ApiError({ code: "UNKNOWN", message: "AI 帮写任务响应无法解析", status: 0 });
      return job;
    },
  });
}

export function useCopywritingResult(jobId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...qk.job(jobId ?? ""), "copywriting-result"],
    enabled: Boolean(jobId) && enabled,
    queryFn: () => unwrap(api.GET("/copywriting-jobs/{jobId}/result", { params: { path: { jobId: jobId! } } })),
  });
}
