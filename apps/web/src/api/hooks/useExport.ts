import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  adaptExport,
  adaptExportJobBundle,
  type Export,
  type ExportJobBundle,
  type Job,
} from "../adapters/projectDetail";
import { api, unwrap } from "../client";
import { ApiError } from "../errors";
import { qk } from "../queryKeys";
import type { components } from "../schema.d.ts";

export type CreateExportJobInput = components["schemas"]["CreateExportJobInput"];

export function useCreateExportJob(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExportJobInput): Promise<ExportJobBundle> => {
      const { data, response } = await api.POST("/projects/{projectId}/export-jobs", {
        params: { path: { projectId } },
        body: input,
      });
      const raw = data ?? (response.ok ? await response.clone().json() : undefined);
      const bundle = adaptExportJobBundle(raw);
      if (!bundle.job) {
        throw new ApiError({ code: "UNKNOWN", message: "导出任务响应无法解析", status: response.status });
      }
      return bundle;
    },
    onSuccess: (bundle) => {
      if (bundle.job) queryClient.setQueryData(qk.job(bundle.job.id), bundle.job);
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.exports(projectId) });
    },
  });
}

export function useExport(exportId: string | undefined) {
  return useQuery({
    queryKey: ["exports", exportId ?? ""] as const,
    enabled: Boolean(exportId),
    queryFn: async (): Promise<Export> => {
      const raw = await unwrap(
        api.GET("/exports/{exportId}", { params: { path: { exportId: exportId! } } }),
      );
      const record = adaptExport(raw);
      if (!record) {
        throw new ApiError({ code: "UNKNOWN", message: "导出记录无法解析", status: 0 });
      }
      return record;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "QUEUED" || status === "RUNNING" ? 2000 : false;
    },
  });
}

/** 导出列表从项目详情嵌套拿（无独立 GET exports 路由）。 */
export function exportJobs(detail: { jobs: Job[] } | undefined): Job[] {
  return (detail?.jobs ?? [])
    .filter((job) => job.type === "EXPORT")
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
