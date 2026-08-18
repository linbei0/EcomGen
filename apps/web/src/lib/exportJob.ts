import type { Export, Job } from "../api/adapters/projectDetail";

/** 导出阶段只允许 SELECTED；其余决策不计入也不可选。 */
export function exportableOutputs(outputs: readonly { id: string; reviewDecision: string }[]): string[] {
  return outputs.filter((output) => output.reviewDecision === "SELECTED").map((output) => output.id);
}

export function latestExportJob(jobs: readonly Job[]): Job | undefined {
  const exportsJobs = jobs
    .filter((job) => job.type === "EXPORT")
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return exportsJobs[0];
}

export function isActiveExport(job: Job | undefined): boolean {
  return job?.status === "QUEUED" || job?.status === "RUNNING";
}

export function exportSucceeded(record: Export | undefined | null): record is Export {
  return record?.status === "SUCCEEDED";
}
