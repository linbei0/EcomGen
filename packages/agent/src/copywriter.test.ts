import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ streamMock: vi.fn(), options: undefined as { streamFn?: (...args: unknown[]) => unknown; initialState?: { thinkingLevel?: string } } | undefined, prompt: "", images: [] as unknown[], response: "" }));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    public state = { messages: [] as Array<{ role: string; content: Array<{ type: string; text?: string }> }>, errorMessage: undefined as string | undefined };

    public constructor(options: { streamFn?: (...args: unknown[]) => unknown; initialState?: { thinkingLevel?: string } }) {
      captured.options = options;
    }

    public async prompt(message: string, images?: unknown[]): Promise<void> {
      captured.prompt = message;
      captured.images = images ?? [];
      this.state.messages = [{ role: "assistant", content: [{ type: "text", text: captured.response }] }];
    }
  },
}));

vi.mock("@earendil-works/pi-ai/api/openai-completions.lazy", () => ({
  openAICompletionsApi: () => ({ stream: captured.streamMock }),
}));

import { validateCopywriting, writeCopywriting, type CopywritingInput } from "./copywriter.js";

const input: CopywritingInput = {
  target: "PRODUCT_DESCRIPTION",
  model: {
    id: "vision-model", name: "vision-model", api: "openai-completions", provider: "provider" as never,
    baseUrl: "https://gateway.example/v1", reasoning: true, input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8_000,
  },
  apiKey: "secret",
  projectName: "无线耳机",
  productCategory: "消费电子",
  productDescription: null,
  verifiedFacts: ["续航 8 小时"],
  prohibitedClaims: ["医用级"],
  platformTargets: ["TAOBAO"],
  targetMarket: "CHINA_MAINLAND",
  copyLanguage: "zh-Hans",
  assets: [
    { id: "product-1", role: "PRODUCT_TRUTH", name: "earbuds.png", mimeType: "image/png" },
    { id: "reference-1", role: "STYLE_REFERENCE", name: "style.png", mimeType: "image/png" },
  ],
  referenceImages: [],
};

describe("writeCopywriting", () => {
  it("通过 Pi Agent 返回包含四段的商品描述，并保留素材角色", async () => {
    captured.response = JSON.stringify({
      productName: "降噪无线耳机",
      coreSellingPoints: ["紧凑入耳设计", "清晰聆听体验"],
      suitableAudience: "通勤与日常聆听用户",
      expectedScenarios: "通勤、办公和居家休闲",
    });

    const result = await writeCopywriting(input);

    expect(result.content).toContain("产品名称：降噪无线耳机");
    expect(result.content).toContain("核心卖点：");
    expect(result.content).toContain("适用人群：通勤与日常聆听用户");
    expect(result.content).toContain("期望场景：通勤、办公和居家休闲");
    expect(captured.prompt).toContain("PRODUCT_TRUTH");
    expect(captured.prompt).toContain("STYLE_REFERENCE");
  });

  it("帮写关闭 thinking 并为每轮流式请求注入超时与重试", async () => {
    captured.response = JSON.stringify({ productName: "耳机", coreSellingPoints: ["小巧"], suitableAudience: "通勤", expectedScenarios: "通勤" });
    await writeCopywriting(input);
    expect(captured.options?.initialState?.thinkingLevel).toBe("off");
    captured.streamMock.mockReset().mockReturnValueOnce("events");
    const returned = captured.options?.streamFn?.({ id: "model" }, { messages: [] }, undefined);
    expect(returned).toBe("events");
    expect(captured.streamMock).toHaveBeenCalledWith({ id: "model" }, { messages: [] }, { timeoutMs: 240_000, maxRetries: 2 });
  });

  it("sends the supplied visual attachment mapping with its images", async () => {
    captured.response = JSON.stringify({ content: "产品居中展示，保留右侧留白。" });
    await writeCopywriting({
      ...input,
      target: "PLANNING_INSTRUCTION",
      referenceImages: [{ type: "image", mimeType: "image/png", data: "encoded" }],
      visionAttachments: [{ attachmentIndex: 1, assetId: "product-1", role: "PRODUCT_TRUTH", name: "earbuds.png", mimeType: "image/png" }],
    });
    expect(captured.images).toHaveLength(1);
    expect(captured.prompt).toContain("visionAttachments");
    expect(captured.prompt).toContain("product-1");
  });

  it("接受画面规划说明，并拒绝不完整的商品描述", () => {
    expect(validateCopywriting("PLANNING_INSTRUCTION", { content: "产品居中陈列，暖色侧光，保留右侧留白，避免促销文字。" })).toEqual({
      target: "PLANNING_INSTRUCTION",
      content: "产品居中陈列，暖色侧光，保留右侧留白，避免促销文字。",
    });
    expect(() => validateCopywriting("PRODUCT_DESCRIPTION", { productName: "耳机", coreSellingPoints: [] })).toThrow(
      "no core selling points",
    );
  });
});
