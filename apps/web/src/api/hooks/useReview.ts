import { useMutation, useQueryClient } from "@tanstack/react-query";

import { adaptOutput, type ProjectDetail } from "../adapters/projectDetail";
import { api } from "../client";
import { ApiError } from "../errors";
import { qk } from "../queryKeys";
import type { ReviewDecision } from "../../lib/review";
import { applyDecision } from "../../lib/review";

/**
 * OpenAPI 请求体为 decision/note，运行时 handler 读 reviewDecision/reviewNote。
 * 双写以保持类型检查并让本机 API 生效（契约漂移，不改后端）。
 */
function serializeReviewBody(input: { decision: ReviewDecision; note?: string }): string {
  return JSON.stringify({
    decision: input.decision,
    note: input.note,
    reviewDecision: input.decision,
    reviewNote: input.note ?? null,
  });
}

export function useReviewOutput(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ outputId, decision }: { outputId: string; decision: ReviewDecision }) => {
      const { data, response } = await api.PATCH("/outputs/{outputId}/review", {
        params: { path: { outputId } },
        body: { decision },
        bodySerializer: () => serializeReviewBody({ decision }),
      });
      const raw = data ?? (response.ok ? await response.clone().json() : undefined);
      const output = adaptOutput(raw);
      if (!output) {
        throw new ApiError({ code: "UNKNOWN", message: "审核响应无法解析", status: response.status });
      }
      return output;
    },
    onMutate: async ({ outputId, decision }) => {
      await queryClient.cancelQueries({ queryKey: qk.project(projectId) });
      const previous = queryClient.getQueryData<ProjectDetail>(qk.project(projectId));
      if (previous) {
        queryClient.setQueryData<ProjectDetail>(qk.project(projectId), {
          ...previous,
          outputs: applyDecision(previous.outputs, outputId, decision),
        });
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(qk.project(projectId), context.previous);
      }
      return error;
    },
    onSuccess: (output) => {
      const current = queryClient.getQueryData<ProjectDetail>(qk.project(projectId));
      if (current) {
        queryClient.setQueryData<ProjectDetail>(qk.project(projectId), {
          ...current,
          outputs: current.outputs.map((entry) => (entry.id === output.id ? output : entry)),
        });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}
