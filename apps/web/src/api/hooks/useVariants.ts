import { useMutation, useQueryClient } from "@tanstack/react-query";

import { adaptVariant, type CreateVariantInput } from "../adapters/projectDetail";
import { ApiError } from "../errors";
import { api, unwrap } from "../client";
import { qk } from "../queryKeys";

export function useCreateVariant(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateVariantInput) => {
      const raw = await unwrap(
        api.POST("/projects/{projectId}/variants", {
          params: { path: { projectId } },
          body,
        }),
      );
      const variant = adaptVariant(raw);
      if (!variant) {
        throw new ApiError({ code: "UNKNOWN", message: "变体响应无法解析", status: 0 });
      }
      return variant;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}
