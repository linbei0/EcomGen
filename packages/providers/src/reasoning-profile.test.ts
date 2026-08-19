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

  it("leaves the standard OpenAI profile on Pi defaults", () => {
    expect(resolveReasoningProfile("openai")).toBeUndefined();
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
    expect(model.compat).toEqual({ maxTokensField: "max_tokens", thinkingFormat: "qwen", supportsDeveloperRole: false });
  });
});
