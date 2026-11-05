import { GeminiImageProvider } from "./gemini.js";
import type { ProviderConnection } from "./openai-compatible.js";
import { OpenAiCompatibleImageProvider, ProviderError } from "./openai-compatible.js";

/** 保存前从 Provider 的 /models 端点发现可用模型 ID 的结果。 */
export interface ProviderModelDiscoveryResult {
  models: string[];
  latencyMs: number;
}

/** trim → 跳过空 ID → 去重 → 排序；中转站列表常有几百项且无稳定顺序，排序让选择器可扫描。 */
function normalizeModels(models: string[]): string[] {
  const seen = new Set<string>();
  for (const model of models) {
    const id = model.trim();
    if (id !== "") seen.add(id);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** 把单次尝试的失败压缩成可拼进合并消息的短语；不携带上游原始文本，避免泄露密钥或长 HTML。 */
function describeAttempt(error: unknown): string {
  if (error instanceof ProviderError) return `HTTP ${error.status}`;
  if (error instanceof Error && error.name === "TimeoutError") return "request timed out";
  if (error instanceof SyntaxError) return "response is not JSON";
  return "network error";
}

/**
 * 自动识别模型列表方言：先按 OpenAI 兼容形态（Bearer + {data:[{id}]}，中转站、官方 API 与
 * DashScope compatible-mode 的主流形态）请求 /models；未识别（鉴权被拒、端点缺失或响应形状
 * 不符）时回退 Gemini 原生形态（x-goog-api-key + {models:[{name}]}）。两次都是零费用 GET；
 * Gemini 原生端点不认 Bearer，必然在第一次尝试暴露 401 后由回退命中。两次都失败时合并
 * 两次尝试的状态，让用户能区分「密钥被拒」与「端点不支持列模型」。
 */
export async function discoverProviderModels(connection: ProviderConnection): Promise<ProviderModelDiscoveryResult> {
  const started = Date.now();
  let openAiFailure: string;
  try {
    const probe = await new OpenAiCompatibleImageProvider(connection).probe();
    // null 表示端点返回 200 但响应里没有可识别的 data 数组（不支持 OpenAI 列表方言）
    if (probe.models !== null) return { models: normalizeModels(probe.models), latencyMs: Date.now() - started };
    openAiFailure = "response has no OpenAI model list";
  } catch (error) {
    openAiFailure = describeAttempt(error);
  }
  let geminiFailure: string;
  try {
    const probe = await new GeminiImageProvider(connection).probe();
    if (probe.models !== null) return { models: normalizeModels(probe.models), latencyMs: Date.now() - started };
    geminiFailure = "response has no Gemini model list";
  } catch (error) {
    geminiFailure = describeAttempt(error);
  }
  throw new ProviderError(`Unable to list models (OpenAI-compatible: ${openAiFailure}; Gemini: ${geminiFailure})`, 502);
}
