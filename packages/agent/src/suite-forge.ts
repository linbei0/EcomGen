import type { ImageContent } from "@earendil-works/pi-ai";
import { forgeSystemPrompt } from "@ecomgen/ecom-suite-forge";
import { createAgent, type ReasoningModel } from "./runtime.js";
import { parseJsonResponse } from "./json-response.js";
import { SUITE_FORGE_OUTPUT_SCHEMA } from "./structured-output.js";

/** 用户在页面上可选的反推约束；缺省时由模型按套图自身特征推断。 */
export interface SuiteForgeHints {
  name?: string;
  l1?: string;
  l2?: string;
  leaf?: string;
  productFamily?: string;
  targetShotCount?: number;
  userInstruction?: string;
}

export interface SuiteForgeInput {
  model: ReasoningModel;
  apiKey: string;
  images: ImageContent[];
  hints?: SuiteForgeHints;
}

// 套图反推把一组爆款整图拆解为可复用的套图模板 JSON；只产出模板，不生成图片，也不绑定具体产品。
// 因此这里只做视觉理解 + JSON 结构化输出，产出交回 Worker 校验与入库。
export async function forgeSuite(input: SuiteForgeInput): Promise<Record<string, unknown>> {
  const agent = createAgent({ workflow: "SUITE_FORGE", model: input.model, apiKey: input.apiKey, systemPrompt: forgeSystemPrompt(), tools: [], outputSchema: SUITE_FORGE_OUTPUT_SCHEMA });
  await agent.prompt(buildInstruction(input.images.length, input.hints), input.model.input.includes("image") ? input.images : undefined);
  if (agent.state.errorMessage) throw new Error(`Suite forge model request failed: ${agent.state.errorMessage}`);
  const response = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
  const text = response && response.role === "assistant" ? response.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
  if (!text) throw new Error("Suite forge model returned no text");
  const parsed = parseJsonResponse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Suite forge model did not return a JSON object");
  return parsed as Record<string, unknown>;
}

function buildInstruction(imageCount: number, hints: SuiteForgeHints = {}): string {
  const lines = [`Analyze the ${imageCount} reference image${imageCount === 1 ? "" : "s"} of this single product set and forge ONE reusable suite template.`];
  if (hints.l1) lines.push(`Use category L1 exactly: ${hints.l1}`);
  if (hints.l2) lines.push(`Use category L2 exactly: ${hints.l2}`);
  if (hints.leaf) lines.push(`Use this leaf product name: ${hints.leaf}`);
  if (hints.name) lines.push(`Use this suite name: ${hints.name}`);
  if (hints.productFamily) lines.push(`Use productFamily: ${hints.productFamily}`);
  if (hints.targetShotCount) lines.push(`Produce about ${hints.targetShotCount} shots.`);
  if (hints.userInstruction) lines.push(`Additional requirement: ${hints.userInstruction}`);
  lines.push("Return only the suite JSON.");
  return lines.join("\n");
}
