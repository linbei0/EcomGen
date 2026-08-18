import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adaptJob, type Job } from "../adapters/projectDetail";
import { api, unwrap } from "../client";
import { ApiError } from "../errors";
import { qk } from "../queryKeys";

async function readJob(raw: unknown): Promise<Job> {
  const job = adaptJob(raw);
  if (!job) {
    throw new ApiError({ code: "UNKNOWN", message: "任务响应无法解析", status: 0 });
  }
  return job;
}

export function useJob(jobId: string | undefined) {
  return useQuery({
    queryKey: qk.job(jobId ?? ""),
    enabled: Boolean(jobId),
    queryFn: async () => readJob(await unwrap(api.GET("/jobs/{jobId}", { params: { path: { jobId: jobId! } } }))),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "QUEUED" || status === "RUNNING" ? 2000 : false;
    },
  });
}

export function useCancelJob(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) =>
      readJob(await unwrap(api.POST("/jobs/{jobId}/cancel", { params: { path: { jobId } } }))),
    onSuccess: (job) => {
      queryClient.setQueryData(qk.job(job.id), job);
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}

export function useRetryJob(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) =>
      readJob(await unwrap(api.POST("/jobs/{jobId}/retry", { params: { path: { jobId } } }))),
    onSuccess: (job) => {
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.job(job.id) });
    },
  });
}
