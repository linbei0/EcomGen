import { describe, expect, it, vi } from "vitest";

const streamSimple = vi.hoisted(() => vi.fn());
vi.mock("@earendil-works/pi-ai/api/openai-completions.lazy", () => ({
  openAICompletionsApi: () => ({ streamSimple }),
}));

import { probeReasoning } from "./reasoning-probe.js";

describe("reasoning probe", () => {
  it("uses the resolved Pi profile and returns final text", async () => {
    streamSimple.mockReturnValue((async function* () {
      yield { type: "done", reason: "stop", message: { content: [{ type: "text", text: "OK" }] } };
    })());

    await expect(probeReasoning({
      providerId: "provider",
      modelId: "qwen3.6-plus",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      protocol: "dashscope_qwen",
      supportsVision: false,
      supportsThinking: true,
      apiKey: "secret",
    })).resolves.toMatchObject({ text: "OK" });

    expect(streamSimple).toHaveBeenCalledWith(expect.objectContaining({ compat: { maxTokensField: "max_tokens", thinkingFormat: "qwen", supportsDeveloperRole: false } }), expect.any(Object), expect.objectContaining({ apiKey: "secret", maxTokens: 512 }));
  });
});
