import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adaptSuites, type SuiteFileInput, type SuiteOriginCounts, type SuitePageFilters, type SuiteSummary } from "../adapters/suites";
import { api, unwrap } from "../client";
import { qk } from "../queryKeys";

const PAGE_SIZE = 40;

export interface SuitePage {
  items: SuiteSummary[];
  nextCursor: string | null;
  /** 当前来源区间内的总数；来源是库范围开关，所以它跟随 origin 收窄。 */
  total: number;
  l1Counts: Record<string, number>;
  /** 全库按来源的库存，与筛选无关：来源切换控件用它显示计数，不随搜索变化。 */
  originCounts: SuiteOriginCounts;
}

/**
 * 套图编目分页查询：检索、品类与来源筛选都在服务端完成，前端只累积已加载的页。
 * 切换品类/来源或关键词时保留上一批结果（placeholderData），避免整屏闪成骨架屏；
 * 变更后统一失效由 mutation 触发，前缀失效会同时覆盖分页与摘要回读。
 */
export function useSuitePage(filters: SuitePageFilters, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: qk.suitePages(filters),
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<SuitePage> => {
      const raw = await unwrap(
        api.GET("/suites", {
          params: {
            query: {
              ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
              ...(filters.l1 ? { l1: filters.l1 } : {}),
              ...(filters.l2 ? { l2: filters.l2 } : {}),
              ...(filters.origin ? { origin: filters.origin } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
              limit: PAGE_SIZE,
            },
          },
        }),
      );
      return { items: adaptSuites(raw), nextCursor: raw.nextCursor ?? null, total: raw.total ?? 0, l1Counts: raw.l1Counts ?? {}, originCounts: raw.originCounts ?? { builtin: 0, user: 0 } };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

/** 按 ID 精确回读套图摘要：只服务已选分镜的名称解析，未选择时不发请求。 */
export function useSuiteSummaries(suiteIds: readonly string[]) {
  const idsKey = [...suiteIds].sort().join(",");
  return useQuery({
    queryKey: qk.suiteSummaries(idsKey),
    enabled: suiteIds.length > 0,
    queryFn: async () => adaptSuites(await unwrap(api.GET("/suites", { params: { query: { ids: idsKey } } }))),
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
    mutationFn: async () => {
      await unwrap(api.POST("/suites/refresh"));
    },
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
