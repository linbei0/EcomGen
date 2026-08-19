import { Agent } from "@earendil-works/pi-agent-core";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { PlatformTarget, StoryboardMode } from "@ecomgen/contracts";
import { ECOM_DETAILS_IMAGE_SOURCE, ECOM_TEMPLATES, getTemplate, resolveTemplates, templatePromptContract } from "@ecomgen/ecom-skill";

export interface PlannerInput {
  model: Model<"openai-completions">;
  apiKey: string;
  projectName: string;
  productCategory: string | null;
  productDescription: string | null;
  verifiedFacts: string[];
  prohibitedClaims: string[];
  brandGuidelines: Record<string, string>;
  platformTargets: PlatformTarget[];
  defaultMode: StoryboardMode;
  variants: Array<{ id: string; name: string; attributes: Record<string, string> }>;
  assets: Array<{ id: string; role: string; variantId: string | null; name: string; mimeType: string }>;
  referenceImages?: ImageContent[];
  requestedTypes?: string[];
  requestedCount?: number;
}

export interface PlannedStoryboardItem {
  assetType: string;
  templateVariant: string | null;
  variantScope: "COMMON" | string;
  mode: StoryboardMode;
  promptInstruction: string;
  factClaims: string[];
  riskFlags: string[];
  sortOrder: number;
}
export interface PlannedStoryboard { campaignStyleLock: string; items: PlannedStoryboardItem[]; }

const SYSTEM_PROMPT = `You are the planning agent for an e-commerce image-suite product. Your visual playbook is derived from liangdabiao/ecom-details-image (MIT): use a coherent campaign style lock, select a conversion-oriented progression, and make every requested deliverable an editable storyboard item. Work for general products and both DOMESTIC Chinese marketplace and Amazon.

Critical rules:
- Output only valid JSON matching the requested schema. No Markdown.
- Do not invent verifiable product facts: price, dimensions, materials, certifications, health claims, gifts, guarantees, numerical performance, or shipping promises. If a fact is not in the input, do not put it in factClaims or visible copy instructions.
- variantScope is exactly COMMON or one supplied variant ID. Never combine different variants in one item.
- PIXEL_PROTECTED means preserve supplied PRODUCT_TRUTH pixels as the product cutout. Do not promise a new unobserved angle or hidden side.
- assetType must be one of the supplied upstream template IDs. templateVariant must be null or a declared variant key for that template. Use requested template IDs exactly when present; otherwise select a conversion-oriented mix from the supplied catalog.
- The campaignStyleLock must be concise and reusable across all images.`;

export async function planStoryboard(input: PlannerInput): Promise<PlannedStoryboard> {
  const agent = new Agent({
    streamFn: openAICompletionsApi().stream,
    getApiKey: () => input.apiKey,
    initialState: { model: input.model, systemPrompt: SYSTEM_PROMPT, thinkingLevel: input.model.reasoning ? "medium" : "off", tools: [] }
  });
  const selectedTemplates = resolveTemplates(input.requestedTypes);
  const payload = {
    ...input,
    apiKey: undefined,
    model: undefined,
    referenceImages: undefined,
    upstream: ECOM_DETAILS_IMAGE_SOURCE,
    allowedTemplates: (selectedTemplates.length ? selectedTemplates : ECOM_TEMPLATES).map((template) => ({ id: template.id, name: template.name, keywords: template.keywords, triggerPhrases: template.trigger_phrases, promptTemplate: template.prompt_template, defaults: template.defaults, variants: template.variants, categoryTips: template.category_tips, examples: template.examples, antiAiTips: template.anti_ai_tips, supportsImageReference: template.supports_image_reference, promptContract: templatePromptContract(template, input.platformTargets) }))
  };
  await agent.prompt(`Plan this project. Return {"campaignStyleLock":string,"items":[{"assetType":string,"templateVariant":string|null,"variantScope":string,"mode":"CREATIVE"|"PIXEL_PROTECTED","promptInstruction":string,"factClaims":string[],"riskFlags":string[],"sortOrder":number}]}.\n${JSON.stringify(payload)}`, input.model.input.includes("image") ? input.referenceImages : undefined);
  if (agent.state.errorMessage) throw new Error(`Planning model request failed: ${agent.state.errorMessage}`);
  const response = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
  const text = response && response.role === "assistant" ? response.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
  if (!text) throw new Error("Planning model returned no text");
  return validatePlan(JSON.parse(stripJsonFence(text)) as PlannedStoryboard, input);
}

function stripJsonFence(value: string): string { return value.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, ""); }
function validatePlan(plan: PlannedStoryboard, input: PlannerInput): PlannedStoryboard {
  if (!plan || typeof plan.campaignStyleLock !== "string" || !Array.isArray(plan.items) || plan.items.length === 0) throw new Error("Planning model returned an invalid storyboard");
  const validVariants = new Set(["COMMON", ...input.variants.map((variant) => variant.id)]);
  const requestedTemplates = resolveTemplates(input.requestedTypes);
  const allowedTemplateIds = new Set((requestedTemplates.length ? requestedTemplates : ECOM_TEMPLATES).map((template) => template.id));
  const count = input.requestedCount ? Math.min(input.requestedCount, plan.items.length) : plan.items.length;
  const items = plan.items.slice(0, count).map((item, index) => {
    const template = getTemplate(item.assetType); if (!template || !allowedTemplateIds.has(item.assetType)) throw new Error(`Planning model returned an unavailable ecom-details-image template: ${item.assetType}`);
    if (item.templateVariant !== null && item.templateVariant !== undefined && !template.variants[item.templateVariant]) throw new Error(`Planning model returned an invalid variant for ${item.assetType}: ${item.templateVariant}`);
    if (!validVariants.has(item.variantScope)) throw new Error(`Planning model returned unknown variant scope: ${item.variantScope}`);
    if (item.mode !== "CREATIVE" && item.mode !== "PIXEL_PROTECTED") throw new Error("Planning model returned an invalid storyboard mode");
    if (!item.assetType || !item.promptInstruction) throw new Error("Planning model returned an incomplete storyboard item");
    return { ...item, templateVariant: item.templateVariant ?? null, sortOrder: index, factClaims: item.factClaims ?? [], riskFlags: item.riskFlags ?? [] };
  });
  return { campaignStyleLock: plan.campaignStyleLock, items };
}
