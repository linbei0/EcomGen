import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

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

export function useJob(projectId: string, jobId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.job(jobId ?? ""),
    enabled: Boolean(jobId),
    queryFn: async () => readJob(await unwrap(api.GET("/jobs/{jobId}", { params: { path: { jobId: jobId! } } }))),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "QUEUED" || status === "RUNNING" ? 2000 : false;
    },
  });
  const job = query.data;

  useEffect(() => {
    if (job?.type !== "PLAN" || job.status !== "SUCCEEDED") return;
    void queryClient.refetchQueries({ queryKey: qk.storyboard(projectId), type: "active" });
    void queryClient.refetchQueries({ queryKey: qk.project(projectId), type: "active" });
  }, [job, projectId, queryClient]);

  return query;
}

/**
 * 全局任务（不绑定项目，如模特选角、花型提取）的状态轮询：QUEUED/RUNNING 时 1.5s 一拍，终态即停。
 * 返回原始契约 Job 而非适配层视图，供无项目上下文的页面直接读取 status/progress/error；
 * 项目域轮询用 useJob（带 PLAN 成功后的分镜联动）。
 */
export function useJobStatus(jobId: string | undefined) {
  return useQuery({
    queryKey: qk.job(jobId ?? ""),
    enabled: Boolean(jobId),
    queryFn: async () => unwrap(api.GET("/jobs/{jobId}", { params: { path: { jobId: jobId! } } })),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "QUEUED" || status === "RUNNING" ? 1500 : false;
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
