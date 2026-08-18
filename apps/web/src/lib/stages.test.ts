import { describe, expect, it } from "vitest";

import type { ProjectDetail } from "../api/adapters/projectDetail";
import { completedStages, deriveStage, parseStage } from "./stages";

function detail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: "p1",
    name: "demo",
    platformTargets: ["DOMESTIC"],
    reasoningProviderId: "r",
    reasoningModelId: "m",
    imageProviderId: "i",
    imageModelId: "img",
    defaultMode: "CREATIVE",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    variants: [],
    assets: [],
    storyboard: null,
    items: [],
    outputs: [],
    jobs: [],
    ...overrides,
  };
}

describe("stages", () => {
  it("非法 stage 回退到 fallback", () => {
    expect(parseStage("nope", "plan")).toBe("plan");
    expect(parseStage("review", "assets")).toBe("review");
  });

  it("按数据推导当前阶段与已完成集合", () => {
    expect(deriveStage(detail())).toBe("assets");
    expect(deriveStage(detail({ assets: [{ id: "a" } as ProjectDetail["assets"][number]] }))).toBe("assets");
    expect(
      deriveStage(
        detail({
          storyboard: { projectId: "p1", version: 1, status: "DRAFT", campaignStyleLock: "", items: [] },
        }),
      ),
    ).toBe("plan");
    expect(
      deriveStage(
        detail({
          storyboard: { projectId: "p1", version: 1, status: "CONFIRMED", campaignStyleLock: "", items: [] },
        }),
      ),
    ).toBe("storyboard");

    const done = completedStages(
      detail({
        assets: [{ id: "a" } as ProjectDetail["assets"][number]],
        outputs: [{ reviewDecision: "SELECTED" } as ProjectDetail["outputs"][number]],
      }),
    );
    expect(done.has("assets")).toBe(true);
    expect(done.has("generate")).toBe(true);
    expect(done.has("review")).toBe(true);
  });
});
