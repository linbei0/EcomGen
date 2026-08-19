import { describe, expect, it } from "vitest";

import { serializePlanningBody } from "./serializePlanningBody";

describe("serializePlanningBody", () => {
  it("写入规划方式、类型与出图参数", () => {
    const parsed = JSON.parse(
      serializePlanningBody({
        planningMode: "MANUAL",
        requestedTypes: ["hero-image", "flat-lay"],
        userInstruction: "偏冷白",
        candidatesPerType: 2,
        imageResolution: "2K",
        imageAspectRatio: "1:1",
        regenerationKey: "run-1",
      }),
    ) as Record<string, unknown>;
    expect(parsed.planningMode).toBe("MANUAL");
    expect(parsed.imageTypes).toEqual(["hero-image", "flat-lay"]);
    expect(parsed.requestedTypes).toEqual(["hero-image", "flat-lay"]);
    expect(parsed.userInstruction).toBe("偏冷白");
    expect(parsed.candidatesPerType).toBe(2);
    expect(parsed.imageResolution).toBe("2K");
    expect(parsed.imageAspectRatio).toBe("1:1");
    expect(parsed.regenerationKey).toBe("run-1");
    expect(parsed.allowAgentRecommendations).toBeUndefined();
  });
});
