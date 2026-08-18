import { describe, expect, it } from "vitest";

import type { Job } from "../api/adapters/projectDetail";
import { canResubmitPlan, latestPlanJob } from "./planJob";

function job(overrides: Partial<Job>): Job {
  return {
    id: "j",
    type: "PLAN",
    status: "QUEUED",
    progress: 0,
    retryable: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("latestPlanJob", () => {
  it("返回创建时间最晚的 PLAN 任务", () => {
    expect(latestPlanJob([])).toBeUndefined();
    const latest = latestPlanJob([
      job({ id: "old", createdAt: "2026-08-01T00:00:00.000Z" }),
      job({ id: "gen", type: "GENERATE", createdAt: "2026-08-02T00:00:00.000Z" }),
      job({ id: "new", createdAt: "2026-08-01T12:00:00.000Z" }),
    ]);
    expect(latest?.id).toBe("new");
  });

  it("失败或取消后允许重新提交", () => {
    expect(canResubmitPlan(undefined)).toBe(true);
    expect(canResubmitPlan(job({ status: "FAILED" }))).toBe(true);
    expect(canResubmitPlan(job({ status: "RUNNING" }))).toBe(false);
    expect(canResubmitPlan(job({ status: "SUCCEEDED" }))).toBe(false);
  });
});
