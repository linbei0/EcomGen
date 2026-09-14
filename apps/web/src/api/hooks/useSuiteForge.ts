import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "../client";
import { qk } from "../queryKeys";
import type { components } from "../schema.d.ts";

export type SuiteForgeJob = components["schemas"]["Job"];
export type SuiteForgeResult = components["schemas"]["SuiteForgeResult"];

export interface CreateSuiteForgeInput {
  files: File[];
  providerId: string;
  modelId: string;
  name?: string;
  l1?: string;
  l2?: string;
  leaf?: string;
  productFamily?: string;
  targetShotCount?: number;
  userInstruction?: string;
  idempotencyKey?: string;
}

/**
 * 源图与文本提示混合成 multipart：接口按文件内容 hash 计算请求指纹，
 * 重复提交同一批图会复用已有任务而非重复消耗模型额度。
 */
function buildForm(input: CreateSuiteForgeInput): FormData {
  const form = new FormData();
  for (const file of input.files) form.append("files", file, file.name);
  form.append("providerId", input.providerId);
  form.append("modelId", input.modelId);
  if (input.name) form.append("name", input.name);
  if (input.l1) form.append("l1", input.l1);
  if (input.l2) form.append("l2", input.l2);
  if (input.leaf) form.append("leaf", input.leaf);
  if (input.productFamily) form.append("productFamily", input.productFamily);
  if (input.targetShotCount !== undefined) form.append("targetShotCount", String(input.targetShotCount));
  if (input.userInstruction) form.append("userInstruction", input.userInstruction);
  if (input.idempotencyKey) form.append("idempotencyKey", input.idempotencyKey);
  return form;
}

export function useCreateSuiteForge() {
  return useMutation({
    mutationFn: (input: CreateSuiteForgeInput) =>
      unwrap(
        api.POST("/suite-forge-jobs", {
          body: {
            files: input.files as unknown as string[],
            providerId: input.providerId,
            modelId: input.modelId,
            name: input.name,
            l1: input.l1,
            l2: input.l2,
            leaf: input.leaf,
            productFamily: input.productFamily,
            targetShotCount: input.targetShotCount,
            userInstruction: input.userInstruction,
            idempotencyKey: input.idempotencyKey,
          },
          bodySerializer() {
            return buildForm(input);
          },
        }),
      ),
  });
}

/** 全局 forge 任务不绑定项目，也没有 SSE 通道；按需轮询单任务端点，终态即停。 */
export function useSuiteForgeJob(jobId: string | undefined) {
  return useQuery({
    queryKey: qk.suiteForgeJob(jobId ?? ""),
    enabled: Boolean(jobId),
    queryFn: async () => unwrap(api.GET("/jobs/{jobId}", { params: { path: { jobId: jobId! } } })),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "QUEUED" || status === "RUNNING" ? 1500 : false;
    },
  });
}

export function useSuiteForgeResult(jobId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.suiteForgeResult(jobId ?? ""),
    enabled: Boolean(jobId) && enabled,
    queryFn: async () =>
      unwrap(api.GET("/suite-forge-jobs/{jobId}/result", { params: { path: { jobId: jobId! } } })),
    staleTime: 0,
  });
}

export function useCommitSuiteForge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      unwrap(api.POST("/suite-forge-jobs/{jobId}/commit", { params: { path: { jobId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.suites });
    },
  });
}
