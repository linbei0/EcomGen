import { Agent } from "@earendil-works/pi-agent-core";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { PlanningMode, PlatformTarget, StoryboardMode } from "@ecomgen/contracts";
import { MAX_CANDIDATES_PER_TYPE } from "@ecomgen/contracts";
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
  assets: Array<{ id: string; role: string; kind: "PRODUCT" | "REFERENCE"; name: string; mimeType: string }>;
  referenceImages?: ImageContent[];
  planningMode?: PlanningMode;
  requestedTypes?: string[];
  userInstruction?: string;
  candidatesPerType?: number;
}

export interface PlannedStoryboardItem {
  assetType: string;
  displayName: string;
  templateVariant: string | null;
  candidateCount: number;
  referencedAssets: string[];
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
- Assets with kind PRODUCT are product truth. Assets with kind REFERENCE are style, layout, or atmosphere only; never treat them as the product itself.
- PIXEL_PROTECTED means preserve supplied PRODUCT images as the product cutout. Do not promise a new unobserved angle or hidden side.
- assetType must be one of the supplied upstream template IDs. templateVariant must be null or a declared variant key for that template. Use requested template IDs exactly when present; otherwise select a conversion-oriented mix from the supplied catalog.
- displayName is a human-facing Chinese scene title generated from the actual product, viewpoint, setting, and conversion purpose. Keep it concise (usually 4-12 Chinese characters), specific, and distinct for each item. Do not copy the catalog template name, internal template ID, generic labels such as “分镜/场景图/产品主图”, numbered labels, platform names, or unsupported product facts. The title may describe the visual treatment, such as “整机斜侧展示首图”, while assetType remains the exact template ID.
- candidateCount is how many image candidates to generate for that type; keep it between 1 and the supplied candidatesPerType.
- referencedAssets lists asset IDs this item should consider. Prefer PRODUCT assets as product truth and REFERENCE assets only as style or layout hints.
- When planningMode is MANUAL, requestedTypes is the exact deliverable list: include every requested template exactly once, do not add, remove, or substitute types. Still use each selected template's prompt contract and project context to write its promptInstruction.
- riskFlags are only for material product-specific uncertainties that require human review; do not repeat generic template guidance or anti-AI style tips, and return an empty array when no material uncertainty exists.
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
  const modeInstruction = input.planningMode === "MANUAL"
    ? "Manual selection is authoritative: generate one planned item for every requested type, in the requested order, and use the selected template's full prompt contract to write each promptInstruction."
    : "Use the catalog and project context to choose a conversion-oriented storyboard.";
  await agent.prompt(`Plan this project. ${modeInstruction} Return {"campaignStyleLock":string,"items":[{"assetType":string,"displayName":string,"templateVariant":string|null,"candidateCount":number,"referencedAssets":string[],"mode":"CREATIVE"|"PIXEL_PROTECTED","promptInstruction":string,"factClaims":string[],"riskFlags":string[],"sortOrder":number}]}.\n${JSON.stringify(payload)}`, input.model.input.includes("image") ? input.referenceImages : undefined);
  if (agent.state.errorMessage) throw new Error(`Planning model request failed: ${agent.state.errorMessage}`);
  const response = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
  const text = response && response.role === "assistant" ? response.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
  if (!text) throw new Error("Planning model returned no text");
  return validatePlan(JSON.parse(stripJsonFence(text)) as PlannedStoryboard, input);
}

function stripJsonFence(value: string): string { return value.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, ""); }
function validatePlan(plan: PlannedStoryboard, input: PlannerInput): PlannedStoryboard {
  if (!plan || typeof plan.campaignStyleLock !== "string" || !Array.isArray(plan.items) || plan.items.length === 0) throw new Error("Planning model returned an invalid storyboard");
  const requestedTemplates = resolveTemplates(input.requestedTypes);
  const allowedTemplateIds = new Set((requestedTemplates.length ? requestedTemplates : ECOM_TEMPLATES).map((template) => template.id));
  if (input.planningMode === "MANUAL") {
    const expected = requestedTemplates.map((template) => template.id);
    const actual = plan.items.map((item) => item.assetType);
    if (expected.length === 0 || actual.length !== expected.length || new Set(actual).size !== actual.length || actual.some((id) => !expected.includes(id))) {
      throw new Error("Manual planning must return exactly one item for each requested template");
    }
  }
  const knownAssetIds = new Set(input.assets.map((asset) => asset.id));
  const defaultCandidates = clampCandidates(input.candidatesPerType ?? 1);
  const items = plan.items.map((item, index) => {
    const template = getTemplate(item.assetType); if (!template || !allowedTemplateIds.has(item.assetType)) throw new Error(`Planning model returned an unavailable ecom-details-image template: ${item.assetType}`);
    if (item.templateVariant !== null && item.templateVariant !== undefined && !template.variants[item.templateVariant]) throw new Error(`Planning model returned an invalid variant for ${item.assetType}: ${item.templateVariant}`);
    if (item.mode !== "CREATIVE" && item.mode !== "PIXEL_PROTECTED") throw new Error("Planning model returned an invalid storyboard mode");
    if (!item.assetType || !item.promptInstruction || typeof item.displayName !== "string" || !item.displayName.trim()) throw new Error("Planning model returned an incomplete storyboard item");
    const displayName = item.displayName.trim();
    if (displayName === template.name || displayName === item.assetType) throw new Error(`Planning model returned a generic storyboard display name for ${item.assetType}`);
    const referencedAssets = Array.isArray(item.referencedAssets) ? item.referencedAssets.filter((id) => knownAssetIds.has(id)) : [];
    return {
      assetType: item.assetType,
      displayName,
      templateVariant: item.templateVariant ?? null,
      candidateCount: clampCandidates(item.candidateCount ?? defaultCandidates),
      referencedAssets,
      mode: item.mode,
      promptInstruction: item.promptInstruction,
      sortOrder: index,
      factClaims: item.factClaims ?? [],
      riskFlags: item.riskFlags ?? []
    };
  });
  if (new Set(items.map((item) => item.displayName)).size !== items.length) throw new Error("Planning model returned duplicate storyboard display names");
  return { campaignStyleLock: plan.campaignStyleLock, items };
}

function clampCandidates(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CANDIDATES_PER_TYPE, Math.max(1, Math.round(value)));
}
