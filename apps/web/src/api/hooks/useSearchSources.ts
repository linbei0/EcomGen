import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "../client";
import { qk } from "../queryKeys";
import type { components } from "../schema.d.ts";

export type SearchSourceConfig = components["schemas"]["SearchSourceConfig"];
export type SearchSourceInput = components["schemas"]["CreateSearchSourceInput"];

export function useSearchSources() {
  return useQuery({ queryKey: qk.searchSources, queryFn: () => unwrap(api.GET("/search-sources")) });
}

export function useCreateSearchSource() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (body: SearchSourceInput) => unwrap(api.POST("/search-sources", { body })), onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.searchSources }) });
}

export function useUpdateSearchSource() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ sourceId, body }: { sourceId: string; body: Partial<SearchSourceInput> }) => unwrap(api.PATCH("/search-sources/{sourceId}", { params: { path: { sourceId } }, body })), onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.searchSources }) });
}

export function useDeleteSearchSource() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: async (sourceId: string) => { await api.DELETE("/search-sources/{sourceId}", { params: { path: { sourceId } } }); }, onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.searchSources }) });
}
