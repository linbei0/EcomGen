import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  options: undefined as { systemPrompt?: string; initialState?: { thinkingLevel?: string }; onPayload?: unknown } | undefined,
  prompt: "",
  images: [] as unknown[] | undefined,
  errorMessage: undefined as string | undefined,
  responseText: "{}",
}));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    public state = { messages: [] as Array<{ role: string; content: Array<{ type: string; text?: string }> }>, errorMessage: captured.errorMessage };

    public constructor(options: { systemPrompt?: string; initialState?: { thinkingLevel?: string }; onPayload?: unknown }) {
      captured.options = options;
    }

    public async prompt(message: string, images?: unknown[]): Promise<void> {
      captured.prompt = message;
      captured.images = images;
      if (captured.errorMessage) return;
      this.state.messages = [{ role: "assistant", content: [{ type: "text", text: captured.responseText }] }];
    }
  },
}));

vi.mock("@earendil-works/pi-ai/api/openai-completions.lazy", () => ({
  openAICompletionsApi: () => ({ stream: vi.fn() }),
}));

import { forgeSuite, type SuiteForgeInput } from "./suite-forge.js";

const image = { type: "image" as const, data: "aGVsbG8=", mimeType: "image/jpeg" };

const imageInput: SuiteForgeInput = {
  // 载入技能文本后体积较大，这里通过 helper 复用；模型能力决定是否透传参考图。
  model: {
    id: "model", name: "model", api: "openai-completions", provider: "provider" as never,
    baseUrl: "https://custom-gateway.example/v1", reasoning: true, input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8_000,
    compat: { maxTokensField: "max_tokens", thinkingFormat: "qwen", supportsDeveloperRole: false },
  },
  apiKey: "secret",
  images: [image],
};

describe("forgeSuite", () => {
  it("把参考图作为视觉输入交给 Agent 并解析出 JSON 对象", async () => {
    captured.errorMessage = undefined;
    captured.images = undefined;
    captured.responseText = JSON.stringify({ id: "suite-demo", name: "示例套图", shots: [{ shotId: "hero" }] });

    const result = await forgeSuite(imageInput);

    expect(captured.images).toEqual([image]);
    expect(captured.prompt).toContain("Analyze the 1 reference image");
    expect(captured.prompt).toContain("Return only the suite JSON.");
    expect(result).toMatchObject({ id: "suite-demo", name: "示例套图" });
  });

  it("模型不支持视觉时不透传图片，仅依赖技能提示词", async () => {
    captured.errorMessage = undefined;
    captured.images = undefined;
    captured.responseText = JSON.stringify({ id: "suite-demo" });

    await forgeSuite({ ...imageInput, model: { ...imageInput.model, input: ["text"] } });

    expect(captured.images).toBeUndefined();
  });

  it("把用户提示写入指令，便于 Worker 端做稳定指纹与提示追溯", async () => {
    captured.errorMessage = undefined;
    captured.responseText = JSON.stringify({ id: "suite-demo" });

    await forgeSuite({
      ...imageInput,
      hints: { name: "氨基酸洁面套图", l1: "美妆", leaf: "洁面乳", targetShotCount: 7, userInstruction: "背景统一暖米色" },
    });

    expect(captured.prompt).toContain("Use category L1 exactly: 美妆");
    expect(captured.prompt).toContain("Use this leaf product name: 洁面乳");
    expect(captured.prompt).toContain("Use this suite name: 氨基酸洁面套图");
    expect(captured.prompt).toContain("Produce about 7 shots.");
    expect(captured.prompt).toContain("Additional requirement: 背景统一暖米色");
  });

  it("透传 Agent 错误与非法 JSON，不做静默降级", async () => {
    captured.errorMessage = "provider 502";
    await expect(forgeSuite(imageInput)).rejects.toThrow(/provider 502/);

    captured.errorMessage = undefined;
    captured.responseText = JSON.stringify([1, 2, 3]);
    await expect(forgeSuite(imageInput)).rejects.toThrow(/JSON object/);
  });
});
