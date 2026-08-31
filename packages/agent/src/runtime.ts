import { createHash } from "node:crypto";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { ECOM_TEMPLATES_HASH } from "@ecomgen/ecom-skill";
import { boundedAgentStream } from "./stream.js";
import { withStructuredOutput, type StructuredOutputSchema } from "./structured-output.js";

export type AgentWorkflow = "PLAN" | "COPYWRITE" | "EDIT_PLAN" | "PROMPT_REVISION";
export type ReasoningModel = Model<"openai-completions" | "openai-responses">;

export interface AgentRuntimeOptions {
  workflow: AgentWorkflow;
  model: ReasoningModel;
  apiKey: string;
  systemPrompt: string;
  tools: AgentTool[];
  outputSchema: StructuredOutputSchema;
}

export function promptVersion(options: Pick<AgentRuntimeOptions, "systemPrompt" | "tools" | "outputSchema" | "model">): string {
  const stableTools = options.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
  return createHash("sha256").update(JSON.stringify({ systemPrompt: options.systemPrompt, tools: stableTools, outputSchema: options.outputSchema, skillHash: ECOM_TEMPLATES_HASH, api: options.model.api, provider: options.model.provider })).digest("hex").slice(0, 16);
}

export function createAgent(options: AgentRuntimeOptions): Agent {
  const version = promptVersion(options);
  const sessionId = `ecomgen:${options.workflow}:${version}:${options.model.provider}:${options.model.id}`;
  return new Agent({
    streamFn: boundedAgentStream(),
    getApiKey: () => options.apiKey,
    sessionId,
    onPayload: (payload, model) => withStructuredOutput(payload, model as ReasoningModel, options.outputSchema),
    initialState: {
      model: options.model,
      systemPrompt: options.systemPrompt,
      thinkingLevel: options.workflow === "COPYWRITE" ? "off" : options.model.reasoning ? "medium" : "off",
      tools: options.tools,
    },
  });
}
