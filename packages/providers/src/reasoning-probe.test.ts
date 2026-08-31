import { describe, expect, it, vi } from "vitest";

const streamSimple = vi.hoisted(() => vi.fn());
const responsesStreamSimple = vi.hoisted(() => vi.fn());
vi.mock("@earendil-works/pi-ai/api/openai-completions.lazy", () => ({
  openAICompletionsApi: () => ({ streamSimple }),
}));
vi.mock("@earendil-works/pi-ai/api/openai-responses.lazy", () => ({
  openAIResponsesApi: () => ({ streamSimple: responsesStreamSimple }),
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

  it("uses the Responses adapter for the explicit Responses protocol", async () => {
    responsesStreamSimple.mockReturnValue((async function* () {
      yield { type: "done", reason: "stop", message: { content: [{ type: "text", text: "OK" }] } };
    })());

    await expect(probeReasoning({
      providerId: "provider",
      modelId: "gpt-5",
      baseUrl: "https://api.openai.com/v1",
      protocol: "openai_responses",
      supportsVision: false,
      supportsThinking: true,
      supportsStructuredOutput: true,
      apiKey: "secret",
    })).resolves.toMatchObject({ text: "OK" });
    expect(responsesStreamSimple).toHaveBeenCalledWith(expect.objectContaining({ api: "openai-responses" }), expect.any(Object), expect.objectContaining({ apiKey: "secret", maxTokens: 512 }));
  });
});
