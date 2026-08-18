import { describe, expect, it } from "vitest";

import { serializePlanningBody } from "./serializePlanningBody";

describe("serializePlanningBody", () => {
  it("同时写入 imageTypes 与 requestedTypes", () => {
    const parsed = JSON.parse(
      serializePlanningBody({
        imageTypes: ["hero-image", "flat-lay"],
        allowAgentRecommendations: true,
        userInstruction: "偏冷白",
      }),
    ) as Record<string, unknown>;
    expect(parsed.imageTypes).toEqual(["hero-image", "flat-lay"]);
    expect(parsed.requestedTypes).toEqual(["hero-image", "flat-lay"]);
    expect(parsed.allowAgentRecommendations).toBe(true);
    expect(parsed.userInstruction).toBe("偏冷白");
  });
});
