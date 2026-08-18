import { describe, expect, it } from "vitest";

import type { Job } from "../api/adapters/projectDetail";
import { exportableOutputs, isActiveExport, latestExportJob } from "./exportJob";

function job(overrides: Partial<Job>): Job {
  return {
    id: "j",
    type: "EXPORT",
    status: "QUEUED",
    progress: 0,
    retryable: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("exportableOutputs", () => {
  it("只保留 SELECTED 的输出 ID", () => {
    expect(
      exportableOutputs([
        { id: "o1", reviewDecision: "SELECTED" },
        { id: "o2", reviewDecision: "REJECTED" },
        { id: "o3", reviewDecision: "NEEDS_REVIEW" },
        { id: "o4", reviewDecision: "SELECTED" },
      ]),
    ).toEqual(["o1", "o4"]);
  });
});

describe("latestExportJob", () => {
  it("取创建时间最新的 EXPORT 任务", () => {
    expect(latestExportJob([])).toBeUndefined();
    const latest = latestExportJob([
      job({ id: "old", createdAt: "2026-08-01T00:00:00.000Z" }),
      job({ id: "gen", type: "GENERATE", createdAt: "2026-08-02T00:00:00.000Z" }),
      job({ id: "new", createdAt: "2026-08-01T12:00:00.000Z" }),
    ]);
    expect(latest?.id).toBe("new");
    expect(isActiveExport(job({ status: "RUNNING" }))).toBe(true);
    expect(isActiveExport(job({ status: "SUCCEEDED" }))).toBe(false);
  });
});
