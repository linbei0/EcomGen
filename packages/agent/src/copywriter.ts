import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { CopywritingTarget, PlatformTarget, TargetMarket } from "@ecomgen/contracts";
import { createAgent, type ReasoningModel } from "./runtime.js";
import { parseJsonResponse } from "./json-response.js";
import { COPYWRITING_DESCRIPTION_SCHEMA, COPYWRITING_INSTRUCTION_SCHEMA } from "./structured-output.js";

export interface CopywritingInput {
  target: CopywritingTarget;
  model: ReasoningModel;
  apiKey: string;
  projectName: string;
  productCategory: string | null;
  productDescription: string | null;
  verifiedFacts: string[];
  prohibitedClaims: string[];
  platformTargets: PlatformTarget[];
  targetMarket: TargetMarket | null;
  copyLanguage: string | null;
  // 素材只以 handle（P1/R1）进入模型上下文，避免数据库 ID 泄漏进提示词。
  assets: Array<{ handle: string; role: string; name: string; mimeType: string }>;
  referenceImages: ImageContent[];
}

export interface CopywritingResult {
  target: CopywritingTarget;
  content: string;
}

const SYSTEM_PROMPT = `You are an e-commerce copywriting agent. You receive project facts and visual attachments.

Critical rules:
- Output only valid JSON matching the requested schema. No Markdown fences or explanations.
- Attachments marked PRODUCT_TRUTH are the actual product. Other roles are reference material for style, layout, packaging, or atmosphere only; never identify them as the product.
- Do not invent product facts, numerical specifications, materials, certifications, prices, discounts, rankings, health claims, guarantees, shipping promises, or gifts.
- Use verifiedFacts only when they are explicitly supplied. Do not turn uncertain visual observations into factual claims.
- Respect prohibitedClaims completely. Do not paraphrase or imply them.
- For PRODUCT_DESCRIPTION, return a concise, natural product description with a product name, core selling points, suitable audience, and expected scenarios. Keep the final formatted content within 400 characters.
- For PLANNING_INSTRUCTION, return a concise, directly usable visual-planning instruction covering composition, style, lighting, product presentation, and exclusions. Do not add product facts. Keep it within 4000 characters.`;

// 帮写是单轮结构化任务，thinking 只会增加时延并挤占输出配额；超时与瞬时错误
// 重试由 boundedAgentStream 注入。
/** 使用 Pi Agent 将项目事实和带角色的视觉输入转换为可编辑文案。 */
export async function writeCopywriting(input: CopywritingInput): Promise<CopywritingResult> {
  const outputSchema = input.target === "PRODUCT_DESCRIPTION" ? COPYWRITING_DESCRIPTION_SCHEMA : COPYWRITING_INSTRUCTION_SCHEMA;
  const agent = createAgent({ workflow: "COPYWRITE", model: input.model, apiKey: input.apiKey, systemPrompt: SYSTEM_PROMPT, tools: [], outputSchema });
  const schema = input.target === "PRODUCT_DESCRIPTION"
    ? '{"productName":string,"coreSellingPoints":string[],"suitableAudience":string,"expectedScenarios":string}'
    : '{"content":string}';
  const payload = {
    target: input.target,
    projectName: input.projectName,
    productCategory: input.productCategory,
    productDescription: input.productDescription,
    verifiedFacts: input.verifiedFacts,
    prohibitedClaims: input.prohibitedClaims,
    platformTargets: input.platformTargets,
    targetMarket: input.targetMarket,
    copyLanguage: input.copyLanguage,
    visualAttachments: input.assets.map((asset, index) => ({ attachmentIndex: index + 1, ...asset })),
  };
  await agent.prompt(
    `Write copy for this project. Return ${schema}.\n${JSON.stringify(payload)}`,
    input.model.input.includes("image") ? input.referenceImages : undefined,
  );
  if (agent.state.errorMessage) throw new Error(`Copywriting model request failed: ${agent.state.errorMessage}`);
  let result: CopywritingResult;
  try {
    result = validateCopywriting(input.target, parseJsonResponse(latestAssistantText(agent.state.messages)));
  } catch (error) {
    // LLM 对字符数软约束不可靠，超限是可恢复偏差：在同一会话里追加一次有界压缩
    // 重试并留出安全余量；仍超限则按失败处理，不静默截断文案。
    if (!(error instanceof Error) || !error.message.startsWith("Copywriting model returned content longer than")) throw error;
    // 压缩目标比硬护栏再留一档余量（500/3800），避免重试结果贴着上限再次超限。
    const limit = input.target === "PRODUCT_DESCRIPTION" ? 500 : 3800;
    await agent.prompt(
      `Your previous result is too long. Rewrite it with the same JSON schema and the same facts, shortening every field so the final formatted content stays within ${limit} characters. Return only the JSON.`,
    );
    if (agent.state.errorMessage) throw new Error(`Copywriting model request failed: ${agent.state.errorMessage}`);
    result = validateCopywriting(input.target, parseJsonResponse(latestAssistantText(agent.state.messages)));
  }
  return result;
}

function latestAssistantText(messages: readonly AgentMessage[]): string {
  const response = [...messages].reverse().find((message) => message.role === "assistant");
  const text = response
    ? response.content.filter((part) => part.type === "text").map((part) => ("text" in part ? part.text : "")).join("\n")
    : "";
  if (!text) throw new Error("Copywriting model returned no text");
  return text;
}

// 产品描述的 Prompt 目标是 400 字符（产品期望的简洁度），但 LLM 对字符计数不可靠，
// 硬护栏放宽到 600 作为容差带：轻微超限直接放行，只有严重超限才触发压缩重试。
const PRODUCT_DESCRIPTION_LIMIT = 600;

export function validateCopywriting(target: CopywritingTarget, value: unknown): CopywritingResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Copywriting model returned an invalid result");
  const record = value as Record<string, unknown>;
  if (target === "PRODUCT_DESCRIPTION") {
    const productName = requiredText(record.productName, "productName");
    const sellingPoints = Array.isArray(record.coreSellingPoints)
      ? record.coreSellingPoints.map((item) => requiredText(item, "coreSellingPoints"))
      : [];
    if (sellingPoints.length === 0) throw new Error("Copywriting model returned no core selling points");
    const content = [
      `产品名称：${productName}`,
      "核心卖点：",
      ...sellingPoints.map((item) => `- ${item}`),
      `适用人群：${requiredText(record.suitableAudience, "suitableAudience")}`,
      `期望场景：${requiredText(record.expectedScenarios, "expectedScenarios")}`,
    ].join("\n");
    return { target, content: checkedLength(content, PRODUCT_DESCRIPTION_LIMIT) };
  }
  return { target, content: checkedLength(requiredText(record.content, "content"), 4000) };
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Copywriting model returned an invalid ${field}`);
  return value.trim();
}

function checkedLength(value: string, maxLength: number): string {
  if (value.length > maxLength) throw new Error(`Copywriting model returned content longer than ${maxLength} characters`);
  return value;
}
