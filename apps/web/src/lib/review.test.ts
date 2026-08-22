import { describe, expect, it } from "vitest";

import type { Output, StoryboardItem } from "../api/adapters/projectDetail";
import { groupOutputsByItem } from "./review";

function output(id: string, itemId: string, createdAt: string): Output {
  return { id, storyboardItemId: itemId, url: `/files/outputs/${id}`, createdAt };
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
