import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adaptSuites, type SuiteFileInput } from "../adapters/suites";
import { api, unwrap } from "../client";
import { qk } from "../queryKeys";

/** 套图编目由服务端合并内置、目录投放与导入套图；变更后统一失效由 mutation 触发。 */
export function useSuites() {
  return useQuery({
    queryKey: qk.suites,
    queryFn: async () => adaptSuites(await unwrap(api.GET("/suites"))),
    staleTime: 5 * 60_000,
  });
}

export function useSuite(suiteId: string | undefined) {
  return useQuery({
    queryKey: qk.suite(suiteId ?? ""),
    queryFn: async () => unwrap(api.GET("/suites/{suiteId}", { params: { path: { suiteId: suiteId ?? "" } } })),
    enabled: Boolean(suiteId),
    staleTime: 5 * 60_000,
  });
}

export function useSuiteCategories() {
  return useQuery({
    queryKey: qk.suiteCategories,
    queryFn: async () => unwrap(api.GET("/suite-categories")),
    staleTime: 30 * 60_000,
  });
}

export function useRefreshSuites() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => adaptSuites(await unwrap(api.POST("/suites/refresh"))),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.suites }),
  });
}

export function useCreateUserSuite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SuiteFileInput) => unwrap(api.POST("/suites", { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.suites }),
  });
}

export function useUpdateUserSuite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ suiteId, body }: { suiteId: string; body: SuiteFileInput }) =>
      unwrap(api.PATCH("/suites/{suiteId}", { params: { path: { suiteId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.suites }),
  });
}

export function useDeleteUserSuite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (suiteId: string) => {
      await api.DELETE("/suites/{suiteId}", { params: { path: { suiteId } } });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.suites }),
  });
}
