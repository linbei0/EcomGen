import { describe, expect, it } from "vitest";

import { buildReasoningModel, resolveReasoningProfile } from "./reasoning-profile.js";

describe("reasoning protocol profiles", () => {
  it("resolves DashScope Qwen to Pi compatibility settings", () => {
    expect(resolveReasoningProfile("dashscope_qwen")).toEqual({
      maxTokensField: "max_tokens",
      thinkingFormat: "qwen",
      supportsDeveloperRole: false,
    });
  });

  it("disables the developer role for the standard OpenAI profile", () => {
    expect(resolveReasoningProfile("openai")).toEqual({ supportsDeveloperRole: false });
  });

  it("builds an OpenAI Responses model when explicitly selected", () => {
    const model = buildReasoningModel({
      providerId: "provider",
      modelId: "gpt-5",
      baseUrl: "https://api.openai.com/v1",
      protocol: "openai_responses",
      supportsVision: true,
      supportsThinking: true,
      supportsStructuredOutput: true,
    });
    expect(model.api).toBe("openai-responses");
    expect(model.ecomgenSupportsStructuredOutput).toBe(true);
  });

  it("builds a Pi model from provider and model capabilities", () => {
    const model = buildReasoningModel({
      providerId: "provider",
      modelId: "qwen3.6-plus",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      protocol: "dashscope_qwen",
      supportsVision: false,
      supportsThinking: true,
    });

    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(["text"]);
    expect(model.maxTokens).toBe(16_384);
    expect(model.compat).toEqual({ maxTokensField: "max_tokens", thinkingFormat: "qwen", supportsDeveloperRole: false });
  });
});
