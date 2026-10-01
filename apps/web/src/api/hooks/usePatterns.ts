import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "../client";
import { qk } from "../queryKeys";
import type { components } from "../schema.d.ts";

export type Pattern = components["schemas"]["Pattern"];
export type PrintPack = components["schemas"]["PrintPack"];
export type PodPrintSpec = components["schemas"]["PodPrintSpec"];
export type PodPrintSpecList = components["schemas"]["PodPrintSpecList"];
export type PatternListingResult = components["schemas"]["PatternListingResult"];
export type ListingPlatform = components["schemas"]["ListingPlatform"];
export type PodPrintLayout = components["schemas"]["PodPrintLayout"];
export type PodRepeatLayout = components["schemas"]["PodRepeatLayout"];
export type CreatePatternExtractBody = components["schemas"]["CreatePatternExtractJobInput"];
export type CreatePatternForgeBody = components["schemas"]["CreatePatternForgeJobInput"];
export type CreatePrintPackBody = components["schemas"]["CreatePrintPackJobInput"];
export type CreatePatternListingBody = components["schemas"]["CreatePatternListingJobInput"];
export type CreatePatternDeriveBody = components["schemas"]["CreatePatternDeriveJobInput"];
export type CreatePatternVariantBody = components["schemas"]["CreatePatternVariantJobInput"];
export type PatternBackgroundMode = components["schemas"]["PatternBackgroundMode"];
export type PatternVariantAxis = components["schemas"]["PatternVariantAxis"];
export type PatternVariantPreset = components["schemas"]["PatternVariantPreset"];
export type UpdatePatternBody = components["schemas"]["UpdatePatternInput"];
export type PatternPipeline = components["schemas"]["PatternPipeline"];
export type PatternPipelineStep = components["schemas"]["PatternPipelineStep"];
export type PatternPipelineStepName = components["schemas"]["PatternPipelineStepName"];
export type PatternPipelineResolution = components["schemas"]["PatternPipelineResolution"];
export type PatternPipelineAnswers = components["schemas"]["PatternPipelineAnswers"];
export type CreatePatternPipelineBody = components["schemas"]["CreatePatternPipelineInput"];

/** 全局花型库列表；不绑定项目，也没有 SSE 通道，页面在任务运行期间按需轮询。 */
export function usePatterns() {
  return useQuery({
    queryKey: qk.patterns,
    queryFn: () => unwrap(api.GET("/patterns")),
  });
}

export function useDeletePattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patternId: string) =>
      unwrap(api.DELETE("/patterns/{patternId}", { params: { path: { patternId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patterns });
    },
  });
}

/** 印刷规格目录：静态数据，进页面缓存后不再频繁刷新。 */
export function usePodPrintSpecs() {
  return useQuery({
    queryKey: qk.podPrintSpecs,
    queryFn: () => unwrap(api.GET("/pod/print-specs")),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * 发起提取；后端按源图 hash 去重，重复提交复用既有任务。
 * reused 由状态码判定：200 表示复用已成功任务，202 表示新任务已入队。
 */
export function useCreatePatternExtractJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, file }: { body: Omit<CreatePatternExtractBody, "file">; file: File }) => {
      const form = new FormData();
      form.append("file", file, file.name);
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;
        form.append(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      const result = await api.POST("/patterns/extract-jobs", {
        body: { ...body, file: undefined as unknown as string },
        bodySerializer: () => form,
      });
      return { job: await unwrap(result), reused: result.response.status === 200 };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patterns });
    },
  });
}

/** 发起 AI 起稿；同主题参数复用既有任务。 */
export function useCreatePatternForgeJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ body }: { body: CreatePatternForgeBody }) => {
      const result = await api.POST("/patterns/forge-jobs", { body });
      return { job: await unwrap(result), reused: result.response.status === 200 };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patterns });
    },
  });
}

/** 上传花型文件：跳过提取直接入库（来源 UPLOADED）；带 pipeline 时服务端顺带起链。 */
export function useUploadPattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, name, tags, pipeline }: { file: File; name?: string; tags?: string[]; pipeline?: PatternPipelineAnswers }) => {
      const form = new FormData();
      form.append("file", file, file.name);
      if (name) form.append("name", name);
      if (tags?.length) form.append("tags", JSON.stringify(tags));
      if (pipeline) form.append("pipeline", JSON.stringify(pipeline));
      return unwrap(api.POST("/patterns/upload", {
        body: { file: undefined as unknown as string },
        bodySerializer: () => form,
      }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patterns });
    },
  });
}

/** 成规格包：任务与领域记录一起返回，页面轮询 printPack 状态。 */
export function useCreatePrintPackJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ patternId, body }: { patternId: string; body: CreatePrintPackBody }) => {
      const result = await api.POST("/patterns/{patternId}/print-pack-jobs", { params: { path: { patternId } }, body });
      const data = await unwrap(result);
      return { job: data.job, printPack: data.printPack, reused: result.response.status === 200 };
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: qk.printPacks(variables.patternId) });
      void queryClient.invalidateQueries({ queryKey: qk.patterns });
    },
  });
}

export function usePatternPrintPacks(patternId: string | undefined) {
  return useQuery({
    queryKey: qk.printPacks(patternId ?? ""),
    enabled: Boolean(patternId),
    queryFn: () => unwrap(api.GET("/patterns/{patternId}/print-packs", { params: { path: { patternId: patternId! } } })),
    staleTime: 0,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((pack) => pack.status === "QUEUED" || pack.status === "RUNNING") ? 1500 : false;
    },
  });
}

/** 发起 Listing 文案；同输入复用旧结果，重新生成需换 idempotencyKey。 */
export function useCreatePatternListingJob() {
  return useMutation({
    mutationFn: async ({ patternId, body }: { patternId: string; body: CreatePatternListingBody }) => {
      const result = await api.POST("/patterns/{patternId}/listing-jobs", { params: { path: { patternId } }, body });
      return { job: await unwrap(result), reused: result.response.status === 200 };
    },
  });
}

/** 花型衍生（改色）：确定性本地运算；同参数复用既有任务。 */
export function useCreatePatternDeriveJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ patternId, body }: { patternId: string; body: CreatePatternDeriveBody }) => {
      const result = await api.POST("/patterns/{patternId}/derive-jobs", { params: { path: { patternId } }, body });
      return { job: await unwrap(result), reused: result.response.status === 200 };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patterns });
    },
  });
}

/**
 * 生成式衍生（画风 / 构图）：付费生图，源花型作参考图；同参数复用既有任务。
 * 与改色分开两个 hook，因为一个零费用一个会产生调用，UI 需要分别标注。
 */
export function useCreatePatternVariantJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ patternId, body }: { patternId: string; body: CreatePatternVariantBody }) => {
      const result = await api.POST("/patterns/{patternId}/variant-jobs", { params: { path: { patternId } }, body });
      return { job: await unwrap(result), reused: result.response.status === 200 };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patterns });
    },
  });
}

/** 发起验缝：本地确定性判定，零费用、不改动图稿；同花型同算法版本复用既有任务。 */
export function useCreatePatternTileCheckJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ patternId }: { patternId: string }) => {
      const result = await api.POST("/patterns/{patternId}/tile-check-jobs", { params: { path: { patternId } } });
      return { job: await unwrap(result), reused: result.response.status === 200 };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patterns });
    },
  });
}

/** 重命名/改标签（PATCH /patterns/{patternId}），成功后失效花型列表。 */
export function useUpdatePattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patternId, body }: { patternId: string; body: UpdatePatternBody }) =>
      unwrap(api.PATCH("/patterns/{patternId}", { params: { path: { patternId } }, body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patterns });
    },
  });
}

/** Listing 结果查询：任务 SUCCEEDED 后才启用；结果端点在任务未成功时返回 404/409，禁用重试。 */
export function usePatternListingResult(patternId: string | undefined, jobId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.patternListingJob(patternId ?? "", jobId ?? ""),
    enabled: Boolean(patternId && jobId) && enabled,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => unwrap(api.GET("/patterns/{patternId}/listing-jobs/{jobId}/result", { params: { path: { patternId: patternId!, jobId: jobId! } } })),
  });
}

/** 流水线终态：不在这三个状态时轮询停止，终态即停。 */
function pipelineActive(pipeline: PatternPipeline): boolean {
  return pipeline.status === "QUEUED" || pipeline.status === "RUNNING" || pipeline.status === "AWAITING_INPUT";
}

/**
 * 花型的流水线收据列表，最新在前。
 *
 * AWAITING_INPUT 也算在途：它不是终态，用户裁决之后流水线会继续推进，所以轮询必须继续，
 * 否则裁决完成后的进度变化将永远不会出现在页面上。
 */
export function usePatternPipelines(patternId: string | undefined) {
  return useQuery({
    queryKey: qk.patternPipelines(patternId ?? ""),
    enabled: Boolean(patternId),
    staleTime: 0,
    queryFn: () => unwrap(api.GET("/patterns/{patternId}/pipelines", { params: { path: { patternId: patternId! } } })),
    refetchInterval: (query) => ((query.state.data?.items ?? []).some(pipelineActive) ? 1500 : false),
  });
}

/** 建链（三问一跑）：进行中的同参数流水线返回 200 复用，新建返回 202。 */
export function useCreatePatternPipeline(patternId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreatePatternPipelineBody) => {
      const result = await api.POST("/patterns/{patternId}/pipelines", { params: { path: { patternId } }, body });
      return { pipeline: await unwrap(result), reused: result.response.status === 200 };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patternPipelines(patternId) });
    },
  });
}

/**
 * 单步重跑。下游步骤会被一并重置（其结果基于旧输入），所以列表与相关领域记录都要重取。
 */
export function useRetryPatternPipelineStep(patternId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, step }: { pipelineId: string; step: PatternPipelineStepName }) =>
      unwrap(api.POST("/pattern-pipelines/{pipelineId}/steps/{step}/retry", { params: { path: { pipelineId, step } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patternPipelines(patternId) });
      void queryClient.invalidateQueries({ queryKey: qk.patterns });
    },
  });
}

/** AWAITING_INPUT 的裁决：改用居中版式继续，或明知有接缝仍出满印。 */
export function useContinuePatternPipeline(patternId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pipelineId, resolution }: { pipelineId: string; resolution: PatternPipelineResolution }) =>
      unwrap(api.POST("/pattern-pipelines/{pipelineId}/continue", { params: { path: { pipelineId } }, body: { resolution } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patternPipelines(patternId) });
    },
  });
}

/** 取消流水线：先断在途任务再落状态，服务端已保证顺序。 */
export function useCancelPatternPipeline(patternId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pipelineId: string) =>
      unwrap(api.POST("/pattern-pipelines/{pipelineId}/cancel", { params: { path: { pipelineId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patternPipelines(patternId) });
      void queryClient.invalidateQueries({ queryKey: qk.printPacks(patternId) });
    },
  });
}
