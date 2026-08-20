import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ options: undefined as { initialState?: { thinkingLevel?: string; model?: { compat?: Record<string, unknown>; reasoning?: boolean }; tools?: Array<{ name: string; execute: (id: string, params: unknown) => Promise<unknown> }> } } | undefined, prompt: "", errorMessage: undefined as string | undefined, simulateResearchFailure: false, itemCount: 1 }));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    public state = { messages: [] as Array<{ role: string; content: Array<{ type: string; text?: string }> }>, errorMessage: captured.errorMessage };

    public constructor(options: { initialState?: { thinkingLevel?: string; tools?: Array<{ name: string; execute: (id: string, params: unknown) => Promise<unknown> }> } }) {
      captured.options = options;
    }

    public async prompt(message: string): Promise<void> {
      if (captured.errorMessage) return;
      captured.prompt = message;
      if (captured.simulateResearchFailure) {
        const researchTool = captured.options?.initialState?.tools?.find((tool) => tool.name === "research_visual_direction");
        try { await researchTool?.execute("research-call", { query: "product photography lighting" }); } catch { /* Pi 将工具错误返回给模型并继续规划。 */ }
      }
      this.state.messages = [{ role: "assistant", content: [{ type: "text", text: JSON.stringify({ campaignStyleLock: "clean", items: Array.from({ length: captured.itemCount }, (_, index) => ({ assetType: "hero-image", displayName: index === 0 ? "整机斜侧展示首图" : `展示场景${index + 1}`, templateVariant: null, candidateCount: 1, referencedAssets: [], mode: "CREATIVE", promptInstruction: "hero", factClaims: [], riskFlags: [], sortOrder: index })) }) }] }];
    }
  },
}));

vi.mock("@earendil-works/pi-ai/api/openai-completions.lazy", () => ({
  openAICompletionsApi: () => ({ stream: vi.fn() }),
}));

import { planStoryboard, type PlannerInput } from "./planner.js";

const input: PlannerInput = {
  model: {
    id: "model", name: "model", api: "openai-completions", provider: "provider" as never,
    baseUrl: "https://custom-gateway.example/v1", reasoning: true, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8_000,
    compat: { maxTokensField: "max_tokens", thinkingFormat: "qwen", supportsDeveloperRole: false },
  },
  apiKey: "secret",
  projectName: "tablet",
  productCategory: null,
  productDescription: null,
  verifiedFacts: [],
  prohibitedClaims: [],
  brandGuidelines: {},
  platformTargets: ["DOMESTIC"],
  targetMarket: null,
  copyLanguage: null,
  defaultMode: "CREATIVE",
  assets: [],
  planningMode: "AI",
  requestedTypes: ["hero-image"],
  candidatesPerType: 1,
  targetImageCount: 1,
};

describe("planStoryboard", () => {
  it("uses the pre-resolved Pi compatibility profile without inspecting the URL", async () => {
    captured.errorMessage = undefined;
    await planStoryboard(input);

    expect(captured.options?.initialState?.thinkingLevel).toBe("medium");
    expect(captured.options?.initialState?.model?.compat).toMatchObject({ maxTokensField: "max_tokens", thinkingFormat: "qwen", supportsDeveloperRole: false });
  });

  it("uses the reasoning model for manual selections and marks them as authoritative", async () => {
    captured.errorMessage = undefined;
    captured.prompt = "";
    await planStoryboard({ ...input, planningMode: "MANUAL", requestedTypes: ["hero-image"] });

    expect(captured.prompt).toContain("Manual selection is authoritative");
    const result = await planStoryboard({ ...input, planningMode: "MANUAL", requestedTypes: ["hero-image"] });
    expect(result.items[0]?.displayName).toBe("整机斜侧展示首图");
  });

  it("要求 AI 返回指定数量的分镜，并拒绝数量不符的结果", async () => {
    captured.errorMessage = undefined;
    captured.prompt = "";
    captured.itemCount = 2;
    const result = await planStoryboard({ ...input, targetImageCount: 2 });
    expect(captured.prompt).toContain("exactly 2 planned items");
    expect(result.items).toHaveLength(2);

    captured.itemCount = 1;
    await expect(planStoryboard({ ...input, targetImageCount: 2 })).rejects.toThrow("AI planning must return exactly 2 storyboard items");
  });

  it("passes the resolved market guidance into the Pi planning context", async () => {
    captured.errorMessage = undefined;
    captured.prompt = "";
    await planStoryboard({ ...input, platformTargets: ["AMAZON"], targetMarket: "JAPAN", copyLanguage: null });

    expect(captured.prompt).toContain("platformGuidance");
    expect(captured.prompt).toContain("ja-JP");
    expect(captured.prompt).toContain("日本");
  });

  it("preserves the Agent error when no assistant text is produced", async () => {
    captured.errorMessage = "provider timed out";

    await expect(planStoryboard(input)).rejects.toThrow("provider timed out");

    captured.errorMessage = undefined;
  });

  it("continues planning when visual research fails", async () => {
    captured.errorMessage = undefined;
    captured.simulateResearchFailure = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("search unavailable"));
    try {
      const result = await planStoryboard({ ...input, webResearch: { sources: [{ id: "brave", name: "Brave", kind: "brave", baseUrl: "https://search.example.test", apiKey: "secret" }], maxResults: 1 } });
      expect(result.items[0]?.promptInstruction).toBe("hero");
    } finally {
      fetchMock.mockRestore();
      captured.simulateResearchFailure = false;
    }
  });
});
