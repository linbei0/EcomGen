import { describe, expect, it } from "vitest";

import type { ProjectDetail } from "../api/adapters/projectDetail";
import { completedViews, deriveView, parseView } from "./stages";

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
    imageResolution: "1K",
    imageAspectRatio: "AUTO",
    candidatesPerType: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    assets: [],
    storyboard: null,
    items: [],
    outputs: [],
    jobs: [],
    ...overrides,
  };
}

describe("views", () => {
  it("兼容旧 stage 参数并回退未知值", () => {
    expect(parseView("nope", "setup")).toBe("setup");
    expect(parseView("assets", "results")).toBe("setup");
    expect(parseView("plan", "results")).toBe("setup");
    expect(parseView("storyboard", "setup")).toBe("storyboard");
    expect(parseView("generate", "setup")).toBe("results");
    expect(parseView("review", "setup")).toBe("results");
    expect(parseView("export", "setup")).toBe("results");
  });

  it("按数据推导当前视图与已完成集合", () => {
    expect(deriveView(detail())).toBe("setup");
    expect(deriveView(detail({ assets: [{ id: "a" } as ProjectDetail["assets"][number]] }))).toBe("setup");
    expect(
      deriveView(
        detail({
          storyboard: { projectId: "p1", version: 1, status: "DRAFT", campaignStyleLock: "", items: [] },
        }),
      ),
    ).toBe("storyboard");
    expect(
      deriveView(
        detail({
          outputs: [{ id: "o" } as ProjectDetail["outputs"][number]],
        }),
      ),
    ).toBe("results");

    const done = completedViews(
      detail({
        assets: [{ id: "a" } as ProjectDetail["assets"][number]],
        storyboard: { projectId: "p1", version: 1, status: "DRAFT", campaignStyleLock: "", items: [] },
        outputs: [{ reviewDecision: "SELECTED" } as ProjectDetail["outputs"][number]],
      }),
    );
    expect(done.has("setup")).toBe(true);
    expect(done.has("storyboard")).toBe(true);
    expect(done.has("results")).toBe(true);
  });
});
