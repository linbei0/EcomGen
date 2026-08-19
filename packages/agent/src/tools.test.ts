import { describe, expect, it } from "vitest";
import { createPlanningTools } from "./tools.js";

describe("Pi planning business tools", () => {
  it("returns structured template guidance without exposing a prompt contract string", async () => {
    const tool = createPlanningTools(["DOMESTIC"])[0];
    const result = await tool.execute("call-1", { templateId: "hero-image" });
    const guidance = result.details as { guidance: { visualFields: Record<string, string>; platformReservations: string[] } };
    expect(guidance.guidance.visualFields).toHaveProperty("type");
    expect(guidance.guidance.platformReservations).toContain("预留顶部居中的价格叠加区");
    expect(JSON.stringify(guidance)).not.toContain("Upstream template");
  });

  it("fails explicitly for unknown templates and platforms", async () => {
    const tools = createPlanningTools(["AMAZON"]);
    await expect(tools[0].execute("call-1", { templateId: "missing-template" })).rejects.toThrow("Unknown ecom-details-image template");
    await expect(tools[1].execute("call-2", { targets: ["UNKNOWN"] })).rejects.toThrow("Unknown platform targets");
  });
});
