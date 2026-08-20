import { describe, expect, it, vi } from "vitest";
import { createPlanningTools } from "./tools.js";

const domesticContext = { platformTargets: ["DOMESTIC"] as const, targetMarket: null, copyLanguage: null };
const amazonContext = { platformTargets: ["AMAZON"] as const, targetMarket: null, copyLanguage: null };

describe("Pi planning business tools", () => {
  it("returns structured template guidance without exposing a prompt contract string", async () => {
    const tool = createPlanningTools(domesticContext)[0];
    const result = await tool.execute("call-1", { templateId: "hero-image" });
    const guidance = result.details as { guidance: { visualFields: Record<string, string>; platformReservations: string[] } };
    expect(guidance.guidance.visualFields).toHaveProperty("type");
    expect(guidance.guidance.platformReservations).toContain("预留顶部居中的价格叠加区");
    expect(JSON.stringify(guidance)).not.toContain("Upstream template");
  });

  it("fails explicitly for unknown templates and scopes platform guidance to project context", async () => {
    const tools = createPlanningTools(amazonContext);
    await expect(tools[0].execute("call-1", { templateId: "missing-template" })).rejects.toThrow("Unknown ecom-details-image template");
    const result = await tools[1].execute("call-2", {});
    expect(result.details).toMatchObject({ targets: [{ target: "AMAZON" }], effectiveCopyLanguage: null });
  });

  it("uses an explicit language before the selected market default", async () => {
    const tool = createPlanningTools({ platformTargets: [], targetMarket: "JAPAN", copyLanguage: "en-US" })[1];
    const result = await tool.execute("call-market", {});
    expect(result.details).toMatchObject({
      market: { id: "JAPAN" },
      effectiveCopyLanguage: "en-US",
      copyLanguageSource: "explicit",
    });
  });

  it("derives the market language only when the user did not select one", async () => {
    const tool = createPlanningTools({ platformTargets: [], targetMarket: "TAIWAN", copyLanguage: null })[1];
    const result = await tool.execute("call-market", {});
    const guidance = result.details as { market: { id: string; visualDirection?: unknown }; effectiveCopyLanguage: string; copyLanguageSource: string; copyPolicy: string[] };
    expect(guidance).toMatchObject({ effectiveCopyLanguage: "zh-Hant", copyLanguageSource: "market-default" });
    expect(guidance.market).not.toHaveProperty("visualDirection");
    expect(guidance.copyPolicy).toContain("Do not derive visual style from the selected market. Use templates, verified product facts, brand guidance, reference assets, and user instruction for visual direction.");
  });

  it("keeps visual research disabled by default and constrains enabled search output", async () => {
    expect(createPlanningTools(amazonContext)).toHaveLength(2);
    const started: string[] = [];
    const attempts: Array<{ status: string; resultCount: number }> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ web: { results: [{ title: "Trend", url: "https://example.com/trend", description: "soft side light" }, { title: "bad", url: "javascript:alert(1)", description: "ignore" }] } }), { status: 200 }));
    try {
      const tool = createPlanningTools(amazonContext, { sources: [{ id: "brave", name: "Brave", kind: "brave", baseUrl: "https://search.example.test", apiKey: "secret" }], maxResults: 1, audit: { onSearchStarted: ({ query }) => started.push(query), onSourceAttempt: (attempt) => attempts.push(attempt) } })[2]!;
      const result = await tool.execute("call-3", { query: "product photography lighting" });
      expect((result.details as { results: unknown[] }).results).toHaveLength(1);
      expect(fetchMock.mock.calls[0]?.[0]?.toString()).toContain("count=1");
      expect(JSON.stringify(result.details)).toContain("visual-research-only");
      expect(started).toEqual(["product photography lighting"]);
      expect(attempts).toMatchObject([{ status: "SUCCEEDED", resultCount: 1 }]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("uses the next configured source after the preferred source fails", async () => {
    const attempts: Array<{ sourceId: string; status: string; errorMessage: string | null }> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ title: "Lighting", url: "https://example.com/lighting", content: "soft window light" }] }), { status: 200 }));
    try {
      const tool = createPlanningTools(amazonContext, { sources: [
        { id: "brave", name: "Brave", kind: "brave", baseUrl: "https://brave.example.test/search", apiKey: "secret" },
        { id: "tavily", name: "Tavily", kind: "tavily", baseUrl: "https://tavily.example.test/search", apiKey: "secret" }
      ], audit: { onSearchStarted: () => {}, onSourceAttempt: (attempt) => attempts.push(attempt) } })[2]!;
      const result = await tool.execute("call-4", { query: "product photography lighting" });
      expect((result.details as { results: unknown[] }).results).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(attempts).toMatchObject([
        { sourceId: "brave", status: "FAILED", errorMessage: "HTTP 503" },
        { sourceId: "tavily", status: "SUCCEEDED", errorMessage: null },
      ]);
    } finally { fetchMock.mockRestore(); }
  });
});
