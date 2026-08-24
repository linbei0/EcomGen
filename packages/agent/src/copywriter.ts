import { Agent } from "@earendil-works/pi-agent-core";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { CopywritingTarget, PlatformTarget, TargetMarket } from "@ecomgen/contracts";

export interface CopywritingInput {
  target: CopywritingTarget;
  model: Model<"openai-completions">;
  apiKey: string;
  projectName: string;
  productCategory: string | null;
  productDescription: string | null;
  verifiedFacts: string[];
  prohibitedClaims: string[];
  platformTargets: PlatformTarget[];
  targetMarket: TargetMarket | null;
  copyLanguage: string | null;
  assets: Array<{ id: string; role: string; name: string; mimeType: string }>;
  referenceImages: ImageContent[];
  visionAttachments?: Array<{ attachmentIndex: number; assetId: string; role: string; name: string; mimeType: string }>;
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

/** 使用 Pi Agent 将项目事实和带角色的视觉输入转换为可编辑文案。 */
export async function writeCopywriting(input: CopywritingInput): Promise<CopywritingResult> {
  const agent = new Agent({
    streamFn: openAICompletionsApi().stream,
    getApiKey: () => input.apiKey,
    initialState: {
      model: input.model,
      systemPrompt: SYSTEM_PROMPT,
      thinkingLevel: input.model.reasoning ? "medium" : "off",
      tools: [],
    },
  });
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
    visionAttachments: input.visionAttachments,
  };
  await agent.prompt(
    `Write copy for this project. Return ${schema}.\n${JSON.stringify(payload)}`,
    input.model.input.includes("image") ? input.referenceImages : undefined,
  );
  if (agent.state.errorMessage) throw new Error(`Copywriting model request failed: ${agent.state.errorMessage}`);
  const response = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
  const text = response && response.role === "assistant"
    ? response.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
    : "";
  if (!text) throw new Error("Copywriting model returned no text");
  return validateCopywriting(input.target, JSON.parse(stripJsonFence(text)));
}

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
    return { target, content: checkedLength(content, 400) };
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

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
}
