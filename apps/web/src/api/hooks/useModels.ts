import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "../client";
import { qk } from "../queryKeys";
import type { components } from "../schema.d.ts";

export type EcomModel = components["schemas"]["EcomModel"];
export type ModelSpec = components["schemas"]["ModelSpec"];
export type ModelPortrait = components["schemas"]["ModelPortrait"];
export type CreateModelBody = components["schemas"]["CreateModelInput"];
export type CreateModelCastBody = components["schemas"]["CreateModelCastJobInput"];
export type ModelCastJob = components["schemas"]["Job"];

/** 全局模特库列表；不绑定项目，也没有 SSE 通道，页面在任务运行期间按需轮询。 */
export function useModels() {
  return useQuery({
    queryKey: qk.models,
    queryFn: () => unwrap(api.GET("/models")),
  });
}

export function useCreateModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateModelBody) => unwrap(api.POST("/models", { body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.models });
    },
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) =>
      unwrap(api.DELETE("/models/{modelId}", { params: { path: { modelId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.models });
    },
  });
}

/** 参考脸是模特的唯一身份基准；multipart 单文件上传，覆盖旧图。 */
export function useUploadReferenceFace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ modelId, file }: { modelId: string; file: File }) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return unwrap(
        api.POST("/models/{modelId}/reference-face", {
          params: { path: { modelId } },
          body: { file: undefined as unknown as string },
          bodySerializer: () => form,
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.models });
    },
  });
}

export function useDeleteReferenceFace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) =>
      unwrap(api.DELETE("/models/{modelId}/reference-face", { params: { path: { modelId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.models });
    },
  });
}

/**
 * 发起选角生成；后端按指纹去重，重复提交同一 spec 会复用既有任务。
 *
 * reused 由状态码判定：200 表示复用了已成功的同参数任务（不会有新候选产出，也就没有可等的东西），
 * 202 表示新任务已入队。页面据此决定是否轮询以及在只复用不生成时给出准确提示。
 */
export function useCreateModelCastJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ modelId, body }: { modelId: string; body: CreateModelCastBody }) => {
      const result = await api.POST("/models/{modelId}/cast-jobs", { params: { path: { modelId } }, body });
      return { job: await unwrap(result), reused: result.response.status === 200 };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.models });
    },
  });
}

/** 候选定妆照列表；生成期间由页面用 job 轮询结果驱动 refetch。 */
export function useModelPortraits(modelId: string | undefined) {
  return useQuery({
    queryKey: qk.modelPortraits(modelId ?? ""),
    enabled: Boolean(modelId),
    queryFn: () => unwrap(api.GET("/models/{modelId}/portraits", { params: { path: { modelId: modelId! } } })),
    staleTime: 0,
  });
}

export function useSelectModelPortrait() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (portraitId: string) =>
      unwrap(api.POST("/model-portraits/{portraitId}/select", { params: { path: { portraitId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.models });
    },
  });
}

export function useDeleteModelPortrait() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (portraitId: string) =>
      unwrap(api.DELETE("/model-portraits/{portraitId}", { params: { path: { portraitId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.models });
    },
  });
}

/** 选角任务状态轮询：QUEUED/RUNNING 时 1.5s 一拍，终态即停，由页面负责失效候选缓存。 */
export function useModelCastJob(jobId: string | undefined) {
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
