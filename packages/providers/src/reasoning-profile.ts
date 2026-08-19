import type { ReasoningProtocolProfile } from "@ecomgen/contracts";
import type { Model, OpenAICompletionsCompat } from "@earendil-works/pi-ai";

export interface ReasoningModelInput {
  providerId: string;
  modelId: string;
  baseUrl: string;
  protocol: ReasoningProtocolProfile;
  supportsVision: boolean;
  supportsThinking: boolean;
}

/** 将业务层的协议 Profile 映射为 Pi 的 OpenAI-compatible 兼容参数。 */
export function resolveReasoningProfile(profile: ReasoningProtocolProfile): OpenAICompletionsCompat | undefined {
  switch (profile) {
    case "openai":
      return undefined;
    case "dashscope_qwen":
      return { maxTokensField: "max_tokens", thinkingFormat: "qwen", supportsDeveloperRole: false };
    default:
      return assertNever(profile);
  }
}

export function buildReasoningModel(input: ReasoningModelInput): Model<"openai-completions"> {
  return {
    id: input.modelId,
    name: input.modelId,
    api: "openai-completions",
    provider: input.providerId as never,
    baseUrl: input.baseUrl,
    reasoning: input.supportsThinking,
    input: input.supportsVision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_000,
    compat: resolveReasoningProfile(input.protocol),
  };
}

function assertNever(value: never): never { throw new Error(`Unsupported reasoning protocol profile: ${String(value)}`); }
