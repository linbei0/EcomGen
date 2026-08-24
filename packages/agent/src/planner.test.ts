import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ options: undefined as { initialState?: { thinkingLevel?: string; model?: { compat?: Record<string, unknown>; reasoning?: boolean }; tools?: Array<{ name: string; execute: (id: string, params: unknown) => Promise<unknown> }> } } | undefined, prompt: "", images: [] as unknown[], errorMessage: undefined as string | undefined, simulateResearchFailure: false, itemCount: 1, referencedAssets: [] as string[], editResponse: undefined as Record<string, unknown> | undefined }));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    public state = { messages: [] as Array<{ role: string; content: Array<{ type: string; text?: string }> }>, errorMessage: captured.errorMessage };

    public constructor(options: { initialState?: { thinkingLevel?: string; tools?: Array<{ name: string; execute: (id: string, params: unknown) => Promise<unknown> }> } }) {
      captured.options = options;
    }

    public async prompt(message: string, images?: unknown[]): Promise<void> {
      if (captured.errorMessage) return;
      captured.prompt = message;
      captured.images = images ?? [];
      if (message.includes("Plan this edit")) {
        this.state.messages = [{ role: "assistant", content: [{ type: "text", text: JSON.stringify(captured.editResponse ?? { operation: "NATURAL_FUSION", executionMode: "MODEL_DIRECTED", userSummary: "直接编辑", prompt: "edit", targetAnnotationIds: [], targetDescription: "主要商品", targetConfidence: 0.9, clarification: null, requiresConfirmation: true, compositePolicy: "PROVIDER_RESULT", memoryPatch: {} }) }] }];
        return;
      }
      if (captured.simulateResearchFailure) {
        const researchTool = captured.options?.initialState?.tools?.find((tool) => tool.name === "research_visual_direction");
        try { await researchTool?.execute("research-call", { query: "product photography lighting" }); } catch { /* Pi 将工具错误返回给模型并继续规划。 */ }
      }
      this.state.messages = [{ role: "assistant", content: [{ type: "text", text: JSON.stringify({ campaignStyleLock: "clean", items: Array.from({ length: captured.itemCount }, (_, index) => ({ assetType: "hero-image", displayName: index === 0 ? "整机斜侧展示首图" : `展示场景${index + 1}`, templateVariant: null, candidateCount: 1, referencedAssets: captured.referencedAssets, mode: "CREATIVE", promptInstruction: "hero", factClaims: [], riskFlags: [], sortOrder: index })) }) }] }];
    }
  },
}));

vi.mock("@earendil-works/pi-ai/api/openai-completions.lazy", () => ({
  openAICompletionsApi: () => ({ stream: vi.fn() }),
}));

import { planImageEdit, planStoryboard, type EditPlannerInput, type PlannerInput } from "./planner.js";

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

  it("passes visual attachments and their asset mapping to the vision model", async () => {
    captured.errorMessage = undefined;
    captured.prompt = "";
    captured.images = [];
    await planStoryboard({
      ...input,
      model: { ...input.model, input: ["text", "image"] },
      referenceImages: [
        { type: "image", mimeType: "image/png", data: "product-bytes" },
        { type: "image", mimeType: "image/jpeg", data: "style-bytes" },
      ],
      visionAttachments: [
        { attachmentIndex: 1, assetId: "product-1", role: "PRODUCT_TRUTH", name: "product.png", mimeType: "image/png" },
        { attachmentIndex: 2, assetId: "style-1", role: "STYLE_REFERENCE", name: "style.jpg", mimeType: "image/jpeg" },
      ],
      assets: [
        { id: "product-1", role: "PRODUCT_TRUTH", kind: "PRODUCT", name: "product.png", mimeType: "image/png" },
        { id: "style-1", role: "STYLE_REFERENCE", kind: "REFERENCE", name: "style.jpg", mimeType: "image/jpeg" },
      ],
    });
    expect(captured.images).toHaveLength(2);
    expect(captured.prompt).toContain("visionAttachments");
    expect(captured.prompt).toContain("product-1");
    expect(captured.prompt).toContain("style-1");
  });

  it("rejects a storyboard item that references more than four non-product images", async () => {
    captured.referencedAssets = ["reference-1", "reference-2", "reference-3", "reference-4", "reference-5"];
    await expect(planStoryboard({
      ...input,
      assets: captured.referencedAssets.map((id) => ({ id, role: "STYLE_REFERENCE", kind: "REFERENCE" as const, name: `${id}.png`, mimeType: "image/png" })),
    })).rejects.toThrow("at most 4 non-product images");
    captured.referencedAssets = [];
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

const editInput: EditPlannerInput = {
  model: { ...input.model, input: ["text", "image"] },
  apiKey: "secret",
  message: "调整目标对象外观",
  annotations: {},
  hasEditMask: false,
  hasCanvasExpansion: false,
  referenceAssets: [],
  memorySummary: {},
  projectFacts: [],
  imageCapabilities: { supportsMaskEdit: true, supportsUnmaskedEdit: true, supportsMultiReference: true, supportsOutpaint: true, supportsInputFidelity: true, supportsNaturalBlend: true },
  sourceImage: { type: "image", mimeType: "image/png", data: "encoded" }
};

describe("planImageEdit", () => {
  it("无蒙版且目标明确时选择模型自行判断范围", async () => {
    captured.errorMessage = undefined;
    captured.editResponse = { operation: "NATURAL_FUSION", executionMode: "MODEL_DIRECTED", userSummary: "调整目标对象外观", prompt: "edit", targetAnnotationIds: [], targetDescription: "主要商品", targetConfidence: 0.9, clarification: null, requiresConfirmation: false, compositePolicy: "PROVIDER_RESULT", memoryPatch: {} };
    const result = await planImageEdit(editInput);
    expect(result.executionMode).toBe("MODEL_DIRECTED");
    expect(result.requiresConfirmation).toBe(true);
  });

  it("严格蒙版和歧义计划必须要求用户补充", async () => {
    captured.errorMessage = undefined;
    captured.editResponse = { operation: "NATURAL_FUSION", executionMode: "NEED_INPUT", userSummary: "需要确认目标", prompt: "", targetAnnotationIds: [], targetDescription: "多个可能目标", targetConfidence: 0.4, clarification: "请确认要修改哪一个目标。", requiresConfirmation: false, compositePolicy: "PROVIDER_RESULT", memoryPatch: {} };
    const result = await planImageEdit(editInput);
    expect(result.executionMode).toBe("NEED_INPUT");
    expect(result.clarification).toContain("请确认");
  });
});
