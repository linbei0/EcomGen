import { describe, expect, it } from "vitest";

import { COPYWRITING_INSTRUCTION_SCHEMA, withStructuredOutput } from "./structured-output.js";

type StructuredOutputModel = Parameters<typeof withStructuredOutput>[1];

function completionsModel(id: string, baseUrl: string, supportsStructuredOutput = true): StructuredOutputModel {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: "provider" as never,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    compat: { supportsDeveloperRole: false },
    ecomgenSupportsStructuredOutput: supportsStructuredOutput,
  } as StructuredOutputModel;
}

describe("withStructuredOutput", () => {
  it("未声明结构化输出能力的模型不注入 response_format", () => {
    const payload = { messages: [] };
    expect(withStructuredOutput(payload, completionsModel("any-model", "https://relay.example.test/v1", false), COPYWRITING_INSTRUCTION_SCHEMA)).toBe(payload);
  });

  it("DeepSeek/DashScope/GLM 家族降级为 json_object，避免上游拒绝 json_schema", () => {
    // 既有按官方 baseUrl 命中，也有经中转站时按模型 ID 命中
    for (const model of [
      completionsModel("deepseek-chat", "https://api.deepseek.com/v1"),
      completionsModel("DeepSeek-R1", "https://relay.example.test/v1"),
      completionsModel("qwen-plus", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
      completionsModel("qwen3-max", "https://relay.example.test/v1"),
      completionsModel("glm-4.6", "https://open.bigmodel.cn/api/paas/v4"),
      completionsModel("glm-5.3-flash", "https://relay.example.test/v1"),
    ]) {
      const result = withStructuredOutput({ messages: [] }, model, COPYWRITING_INSTRUCTION_SCHEMA) as { response_format: { type: string } };
      expect(result.response_format).toEqual({ type: "json_object" });
    }
  });

  it("其他模型注入 strict json_schema", () => {
    const result = withStructuredOutput({ messages: [] }, completionsModel("gpt-4o", "https://api.openai.com/v1"), COPYWRITING_INSTRUCTION_SCHEMA) as { response_format: { type: string; json_schema: Record<string, unknown> } };
    expect(result.response_format.type).toBe("json_schema");
    expect(result.response_format.json_schema).toMatchObject({ name: "ecomgen_planning_instruction", strict: true });
  });
});
