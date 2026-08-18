import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "../client";
import { qk } from "../queryKeys";
import type { components, operations } from "../schema.d.ts";

export type ProviderConfig = components["schemas"]["ProviderConfig"];
export type ModelCapability = components["schemas"]["ModelCapability"];
export type CreateProviderInput = components["schemas"]["CreateProviderInput"];
export type TestProviderResult =
  operations["testProviderConnection"]["responses"]["200"]["content"]["application/json"];

export interface TestProviderVariables {
  providerId: string;
  modelId: string;
  kind: "reasoning" | "image";
}

export function useProviders() {
  return useQuery({
    queryKey: qk.providers,
    queryFn: () => unwrap(api.GET("/providers")),
    staleTime: 30_000,
  });
}

export function useCreateProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProviderInput) => unwrap(api.POST("/providers", { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.providers }),
  });
}

/** 契约缺口 13.12：UpdateProviderInput 目前强制 apiKey，表单必须重新输入。 */
export function useUpdateProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, body }: { providerId: string; body: CreateProviderInput }) =>
      unwrap(api.PATCH("/providers/{providerId}", { params: { path: { providerId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.providers }),
  });
}

export function useDeleteProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (providerId: string) => {
      await api.DELETE("/providers/{providerId}", { params: { path: { providerId } } });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.providers }),
  });
}

/** 仅调 Provider 的 /models 探测连通性，不消耗生图额度（契约 testProviderConnection）。 */
export function useTestProvider() {
  return useMutation({
    mutationFn: ({ providerId, modelId, kind }: TestProviderVariables) =>
      unwrap(
        api.POST("/providers/{providerId}/test", {
          params: { path: { providerId } },
          body: { modelId, kind },
        }),
      ),
  });
}
