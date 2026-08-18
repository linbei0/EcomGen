import type { Job } from "../api/adapters/projectDetail";

/** 取项目中最近一条规划任务，供规划面板锁定与进度卡使用。 */
export function latestPlanJob(jobs: readonly Job[]): Job | undefined {
  const plans = jobs.filter((job) => job.type === "PLAN");
  if (plans.length === 0) return undefined;
  return plans.reduce((latest, job) => (job.createdAt > latest.createdAt ? job : latest));
}

export function isActiveJob(job: Job | undefined): boolean {
  return job?.status === "QUEUED" || job?.status === "RUNNING";
}

export function canResubmitPlan(job: Job | undefined): boolean {
  return !job || job.status === "FAILED" || job.status === "CANCELLED";
}
