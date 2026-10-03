import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "../client";
import { qk } from "../queryKeys";
import type { components } from "../schema.d.ts";

export type PatternDraft = components["schemas"]["PatternDraft"];
export type PatternDraftList = components["schemas"]["PatternDraftList"];
export type DraftConditions = components["schemas"]["DraftConditions"];
export type DraftMedia = components["schemas"]["DraftMedia"];
export type DraftMediaRole = components["schemas"]["DraftMediaRole"];
export type DraftBatch = components["schemas"]["DraftBatch"];
export type DraftSlot = components["schemas"]["DraftSlot"];
export type DraftCandidate = components["schemas"]["DraftCandidate"];
export type DraftBatchOperation = components["schemas"]["DraftBatchOperation"];
export type DraftComposeType = components["schemas"]["DraftComposeType"];
export type DraftSeamEdge = components["schemas"]["DraftSeamEdge"];
export type DraftRecolorParams = components["schemas"]["DraftRecolorParams"];
export type CreatePatternDraftBody = components["schemas"]["CreatePatternDraftInput"];
export type UpdatePatternDraftBody = components["schemas"]["UpdatePatternDraftInput"];
export type CreateDraftBatchBody = components["schemas"]["CreateDraftBatchInput"];
export type FinalizeDraftCandidateBody = components["schemas"]["FinalizeDraftCandidateInput"];
export type FinalizeDraftCandidateResponse = components["schemas"]["FinalizeDraftCandidateResponse"];
export type DraftJobRef = components["schemas"]["DraftJobRef"];

/** 草稿列表：默认只看活跃草稿；归档草稿由页面显式请求。 */
export function usePatternDrafts(includeArchived = false) {
  return useQuery({
    queryKey: [...qk.patternDrafts, { archived: includeArchived }] as const,
    queryFn: () => unwrap(api.GET("/pattern-drafts", { params: { query: includeArchived ? { archived: true } : {} } })),
  });
}

export function usePatternDraft(draftId: string | undefined) {
  return useQuery({
    queryKey: qk.patternDraft(draftId ?? ""),
    enabled: Boolean(draftId),
    queryFn: () => unwrap(api.GET("/pattern-drafts/{draftId}", { params: { path: { draftId: draftId! } } })),
  });
}

export function useCreatePatternDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePatternDraftBody) => unwrap(api.POST("/pattern-drafts", { body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patternDrafts });
    },
  });
}

/** 自动保存。409 冲突由调用方处理：保留本地未提交内容，提示重新加载/合并。 */
export function useUpdatePatternDraft(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePatternDraftBody) => unwrap(api.PATCH("/pattern-drafts/{draftId}", { params: { path: { draftId } }, body })),
    onSuccess: (draft) => {
      queryClient.setQueryData(qk.patternDraft(draftId), draft);
    },
  });
}

export function useDeletePatternDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draftId: string) => unwrap(api.DELETE("/pattern-drafts/{draftId}", { params: { path: { draftId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patternDrafts });
    },
  });
}

export function useDraftMedia(draftId: string | undefined) {
  return useQuery({
    queryKey: qk.draftMedia(draftId ?? ""),
    enabled: Boolean(draftId),
    queryFn: () => unwrap(api.GET("/pattern-drafts/{draftId}/media", { params: { path: { draftId: draftId! } } })),
  });
}

export function useCreateDraftMedia(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { file?: File; role: DraftMediaRole; source?: "UPLOAD" | "PATTERN"; patternId?: string; notes?: string }) => {
      const form = new FormData();
      if (input.file) form.append("file", input.file, input.file.name);
      form.append("role", input.role);
      if (input.source) form.append("source", input.source);
      if (input.patternId) form.append("patternId", input.patternId);
      if (input.notes) form.append("notes", input.notes);
      return unwrap(api.POST("/pattern-drafts/{draftId}/media", {
        params: { path: { draftId } },
        body: { role: input.role, file: undefined as unknown as string },
        bodySerializer: () => form,
      }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.draftMedia(draftId) });
    },
  });
}

export function useUpdateDraftMedia(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mediaId, body }: { mediaId: string; body: { notes?: string } }) =>
      unwrap(api.PATCH("/pattern-drafts/{draftId}/media/{mediaId}", { params: { path: { draftId, mediaId } }, body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.draftMedia(draftId) });
    },
  });
}

export function useDeleteDraftMedia(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mediaId: string) => unwrap(api.DELETE("/pattern-drafts/{draftId}/media/{mediaId}", { params: { path: { draftId, mediaId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.draftMedia(draftId) });
    },
  });
}

/** 活跃批次按需轮询：任何槽位仍在 QUEUED/RUNNING 时刷新批次，全部终态后停止。候选由 useDraftCandidates 独立追平。 */
export function useDraftBatches(draftId: string | undefined) {
  return useQuery({
    queryKey: qk.draftBatches(draftId ?? ""),
    enabled: Boolean(draftId),
    queryFn: () => unwrap(api.GET("/pattern-drafts/{draftId}/batches", { params: { path: { draftId: draftId! } } })),
    refetchInterval: (query) => {
      const batches = query.state.data?.items ?? [];
      return batches.some((batch) => batch.slots.some((slot) => slot.status === "QUEUED" || slot.status === "RUNNING")) ? 1500 : false;
    },
  });
}

/**
 * 候选按需轮询：以"已成功槽位数"为应到候选数，候选少于应到数时继续拉取，追平后停止。
 *
 * 不能用"还有没有 QUEUED/RUNNING 槽位"判断——最后一个槽位转终态时这个信号立刻变假，
 * 若候选恰好在最后一次轮询之后写库，轮询就此停止且永不再拉，表现为"生成成功却不回显"。
 * 以应到数是否追平为准，漏拉最多持续一个轮询周期，且不会在无待拉候选时空转。
 */
export function useDraftCandidates(draftId: string | undefined, expectedCount: number) {
  return useQuery({
    queryKey: qk.draftCandidates(draftId ?? ""),
    enabled: Boolean(draftId),
    queryFn: () => unwrap(api.GET("/pattern-drafts/{draftId}/candidates", { params: { path: { draftId: draftId! } } })),
    refetchInterval: (query) => ((query.state.data?.items.length ?? 0) < expectedCount ? 2000 : false),
  });
}

export function useCreateDraftBatch(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDraftBatchBody) => unwrap(api.POST("/pattern-drafts/{draftId}/batches", { params: { path: { draftId } }, body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.draftBatches(draftId) });
      void queryClient.invalidateQueries({ queryKey: qk.draftCandidates(draftId) });
    },
  });
}

export function useCreateDraftEdit(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ candidateId, body }: { candidateId: string; body: CreateDraftBatchBody }) =>
      unwrap(api.POST("/pattern-drafts/{draftId}/candidates/{candidateId}/edits", { params: { path: { draftId, candidateId } }, body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.draftBatches(draftId) });
      void queryClient.invalidateQueries({ queryKey: qk.draftCandidates(draftId) });
    },
  });
}

export function useRetryDraftBatch(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => unwrap(api.POST("/pattern-drafts/{draftId}/batches/{batchId}/retry-failed", { params: { path: { draftId, batchId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.draftBatches(draftId) });
      void queryClient.invalidateQueries({ queryKey: qk.draftCandidates(draftId) });
    },
  });
}

/** 删除单个候选：候选是探索结果，允许清理不要的那几张。 */
export function useDeleteDraftCandidate(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (candidateId: string) => unwrap(api.DELETE("/pattern-drafts/{draftId}/candidates/{candidateId}", { params: { path: { draftId, candidateId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.draftCandidates(draftId) });
      void queryClient.invalidateQueries({ queryKey: qk.draftBatches(draftId) });
      void queryClient.invalidateQueries({ queryKey: qk.patternDraft(draftId) });
      void queryClient.invalidateQueries({ queryKey: qk.patternDrafts });
    },
  });
}

/** 验缝：本地确定性任务，完成后候选上的判定与逐轴证据会被刷新回来。 */
export function useDraftTileCheck(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (candidateId: string) => unwrap(api.POST("/pattern-drafts/{draftId}/candidates/{candidateId}/tile-check", { params: { path: { draftId, candidateId } } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.draftCandidates(draftId) });
    },
  });
}

/** 定稿：把选定候选复制进正式花型库；同候选重复定稿返回已有花型，不启动生产。 */
export function useFinalizeDraftCandidate(draftId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ candidateId, body }: { candidateId: string; body: FinalizeDraftCandidateBody }) => {
      const result = await api.POST("/pattern-drafts/{draftId}/candidates/{candidateId}/finalize", { params: { path: { draftId, candidateId } }, body });
      const data = await unwrap(result);
      return { pattern: data.pattern, reused: data.reused || result.response.status === 200 };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.patterns });
      void queryClient.invalidateQueries({ queryKey: qk.patternDraft(draftId) });
    },
  });
}
