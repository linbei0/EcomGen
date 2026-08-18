import { useMutation, useQueryClient } from "@tanstack/react-query";

import { adaptJob, type Job } from "../adapters/projectDetail";
import { api } from "../client";
import { ApiError } from "../errors";
import { qk } from "../queryKeys";
import type { GenerationJobInput } from "../serializeGenerationBody";
import { serializeGenerationBody } from "../serializeGenerationBody";

function readJobs(raw: unknown): Job[] {
  const record = raw && typeof raw === "object" ? (raw as { jobs?: unknown }) : {};
  const list = Array.isArray(record.jobs) ? record.jobs : [];
  const jobs = list.map(adaptJob).filter((job): job is Job => job !== null);
  if (jobs.length === 0) {
    throw new ApiError({ code: "UNKNOWN", message: "生成任务响应无法解析", status: 0 });
  }
  return jobs;
}

export function useCreateGenerationJobs(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: GenerationJobInput): Promise<Job[]> => {
      const { data, response } = await api.POST("/projects/{projectId}/generation-jobs", {
        params: { path: { projectId } },
        body: input,
        bodySerializer: serializeGenerationBody,
      });
      const raw = data ?? (response.ok ? await response.clone().json() : undefined);
      return readJobs(raw);
    },
    onSuccess: (jobs) => {
      for (const job of jobs) queryClient.setQueryData(qk.job(job.id), job);
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}
