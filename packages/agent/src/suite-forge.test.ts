import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  options: undefined as { systemPrompt?: string; initialState?: { thinkingLevel?: string }; onPayload?: unknown } | undefined,
  prompt: "",
  images: [] as unknown[] | undefined,
  errorMessage: undefined as string | undefined,
  responseText: "{}",
  /** 每一轮 assistant turn 的文本增量；空数组表示只发 turn 边界、不发增量。 */
  turns: [] as string[][],
  listeners: [] as Array<(event: unknown) => void>,
}));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    public state = { messages: [] as Array<{ role: string; content: Array<{ type: string; text?: string }> }>, errorMessage: captured.errorMessage };

    public constructor(options: { systemPrompt?: string; initialState?: { thinkingLevel?: string }; onPayload?: unknown }) {
      captured.options = options;
    }

    // 真实 Agent 按 delta 发 message_update，并在每轮开始时发 turn_start：这里按同样顺序回放。
    public subscribe(listener: (event: unknown) => void): () => void {
      captured.listeners.push(listener);
      return () => { captured.listeners = captured.listeners.filter((candidate) => candidate !== listener); };
    }

    public async prompt(message: string, images?: unknown[]): Promise<void> {
      captured.prompt = message;
      captured.images = images;
      if (captured.errorMessage) return;
      for (const turn of captured.turns.length > 0 ? captured.turns : [[]]) {
        for (const listener of captured.listeners) listener({ type: "turn_start" });
        for (const listener of captured.listeners) listener({ type: "message_start", message: { role: "assistant" } });
        for (const delta of turn) {
          for (const listener of captured.listeners) listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });
        }
      }
      this.state.messages = [{ role: "assistant", content: [{ type: "text", text: captured.responseText }] }];
    }
  },
}));

vi.mock("@earendil-works/pi-ai/api/openai-completions.lazy", () => ({
  openAICompletionsApi: () => ({ stream: vi.fn() }),
}));

import { forgeSuite, type SuiteForgeInput } from "./suite-forge.js";
import { ShotStreamCounter } from "./shot-progress.js";

/** mock 捕获对象跨用例共享，统一复位才能保证任一用例失败都不会影响后续用例。 */
beforeEach(() => {
  captured.options = undefined;
  captured.prompt = "";
  captured.images = undefined;
  captured.errorMessage = undefined;
  captured.responseText = "{}";
  captured.turns = [];
  captured.listeners = [];
});

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
    captured.responseText = JSON.stringify({ id: "suite-demo", name: "示例套图", shots: [{ shotId: "hero" }] });

    const result = await forgeSuite(imageInput);

    expect(captured.images).toEqual([image]);
    expect(captured.prompt).toContain("Analyze the 1 reference image");
    expect(captured.prompt).toContain("Return only the suite JSON.");
    expect(result).toMatchObject({ id: "suite-demo", name: "示例套图" });
  });

  it("模型不支持视觉时不透传图片，仅依赖技能提示词", async () => {
    captured.responseText = JSON.stringify({ id: "suite-demo" });

    await forgeSuite({ ...imageInput, model: { ...imageInput.model, input: ["text"] } });

    expect(captured.images).toBeUndefined();
  });

  it("把用户提示写入指令，便于 Worker 端做稳定指纹与提示追溯", async () => {
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

/** 反推响应体：一套 N 张分镜的最小合法形态，用于切分喂给计数器。 */
function suiteStreamText(shotCount: number): string {
  return JSON.stringify({
    styleLock: { lockText: "one shot per row" },
    shots: Array.from({ length: shotCount }, (_, index) => ({ shotId: `spot-${index}`, order: index + 1, shotRole: "HERO", promptTemplate: "Product photography of {product}" })),
  });
}

describe("ShotStreamCounter", () => {
  it("整段一次性到达时计出全部分镜", () => {
    // 不逐 token 推流的 Provider 会把整份 JSON 放在一个 delta 里，此时没有中间值可报。
    expect(new ShotStreamCounter().push(suiteStreamText(5))).toBe(5);
  });

  it("任意切分方式下的最终计数都等于分镜数", () => {
    const text = suiteStreamText(7);
    for (const size of [1, 2, 3, 5, 8, 13, 40, 200]) {
      const counter = new ShotStreamCounter();
      let last = 0;
      for (let index = 0; index < text.length; index += size) last = counter.push(text.slice(index, index + size));
      // 标记是 10 个字符，按 1 字符推送时必然横跨 delta 边界：这是最容易重复计数或漏计的切法。
      expect(last).toBe(7);
    }
  });

  it("只认真正的 JSON 键，正文里提到 shot 字样不计入", () => {
    const counter = new ShotStreamCounter();
    // 值里的引号会被 JSON 转义成 \"，与键的 "shotRole" 不同形，因此不会被误判
    expect(counter.push(JSON.stringify({ notes: 'say "shotRole" once, shotId list follows', shots: [] }))).toBe(0);
  });

  it("reset 后重新计数，重试重发的整份 JSON 不会累加", () => {
    const counter = new ShotStreamCounter();
    expect(counter.push(suiteStreamText(3))).toBe(3);
    counter.reset();
    expect(counter.push(suiteStreamText(3))).toBe(3);
  });
});

describe("forgeSuite 分镜进度回调", () => {
  /** 逐字符回放一轮，返回回调收到的所有计数（含跨轮）。 */
  async function collectProgress(turns: string[][]): Promise<number[]> {
    const text = turns[turns.length - 1]?.join("") ?? "{}";
    captured.responseText = text;
    captured.turns = turns;
    const seen: number[] = [];
    await forgeSuite({ ...imageInput, onShotProgress: (count) => seen.push(count) });
    return seen;
  }

  it("只在计数变化时回调，逐 delta 推送不会把回调次数放大成 token 数", async () => {
    const text = suiteStreamText(3);
    // 每 4 个字符一个 delta：分镜数只变化 3 次，回调就应该只有 3 次
    const deltas = Array.from({ length: Math.ceil(text.length / 4) }, (_, index) => text.slice(index * 4, index * 4 + 4));
    expect(await collectProgress([deltas])).toEqual([1, 2, 3]);
  });

  it("新一轮 turn 重置计数：重试重发的文本不会把分镜数翻倍", async () => {
    const chars = suiteStreamText(3).split("");
    // 不清零的话第二轮会继续报 4、5、6，而不是重新从 1 开始。
    expect(await collectProgress([chars, chars])).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it("不传回调时不订阅，行为与之前一致", async () => {
    captured.responseText = JSON.stringify({ id: "suite-demo" });
    await forgeSuite(imageInput);
    expect(captured.listeners).toHaveLength(0);
  });
});
