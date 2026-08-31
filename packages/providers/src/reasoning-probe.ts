import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";

import { ProviderError } from "./openai-compatible.js";
import { buildReasoningModel, type ReasoningModelInput } from "./reasoning-profile.js";

export interface ReasoningProbeInput extends ReasoningModelInput {
  apiKey: string;
}

export interface ReasoningProbeResult {
  latencyMs: number;
  text: string;
}

export async function probeReasoning(input: ReasoningProbeInput): Promise<ReasoningProbeResult> {
  const started = Date.now();
  const model = buildReasoningModel(input);
  const options = { apiKey: input.apiKey, maxTokens: 512, ...(input.supportsThinking ? { reasoning: "low" as const } : {}) };
  const stream = input.protocol === "openai_responses" ? openAIResponsesApi().streamSimple(
    model,
    {
      systemPrompt: "Reply with exactly OK.",
      messages: [{ role: "user", content: "Reply with exactly OK.", timestamp: Date.now() }],
    },
    options,
  ) : openAICompletionsApi().streamSimple(
    model,
    {
      systemPrompt: "Reply with exactly OK.",
      messages: [{ role: "user", content: "Reply with exactly OK.", timestamp: Date.now() }],
    },
    options,
  );
  for await (const event of stream) {
    if (event.type === "error") throw new ProviderError(event.error.errorMessage ?? "Reasoning probe failed", 502);
    if (event.type === "done") {
      const text = event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
      if (!text) throw new ProviderError("Reasoning probe returned no text", 502);
      return { latencyMs: Date.now() - started, text };
    }
  }
  throw new ProviderError("Reasoning probe stream ended without a final message", 502);
}
