import { describe, expect, it } from "vitest";

import type { Output, StoryboardItem } from "../api/adapters/projectDetail";
import { groupOutputsByGenerationBatch, groupOutputsByItem } from "./review";

function output(id: string, itemId: string, createdAt: string): Output {
  return { id, storyboardItemId: itemId, jobId: `job-${id}`, url: `/files/outputs/${id}`, createdAt };
}

function item(id: string, assetType = "hero-image"): StoryboardItem {
  return {
    id,
    assetType,
    displayName: assetType === "hero-image" ? "白底/纯色底产品主图" : "场景化生活图",
    candidateCount: 1,
    mode: "CREATIVE",
    status: "CONFIRMED",
    promptInstruction: "p",
    factClaims: [],
    riskFlags: [],
  };
}

describe("groupOutputsByItem", () => {
  it("按分镜分组且组内按时间升序，忽略无输出的分镜", () => {
    const groups = groupOutputsByItem(
      [item("i1"), item("i2", "lifestyle-scene"), item("i3")],
      [output("o2", "i1", "2026-08-01T00:02:00.000Z"), output("o1", "i1", "2026-08-01T00:01:00.000Z"), output("o3", "i2", "2026-08-01T00:03:00.000Z")],
    );
    expect(groups.map((group) => group.item.id)).toEqual(["i1", "i2"]);
    expect(groups[0]?.outputs.map((entry) => entry.id)).toEqual(["o1", "o2"]);
  });
});

describe("groupOutputsByGenerationBatch", () => {
  it("按首次生成批次分组，重试仍留在原批次并按最新批次置顶", () => {
    const groups = groupOutputsByGenerationBatch(
      [item("i1"), item("i2", "lifestyle-scene")],
      [
        { ...output("o1", "i1", "2026-08-01T00:10:00.000Z"), jobId: "j1", generationBatchId: "b1" },
        { ...output("o2", "i1", "2026-08-01T00:11:00.000Z"), jobId: "j2", generationBatchId: "b1", generationSnapshot: { revision: "retry" } },
        { ...output("o3", "i2", "2026-08-02T00:10:00.000Z"), jobId: "j3", generationBatchId: "b2" },
      ],
      [
        { id: "j1", type: "GENERATE", status: "SUCCEEDED", progress: 100, retryable: false, createdAt: "2026-08-01T00:00:00.000Z" },
        { id: "j2", type: "GENERATE", status: "SUCCEEDED", progress: 100, retryable: false, createdAt: "2026-08-01T00:05:00.000Z" },
        { id: "j3", type: "GENERATE", status: "SUCCEEDED", progress: 100, retryable: false, createdAt: "2026-08-02T00:00:00.000Z" },
      ],
    );
    expect(groups.map((group) => group.id)).toEqual(["b2", "b1"]);
    expect(groups[1]).toMatchObject({ retryCount: 1 });
    expect(groups[1]?.groups[0]?.outputs.map((entry) => entry.id)).toEqual(["o1", "o2"]);
  });
});
