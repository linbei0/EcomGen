import { describe, expect, it } from "vitest";

import type { Job } from "../api/adapters/projectDetail";
import { jobErrorText } from "./jobError";

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "j1",
    type: "PLAN",
    status: "FAILED",
    progress: 40,
    retryable: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    error: null,
    ...overrides,
  };
}

describe("jobErrorText", () => {
  it("失败任务读取 message 与 requestId", () => {
    expect(jobErrorText(job({ status: "RUNNING" }))).toBeNull();
    expect(
      jobErrorText(
        job({
          error: { message: "模型超时", requestId: "req-9" } as unknown as Job["error"],
        }),
      ),
    ).toBe("模型超时（请求 ID：req-9）");
    expect(jobErrorText(job({ error: {} as Job["error"] }))).toBe("任务失败");
  });
});
