import type { ReasoningProtocolProfile } from "@ecomgen/contracts";
import type { Model, OpenAICompletionsCompat } from "@earendil-works/pi-ai";

export interface ReasoningModelInput {
  providerId: string;
  modelId: string;
  baseUrl: string;
  protocol: ReasoningProtocolProfile;
  supportsVision: boolean;
  supportsThinking: boolean;
  supportsStructuredOutput?: boolean;
}

/** 将业务层的协议 Profile 映射为 Pi 的 OpenAI-compatible 兼容参数。 */
export function resolveReasoningProfile(profile: ReasoningProtocolProfile): OpenAICompletionsCompat | undefined {
  switch (profile) {
    case "openai":
      // "openai" 表示经 OpenAI-compatible 中转站访问各类上游（GLM/DeepSeek/Qwen 等），
      // 它们普遍不识别 developer 角色，真实 OpenAI 也仍接受 system；
      // //显式禁用，避免 Pi 对未知模型族自动启用 developer role。其余字段留给Pi 按 baseUrl/模型族判定。
      return { supportsDeveloperRole: false };
    case "dashscope_qwen":
      return { maxTokensField: "max_tokens", thinkingFormat: "qwen", supportsDeveloperRole: false };
    case "openai_responses":
      return undefined;
    default:
      return assertNever(profile);
  }
}

// 部分中转站（如 NewAPI 前置 WAF）会按 User-Agent 拦截 openai SDK 的默认UA
const PROVIDER_USER_AGENT = "EcomGen/1.0";

export function buildReasoningModel(input: ReasoningModelInput): Model<"openai-completions" | "openai-responses"> & { ecomgenSupportsStructuredOutput: boolean } {
  const api = input.protocol === "openai_responses" ? "openai-responses" : "openai-completions";
  return {
    id: input.modelId,
    name: input.modelId,
    api,
    provider: input.providerId as never,
    baseUrl: input.baseUrl,
    headers: { "User-Agent": PROVIDER_USER_AGENT },
    reasoning: input.supportsThinking,
    input: input.supportsVision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    // OpenAI-completions 协议下 thinking 与正文共享 max_tokens 配额；规划需要一次性输出
    // 多个分镜的完整最终 Prompt，8K 容易被截断成非法 JSON，因此提高上限并留出余量。
    maxTokens: 16_384,
    compat: resolveReasoningProfile(input.protocol),
    ecomgenSupportsStructuredOutput: input.supportsStructuredOutput === true && input.protocol !== "dashscope_qwen",
  };
}

function assertNever(value: never): never { throw new Error(`Unsupported reasoning protocol profile: ${String(value)}`); }
