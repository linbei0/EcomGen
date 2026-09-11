import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { adaptLibraryItem, type LibraryFilters, type LibraryItem } from "../adapters/library";
import { adaptAsset, type UserAssetKind } from "../adapters/projectDetail";
import { api, unwrap } from "../client";
import { ApiError } from "../errors";
import { qk } from "../queryKeys";

const PAGE_SIZE = 40;

/** 资产库分页查询：kind/q 变化即新查询；游标由服务端 (createdAt,id) 合成。 */
export function useLibraryItems(filters: LibraryFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.libraryAssets(filters),
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const raw = await unwrap(
        api.GET("/library-assets", {
          params: {
            query: {
              ...(filters.kind !== "ALL" ? { kind: filters.kind } : {}),
              ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
              limit: PAGE_SIZE,
            },
          },
        }),
      );
      return {
        items: (raw.items ?? []).map(adaptLibraryItem).filter((item): item is LibraryItem => item !== null),
        nextCursor: raw.nextCursor ?? null,
        total: raw.total ?? 0,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** 从资产库复制图片进项目：服务端复制物理文件，保持项目资产自持不共享路径。 */
export function useCopyLibraryAssetToProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, itemId, kind }: { projectId: string; itemId: string; kind: UserAssetKind }) => {
      const raw = await unwrap(
        api.POST("/projects/{projectId}/assets/from-library", {
          params: { path: { projectId } },
          body: { itemId, kind },
        }),
      );
      const asset = adaptAsset(raw);
      if (!asset) {
        throw new ApiError({ code: "UNKNOWN", message: "复制响应无法解析", status: 0 });
      }
      return asset;
    },
    onSuccess: (_asset, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}
