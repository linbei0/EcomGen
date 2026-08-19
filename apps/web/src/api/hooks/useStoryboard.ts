import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  adaptStoryboard,
  adaptStoryboardBundle,
  adaptStoryboardItem,
  type StoryboardItem,
} from "../adapters/projectDetail";
import { api, unwrap } from "../client";
import { ApiError } from "../errors";
import { qk } from "../queryKeys";
import type { components } from "../schema.d.ts";

export type UpdateStoryboardItemInput = components["schemas"]["UpdateStoryboardItemInput"];

export function useStoryboard(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.storyboard(projectId ?? ""),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const raw = await unwrap(
        api.GET("/projects/{projectId}/storyboard", { params: { path: { projectId: projectId! } } }),
      );
      return adaptStoryboardBundle(raw);
    },
  });
}

export function useUpdateStoryboardItem(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, body }: { itemId: string; body: UpdateStoryboardItemInput }) => {
      const raw = await unwrap(
        api.PATCH("/storyboard-items/{itemId}", { params: { path: { itemId } }, body }),
      );
      const item = adaptStoryboardItem(raw);
      if (!item) {
        throw new ApiError({ code: "UNKNOWN", message: "分镜更新响应无法解析", status: 0 });
      }
      return item;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.storyboard(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}

export function useDeleteStoryboardItem(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      await api.DELETE("/storyboard-items/{itemId}", { params: { path: { itemId } } });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.storyboard(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}

export function useConfirmStoryboard(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (version: number) => {
      const raw = await unwrap(
        api.POST("/projects/{projectId}/storyboard/confirm", {
          params: { path: { projectId } },
          body: { version },
        }),
      );
      const storyboard = adaptStoryboard(raw);
      if (!storyboard) {
        throw new ApiError({ code: "UNKNOWN", message: "确认分镜响应无法解析", status: 0 });
      }
      return storyboard;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.storyboard(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}

export function selectedStoryboardItem(
  items: StoryboardItem[],
  itemId: string | null,
): StoryboardItem | undefined {
  if (!itemId) return items[0];
  return items.find((item) => item.id === itemId) ?? items[0];
}
