import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  streamMock: vi.fn(),
  options: undefined as { streamFn?: (...args: unknown[]) => unknown; initialState?: { thinkingLevel?: string } } | undefined,
  prompt: "",
  images: [] as unknown[],
  response: "",
  responseQueue: [] as string[],
  promptCount: 0,
}));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    public state = { messages: [] as Array<{ role: string; content: Array<{ type: string; text?: string }> }>, errorMessage: undefined as string | undefined };

    public constructor(options: { streamFn?: (...args: unknown[]) => unknown; initialState?: { thinkingLevel?: string } }) {
      captured.options = options;
    }

    public async prompt(message: string, images?: unknown[]): Promise<void> {
      captured.prompt = message;
      captured.promptCount += 1;
      captured.images = images ?? [];
      const text = captured.responseQueue.length > 0 ? captured.responseQueue.shift() : captured.response;
      this.state.messages = [{ role: "assistant", content: [{ type: "text", text }] }];
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
    { handle: "P1", role: "PRODUCT_TRUTH", name: "earbuds.png", mimeType: "image/png" },
    { handle: "R1", role: "STYLE_REFERENCE", name: "style.png", mimeType: "image/png" },
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

  it("帮写对可思考模型降级为 low thinking，为每轮流式请求注入超时与重试", async () => {
    captured.response = JSON.stringify({ productName: "耳机", coreSellingPoints: ["小巧"], suitableAudience: "通勤", expectedScenarios: "通勤" });
    await writeCopywriting(input);
    // 始终思考的模型（如 glm-5.3-flash）拒绝关闭思考（智谱 1210），可思考模型必须用 low
    expect(captured.options?.initialState?.thinkingLevel).toBe("low");
    await writeCopywriting({ ...input, model: { ...input.model, reasoning: false } });
    expect(captured.options?.initialState?.thinkingLevel).toBe("off");
    captured.streamMock.mockReset().mockReturnValueOnce("events");
    const returned = captured.options?.streamFn?.({ id: "model" }, { messages: [] }, undefined);
    expect(returned).toBe("events");
    expect(captured.streamMock).toHaveBeenCalledWith({ id: "model" }, { messages: [] }, { timeoutMs: 240_000, maxRetries: 2 });
  });

  it("商品描述超限时在同一会话追加一次压缩重试，而不是直接失败", async () => {
    // 6 条长卖点拼上固定标签必然超过 400 字符
    captured.response = JSON.stringify({
      productName: "旗舰级主动降噪无线蓝牙耳机",
      coreSellingPoints: [
        "旗舰级主动降噪技术带来纯净聆听体验与沉浸感",
        "人体工学入耳设计佩戴轻盈无负担适合长时间使用",
        "超长续航能力配合快速充电彻底告别电量焦虑困扰",
        "蓝牙新协议连接稳定低延迟游戏影音体验更顺畅",
        "高品质驱动单元还原丰富音乐细节层次分明动听",
        "多色可选外观精致时尚商务运动场合都轻松适配",
      ],
      suitableAudience: "注重音质与佩戴舒适度的通勤上班族和商旅人士".padEnd(260, "例"),
      expectedScenarios: "通勤路上、差旅途中、办公室专注工作与居家休闲".padEnd(260, "景"),
    });
    captured.responseQueue = [captured.response, JSON.stringify({
      productName: "降噪无线耳机",
      coreSellingPoints: ["主动降噪", "佩戴轻盈", "续航持久"],
      suitableAudience: "通勤上班族",
      expectedScenarios: "通勤与办公",
    })];
    captured.promptCount = 0;

    const result = await writeCopywriting(input);

    expect(() => validateCopywriting("PRODUCT_DESCRIPTION", JSON.parse(captured.response))).toThrow("longer than 600");
    expect(result.content.length).toBeLessThanOrEqual(500);
    expect(captured.promptCount).toBe(2);
    expect(captured.prompt).toContain("too long");
    captured.responseQueue = [];
  });

  it("容差带内（400~600 字符）的轻微超限直接放行，不触发压缩重试", async () => {
    // 6 条长卖点 + 140 字符的受众/场景，拼装后约 450 字符：超过 Prompt 目标但低于硬护栏
    captured.response = JSON.stringify({
      productName: "旗舰级主动降噪无线蓝牙耳机",
      coreSellingPoints: [
        "旗舰级主动降噪技术带来纯净聆听体验与沉浸感",
        "人体工学入耳设计佩戴轻盈无负担适合长时间使用",
        "超长续航能力配合快速充电彻底告别电量焦虑困扰",
        "蓝牙新协议连接稳定低延迟游戏影音体验更顺畅",
        "高品质驱动单元还原丰富音乐细节层次分明动听",
        "多色可选外观精致时尚商务运动场合都轻松适配",
      ],
      suitableAudience: "注重音质与佩戴舒适度的通勤上班族和商旅人士".padEnd(140, "例"),
      expectedScenarios: "通勤路上、差旅途中、办公室专注工作与居家休闲".padEnd(140, "景"),
    });
    captured.promptCount = 0;

    const result = await writeCopywriting(input);

    expect(result.content.length).toBeGreaterThan(400);
    expect(result.content.length).toBeLessThanOrEqual(600);
    expect(captured.promptCount).toBe(1);
  });

  it("sends handle-based visual attachments without exposing asset ids", async () => {
    captured.response = JSON.stringify({ content: "产品居中展示，保留右侧留白。" });
    await writeCopywriting({
      ...input,
      target: "PLANNING_INSTRUCTION",
      referenceImages: [{ type: "image", mimeType: "image/png", data: "encoded" }],
    });
    expect(captured.images).toHaveLength(1);
    expect(captured.prompt).toContain("visualAttachments");
    expect(captured.prompt).toContain("P1");
    expect(captured.prompt).not.toContain("product-1");
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
