import { describe, expect, it } from "vitest";

import type { Job, StoryboardItem } from "../api/adapters/projectDetail";
import {
  activeGenerateJobs,
  isSelectableItem,
  modeCounts,
  ungeneratedItems,
} from "./generateSelection";

function item(overrides: Partial<StoryboardItem>): StoryboardItem {
  return {
    id: "i",
    assetType: "hero-image",
    displayName: "白底/纯色底产品主图",
    candidateCount: 1,
    mode: "CREATIVE",
    status: "CONFIRMED",
    promptInstruction: "x",
    riskFlags: [],
    ...overrides,
  };
}

describe("generateSelection", () => {
  it("仅 CONFIRMED 与 GENERATED 可选，全选未生成不含已生成", () => {
    const draft = item({ id: "d", status: "DRAFT" });
    const confirmed = item({ id: "c", status: "CONFIRMED" });
    const generated = item({ id: "g", status: "GENERATED", mode: "PIXEL_PROTECTED" });
    expect(isSelectableItem(draft)).toBe(false);
    expect(isSelectableItem(confirmed)).toBe(true);
    expect(isSelectableItem(generated)).toBe(true);
    expect(ungeneratedItems([draft, confirmed, generated]).map((entry) => entry.id)).toEqual(["c"]);
    expect(modeCounts([confirmed, generated])).toEqual({ creative: 1, protected: 1 });
  });

  it("进行中的生成任务不含已结束项", () => {
    const jobs: Job[] = [
      {
        id: "old",
        type: "GENERATE",
        status: "SUCCEEDED",
        progress: 100,
        retryable: false,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "live",
        type: "GENERATE",
        status: "RUNNING",
        progress: 20,
        retryable: false,
        createdAt: "2026-08-01T01:00:00.000Z",
      },
      {
        id: "plan",
        type: "PLAN",
        status: "RUNNING",
        progress: 10,
        retryable: false,
        createdAt: "2026-08-01T02:00:00.000Z",
      },
    ];
    expect(activeGenerateJobs(jobs).map((job) => job.id)).toEqual(["live"]);
  });
});
