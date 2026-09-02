import type { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { EditExecutionMode, EditOperation, PlanningMode, PlatformTarget, StoryboardMode, StoryboardShotRole, TargetMarket } from "@ecomgen/contracts";
import { DEFAULT_TARGET_IMAGE_COUNT, MAX_CANDIDATES_PER_TYPE, MAX_GENERATION_REFERENCE_IMAGES, MAX_TARGET_IMAGE_COUNT, MIN_TARGET_IMAGE_COUNT } from "@ecomgen/contracts";
import { ECOM_DETAILS_IMAGE_SOURCE, ECOM_TEMPLATES, getTemplate, resolveTemplates } from "@ecomgen/ecom-skill";
import { createPlanningTools, type WebResearchConfig } from "./tools.js";
import { createAgent, type ReasoningModel } from "./runtime.js";
import { parseJsonResponse } from "./json-response.js";
import { EDIT_PLAN_OUTPUT_SCHEMA, PROMPT_REVISION_SCHEMA, STORYBOARD_OUTPUT_SCHEMA } from "./structured-output.js";
export type { WebResearchConfig } from "./tools.js";

export interface PlannerInput {
  model: ReasoningModel;
  apiKey: string;
  projectName: string;
  productCategory: string | null;
  productDescription: string | null;
  verifiedFacts: string[];
  prohibitedClaims: string[];
  brandGuidelines: Record<string, string>;
  platformTargets: PlatformTarget[];
  targetMarket: TargetMarket | null;
  copyLanguage: string | null;
  defaultMode: StoryboardMode;
  assets: Array<{ id: string; role: string; kind: "PRODUCT" | "REFERENCE"; name: string; mimeType: string }>;
  referenceImages?: ImageContent[];
  visionAttachments?: Array<{ attachmentIndex: number; assetId: string; role: string; name: string; mimeType: string }>;
  planningMode?: PlanningMode;
  requestedTypes?: string[];
  userInstruction?: string;
  candidatesPerType?: number;
  targetImageCount?: number;
  webResearch?: WebResearchConfig;
}

export interface PlannedStoryboardItem {
  assetType: string;
  displayName: string;
  shotRole: StoryboardShotRole;
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

// 大项目（多图、多分镜）的规划轮次可能持续数分钟；pi-ai 默认无超时且 maxRetries=0，
// 长连接挂起会一直阻塞到任务失败，因此显式给出每轮超时和瞬时错误重试。
// 提示按节组织（Role/Output/Facts/Structure/Visual style/Tools/Final prompt contract），
// 通用规则在前、特定覆盖在后；Visual style 给出配色来源链与色板内变化规则，避免模型退回无据可依的白底默认。
const SYSTEM_PROMPT = `# Role
You are the planning agent for an e-commerce image-suite product. Your visual playbook is derived from liangdabiao/ecom-details-image (MIT): use a coherent campaign style lock, select a conversion-oriented progression, and make every requested deliverable an editable storyboard item. Work for general products on TAOBAO, JD, PDD, DOUYIN, AMAZON, and SHOPIFY.

# Output
Output only valid JSON matching the requested schema. No Markdown.

# Facts and product truth
- Do not invent verifiable product facts: price, dimensions, materials, certifications, health claims, gifts, guarantees, numerical performance, or shipping promises. If a fact is not in the input, do not put it in factClaims or visible copy instructions.
- Assets with kind PRODUCT are product truth. Assets with kind REFERENCE are style, layout, or atmosphere only; never treat them as the product itself.
- PIXEL_PROTECTED means preserve supplied PRODUCT images as the product cutout. Do not promise a new unobserved angle or hidden side.
- riskFlags are only for material product-specific uncertainties that require human review; do not repeat generic template guidance or anti-AI style tips, and return an empty array when no material uncertainty exists.

# Storyboard structure
- assetType must be one of the supplied upstream template IDs. templateVariant must be null or a declared variant key for that template. Use requested template IDs exactly when present; otherwise select a conversion-oriented mix from the supplied catalog using the product category first and the platform only to shape hero/feed frames.
- displayName is a human-facing Chinese scene title generated from the actual product, viewpoint, setting, and conversion purpose. Keep it concise (usually 4-12 Chinese characters), specific, and distinct for each item. Do not copy the catalog template name, internal template ID, generic labels such as “分镜/场景图/产品主图”, numbered labels, platform names, or unsupported product facts. The title may describe the visual treatment, such as “整机斜侧展示首图”, while assetType remains the exact template ID.
- candidateCount is how many image candidates to generate for that type; keep it between 1 and the supplied candidatesPerType.
- referencedAssets lists asset IDs this item should consider. Prefer PRODUCT assets as product truth and REFERENCE assets only as style or layout hints.
- visionAttachments maps each image attachment index to an asset ID and role. Inspect the supplied images, then use only those real asset IDs in referencedAssets.
- PRODUCT attachments are the only source of product appearance truth. REFERENCE attachments may guide style, composition, packaging, labels, or layout, but never replace or redefine the product.
- When planningMode is MANUAL, requestedTypes is the exact deliverable list: include every requested template exactly once, in the requested order; do not add, remove, reorder, or substitute types, including extra feed packshots. Platform and product category only change each prompt. Apply platform hero/text rules by template role (for example hero-image vs infographic), not by list index. Read platform guidance once, then read all selected templates in one read_ecom_template call using their templateIds before writing final prompts.

# Shot roles
- Every item must declare exactly one shotRole describing its conversion task: HERO (instant product recognition for the first frame), PAIN_POINT (visualize the buyer problem in the buyer's language), COMPARISON (before/after, old/new, or parameter contrast made self-evident), SCENE (realistic use context), DETAIL (material, craftsmanship, texture close-up), TRUST (visual quality evidence such as construction, finish, or packaging care), VARIANT (color/spec/bundle matrix), CTA (spec, size reference, or decision-support framing).
- Assign roles along the conversion narrative: HERO first, then a mix of PAIN_POINT, COMPARISON, SCENE, DETAIL, TRUST, VARIANT, and CTA that fits this product. Do not stack repeated tasks.
- Dedup rule: when two items share the same shotRole, they must use different assetType templates. Two items with the same assetType must not share the same shotRole. Adjacent items must not read as the same visual task.

# Visual style
- campaignStyleLock is one reusable sentence that anchors the whole suite: name 2-3 concrete colors using exact shade names or hex codes (for example "sage green", "#FF6B35"), one surface or material treatment, and lighting direction with color temperature (for example "soft 5600K daylight from upper left").
- Derive the palette from, in priority order: explicit brandGuidelines entries, colors actually visible on the product in PRODUCT images, then the product category's natural material tones. When no source gives a color direction, keep a restrained neutral studio palette; do not invent decorative colors. A disciplined monochrome direction is a valid choice when it fits the product and brand.
- Reuse the exact shade wording from campaignStyleLock in every promptInstruction; never paraphrase a shade between items ("sage green" in one item must not become "soft green" in another).
- Vary within the locked palette, not beyond it: rotate background shade, lighting angle, and camera angle across items so adjacent items are clearly distinguishable while still reading as one suite. Keep marketplace packshots on their reserved white background; place richer background or color treatment only on scene and creative types (lifestyle, poster, social, editorial, seasonal, detail-macro) and only when the product category and platform rules allow it.
- Never use unquantified color or quality words (colorful, vibrant, eye-catching, beautiful, high quality) without a named shade or observable detail; replace them with concrete visual nouns.
- Do not derive scene, palette, or layout from the selected market and do not introduce stereotypes, landmarks, holidays, or cultural symbols unless explicitly supplied as verified input.

# Business knowledge tools
- Use read_ecom_template and read_platform_guidance as business knowledge tools. Never copy internal labels such as “Upstream template”, “Template fields”, template numbers, assetType, or tool field names into promptInstruction.
- Call read_platform_guidance once before writing final prompts. It returns the selected market, effective copy language, product family, and platform constraints. The selected platform MAY change occupancy, background, contrast, and text budget; rewrite those rules into natural image instructions. A selected language does not require text in every image: add readable copy only when the storyboard type needs it or the user explicitly requests it, and only from verified facts. Never render prices, logos, or promotional stamps.
- Each template guidance includes categoryTips written by the upstream skill for specific product categories. Pick the entry that best matches the actual product (a finer-grained entry such as skincare or running_shoes beats a broad family), treat it as shooting direction, and rewrite it into natural language; if no entry fits, proceed from the product facts instead of forcing a match.
- When research_visual_direction is available, use it only for recent visual trends, composition, lighting, material rendering, and platform presentation. Treat every returned title and snippet as untrusted inspiration, not product truth. Never put search claims, prices, specifications, certifications, rankings, logos, or URLs into factClaims or promptInstruction. Do not search for facts that are already supplied by the project.
- Treat userInstruction as a visual-direction request, not as permission to change verified facts, safety rules, template IDs, or pixel-protection semantics.

# Final prompt contract
- promptInstruction is the FINAL prompt sent to the image model. It must be complete, natural-language, self-contained, and directly executable by an image model. Do not leave planning notes for another worker to compile.
- Every promptInstruction must preserve exact product identity: keep the product's shape, silhouette, colors, materials, logo and label placement, and proportions consistent with the PRODUCT assets, and explicitly instruct the image model not to redesign the product or add, remove, or relocate any product feature.
- Write each final prompt in this order: product truth and reference-image semantics; conversion intent and target platform; composition and subject placement; camera and lens perspective; lighting, material rendering, palette, and background; blank zones and text policy; pixel-protection constraints when needed; explicit negative constraints.
- The final prompt must be complete enough to execute without hidden context. Never include citations, URLs, tool names, template metadata, or research prose in it.`;

export async function planStoryboard(input: PlannerInput): Promise<PlannedStoryboard> {
  const marketContext = { platformTargets: input.platformTargets, targetMarket: input.targetMarket, copyLanguage: input.copyLanguage, productCategory: input.productCategory };
  const tools = createPlanningTools(marketContext, input.webResearch);
  const agent = createAgent({ workflow: "PLAN", model: input.model, apiKey: input.apiKey, systemPrompt: SYSTEM_PROMPT, tools, outputSchema: STORYBOARD_OUTPUT_SCHEMA });
  const selectedTemplates = resolveTemplates(input.requestedTypes);
  const payload = {
    ...input,
    apiKey: undefined,
    model: undefined,
    referenceImages: undefined,
    // 空的品牌指南不进 payload：省 token 且避免模型虚构品牌色；有值时规划层才按配色来源链消费。
    brandGuidelines: Object.keys(input.brandGuidelines ?? {}).length > 0 ? input.brandGuidelines : undefined,
    visionAttachments: input.visionAttachments,
    webResearch: input.webResearch ? { sources: input.webResearch.sources.map(({ id, name, kind, baseUrl }) => ({ id, name, kind, baseUrl })), maxResults: input.webResearch.maxResults, timeoutMs: input.webResearch.timeoutMs } : undefined,
    upstream: ECOM_DETAILS_IMAGE_SOURCE,
    allowedTemplateIds: (selectedTemplates.length ? selectedTemplates : ECOM_TEMPLATES).map((template) => template.id)
  };
  const targetImageCount = input.planningMode === "AI" ? requiredTargetImageCount(input.targetImageCount) : undefined;
  const modeInstruction = input.planningMode === "MANUAL"
    ? "Manual selection is authoritative: generate one planned item for every requested type, in the requested order. Do not add a platform feed extra shot. Read the platform guidance once and call read_ecom_template once with all matching templateIds, then write each promptInstruction as the final image-model prompt using product-category tips and platform occupancy/text rules for that template role."
    : `Use the catalog and project context to choose a conversion-oriented storyboard with exactly ${targetImageCount} planned items. Choose image types from the product category/family first (what this product must show), then adapt hero and feed frames to the selected platform. Do not pick types from the platform alone. Read the current market and platform guidance with the business tool before writing final prompts.`;
  await agent.prompt(`Plan this project. ${modeInstruction} Return {"campaignStyleLock":string,"items":[{"assetType":string,"displayName":string,"shotRole":"HERO"|"PAIN_POINT"|"COMPARISON"|"SCENE"|"DETAIL"|"TRUST"|"VARIANT"|"CTA","templateVariant":string|null,"candidateCount":number,"referencedAssets":string[],"mode":"CREATIVE"|"PIXEL_PROTECTED","promptInstruction":string,"factClaims":string[],"riskFlags":string[],"sortOrder":number}]}. Every promptInstruction must explicitly instruct the image model to preserve exact product identity and not redesign the product.\n${JSON.stringify(payload)}`, input.model.input.includes("image") ? input.referenceImages : undefined);
  if (agent.state.errorMessage) throw new Error(`Planning model request failed: ${agent.state.errorMessage}`);
  // 一次规划动辄数分钟，JSON 解析或校验失败时先带着错误回传给模型修复一轮，避免整体作废。
  const firstFailure = planFailureReason(assistantText(agent), input);
  if (!firstFailure) return validatePlan(parseJsonResponse(assistantText(agent)) as PlannedStoryboard, input);
  await agent.prompt(`Your previous response could not be used: ${firstFailure}\nReturn the complete corrected storyboard JSON object matching the requested schema. Output only valid JSON, no Markdown fences, no explanations.`);
  if (agent.state.errorMessage) throw new Error(`Planning model request failed: ${agent.state.errorMessage}`);
  return validatePlan(parseJsonResponse(assistantText(agent)) as PlannedStoryboard, input);
}

function assistantText(agent: Agent): string {
  const response = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
  const text = response && response.role === "assistant" ? response.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
  if (!text) throw new Error("Planning model returned no text");
  return text;
}

/** 返回导致规划结果不可用的原因；可用时返回 null，作为修复回环的判定依据。 */
function planFailureReason(text: string, input: PlannerInput): string | null {
  try {
    validatePlan(parseJsonResponse(text) as PlannedStoryboard, input);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export interface PromptRevisionInput {
  model: ReasoningModel;
  apiKey: string;
  prompt: string;
  revision: string;
}

export async function reviseImagePrompt(input: PromptRevisionInput): Promise<string> {
  const agent = createAgent({ workflow: "PROMPT_REVISION", model: input.model, apiKey: input.apiKey, systemPrompt: "You revise an existing final image-generation prompt. Return only a JSON object with a complete final prompt in the prompt field. Preserve all existing product-truth, product-identity, and safety constraints unless the revision explicitly changes the visual direction.", tools: [], outputSchema: PROMPT_REVISION_SCHEMA });
  await agent.prompt(`Existing final prompt:\n${input.prompt}\n\nRevision request:\n${input.revision}\n\nReturn {"prompt":string}; the prompt is sent directly to the image model.`);
  if (agent.state.errorMessage) throw new Error(`Prompt revision model request failed: ${agent.state.errorMessage}`);
  const response = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
  const text = response && response.role === "assistant" ? response.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim() : "";
  if (!text) throw new Error("Prompt revision model returned no text");
  const value = parseJsonResponse(stripJsonFence(text)) as { prompt?: unknown };
  const prompt = assertFinalPrompt(typeof value?.prompt === "string" ? value.prompt : "");
  return prompt;
}

export interface EditPlannerInput {
  model: ReasoningModel;
  apiKey: string;
  message: string;
  annotations: Record<string, unknown>;
  hasEditMask: boolean;
  hasCanvasExpansion: boolean;
  referenceAssets: Array<{ id: string; name: string; role: string; source?: string; purpose?: string; order?: number }>;
  memorySummary: { summary?: string; constraints?: string[] };
  projectFacts: string[];
  imageCapabilities?: { supportsMaskEdit: boolean; supportsUnmaskedEdit: boolean; supportsMultiReference: boolean; supportsOutpaint: boolean; supportsInputFidelity: boolean; supportsNaturalBlend: boolean };
  sourceImage?: ImageContent;
}

export interface PlannedEdit {
  operation: EditOperation;
  executionMode: EditExecutionMode;
  userSummary: string;
  prompt: string;
  targetAnnotationIds: string[];
  targetDescription: string;
  targetConfidence: number;
  clarification: string | null;
  requiresConfirmation: boolean;
  compositePolicy: "MASK_LOCKED" | "NATURAL_BLEND" | "OUTPAINT" | "PROVIDER_RESULT";
  memoryPatch: { summary?: string; constraints?: string[] };
}

export async function planImageEdit(input: EditPlannerInput): Promise<PlannedEdit> {
  const agent = createAgent({ workflow: "EDIT_PLAN", model: input.model, apiKey: input.apiKey, systemPrompt: "You are an image-editing planner for an e-commerce workspace. Return only a JSON object matching the requested schema. Preserve product truth, user-protected areas, mask semantics, reference purposes, and provider capability constraints. The prompt must be a complete final image-edit prompt.", tools: [], outputSchema: EDIT_PLAN_OUTPUT_SCHEMA });
  const annotationIds = annotationIdList(input.annotations);
  await agent.prompt(`Plan this edit. Return {"operation":string,"executionMode":string,"userSummary":string,"prompt":string,"targetAnnotationIds":string[],"targetDescription":string,"targetConfidence":number,"clarification":string|null,"requiresConfirmation":boolean,"compositePolicy":string,"memoryPatch":{"summary":string,"constraints":string[]}}. For NEED_INPUT, prompt may be empty but clarification must explain the missing decision.\n${JSON.stringify({ ...input, model: undefined, apiKey: undefined, sourceImage: undefined, annotationIds })}`, input.model.input.includes("image") ? [input.sourceImage].filter((image): image is ImageContent => Boolean(image)) : undefined);
  if (agent.state.errorMessage) throw new Error(`Edit planning model request failed: ${agent.state.errorMessage}`);
  const response = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
  const text = response && response.role === "assistant" ? response.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
  if (!text) throw new Error("Edit planning model returned no text");
  return validateEditPlan(parseJsonResponse(text) as PlannedEdit, input, annotationIds);
}

function annotationIdList(annotations: Record<string, unknown>): string[] {
  const entries = Array.isArray(annotations.annotations) ? annotations.annotations : [];
  return entries.flatMap((annotation) => annotation && typeof annotation === "object" && typeof (annotation as Record<string, unknown>).id === "string" ? [(annotation as Record<string, unknown>).id as string] : []);
}

function validateEditPlan(plan: PlannedEdit, input: EditPlannerInput, annotationIds: string[]): PlannedEdit {
  const operations: EditOperation[] = ["PRECISE_INPAINT", "PRODUCT_REPLACE", "SCENE_ADJUST", "OUTPAINT", "NATURAL_FUSION"];
  const executionModes: EditExecutionMode[] = ["MODEL_DIRECTED", "MASKED", "OUTPAINT", "NEED_INPUT"];
  if (!plan || !operations.includes(plan.operation) || !executionModes.includes(plan.executionMode) || !plan.userSummary?.trim() || typeof plan.targetDescription !== "string" || typeof plan.targetConfidence !== "number" || !Number.isFinite(plan.targetConfidence) || plan.targetConfidence < 0 || plan.targetConfidence > 1) throw new Error("Edit planning model returned an invalid plan");
  const targets = Array.isArray(plan.targetAnnotationIds) ? plan.targetAnnotationIds.filter((id): id is string => typeof id === "string" && annotationIds.includes(id)) : [];
  if (plan.operation === "PRODUCT_REPLACE" && input.referenceAssets.length === 0) throw new Error("REFERENCE_ASSET_REQUIRED");
  if (plan.operation === "OUTPAINT" && !input.hasCanvasExpansion) throw new Error("OUTPAINT_CANVAS_REQUIRED");
  if (input.hasEditMask && plan.executionMode !== "MASKED") throw new Error("EDIT_PLAN_MASK_REQUIRED");
  if (plan.operation === "PRECISE_INPAINT" && plan.executionMode !== "MASKED") throw new Error("EDIT_PLAN_MASK_REQUIRED");
  if (plan.executionMode === "MASKED" && !input.hasEditMask) throw new Error("EDIT_TARGET_REQUIRED");
  if (plan.executionMode === "OUTPAINT" && !input.hasCanvasExpansion) throw new Error("OUTPAINT_CANVAS_REQUIRED");
  if (plan.executionMode === "MODEL_DIRECTED" && !input.hasEditMask && !input.sourceImage) throw new Error("EDIT_VISION_REQUIRED");
  if (plan.executionMode === "NEED_INPUT" && !plan.clarification?.trim()) throw new Error("Edit planning model returned an invalid plan");
  if (plan.executionMode !== "NEED_INPUT" && !plan.prompt?.trim()) throw new Error("Edit planning model returned an invalid plan");
  const requiresConfirmation = plan.executionMode !== "NEED_INPUT" && (plan.executionMode === "MODEL_DIRECTED" || ["PRODUCT_REPLACE", "SCENE_ADJUST", "OUTPAINT", "NATURAL_FUSION"].includes(plan.operation));
  const compositePolicy = plan.executionMode === "MASKED" ? "MASK_LOCKED" : plan.executionMode === "OUTPAINT" ? "OUTPAINT" : "PROVIDER_RESULT";
  return { operation: plan.operation, executionMode: plan.executionMode, userSummary: plan.userSummary.trim(), prompt: plan.prompt?.trim() ?? "", targetAnnotationIds: targets, targetDescription: plan.targetDescription.trim(), targetConfidence: plan.targetConfidence, clarification: plan.clarification?.trim() || null, requiresConfirmation, compositePolicy, memoryPatch: plan.memoryPatch ?? {} };
}

function stripJsonFence(value: string): string { return value.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, ""); }

const SHOT_ROLES: readonly StoryboardShotRole[] = ["HERO", "PAIN_POINT", "COMPARISON", "SCENE", "DETAIL", "TRUST", "VARIANT", "CTA"];

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
  } else if (plan.items.length !== requiredTargetImageCount(input.targetImageCount)) {
    throw new Error(`AI planning must return exactly ${requiredTargetImageCount(input.targetImageCount)} storyboard items`);
  }
  const knownAssetIds = new Set(input.assets.map((asset) => asset.id));
  const defaultCandidates = clampCandidates(input.candidatesPerType ?? 1);
  const items = plan.items.map((item, index) => {
    const template = getTemplate(item.assetType); if (!template || !allowedTemplateIds.has(item.assetType)) throw new Error(`Planning model returned an unavailable ecom-details-image template: ${item.assetType}`);
    if (item.templateVariant !== null && item.templateVariant !== undefined && !template.variants[item.templateVariant]) throw new Error(`Planning model returned an invalid variant for ${item.assetType}: ${item.templateVariant}`);
    if (item.mode !== "CREATIVE" && item.mode !== "PIXEL_PROTECTED") throw new Error("Planning model returned an invalid storyboard mode");
    if (!SHOT_ROLES.includes(item.shotRole)) throw new Error(`Planning model returned an invalid shotRole for ${item.assetType}: ${String(item.shotRole)}. Use one of ${SHOT_ROLES.join(", ")}`);
    if (!item.assetType || !item.promptInstruction || typeof item.displayName !== "string" || !item.displayName.trim()) throw new Error("Planning model returned an incomplete storyboard item");
    assertFinalPrompt(item.promptInstruction);
    const displayName = item.displayName.trim();
    if (displayName === template.name || displayName === item.assetType) throw new Error(`Planning model returned a generic storyboard display name for ${item.assetType}`);
    const referencedAssets = Array.isArray(item.referencedAssets) ? [...new Set(item.referencedAssets.filter((id) => knownAssetIds.has(id)))] : [];
    const nonProductReferences = referencedAssets.filter((id) => input.assets.find((asset) => asset.id === id)?.kind === "REFERENCE");
    if (nonProductReferences.length > MAX_GENERATION_REFERENCE_IMAGES) {
      throw new Error(`Storyboard item may reference at most ${MAX_GENERATION_REFERENCE_IMAGES} non-product images`);
    }
    return {
      assetType: item.assetType,
      displayName,
      shotRole: item.shotRole,
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
  // 视觉任务去重：同角色重复时必须换模板，否则套图会回到"多张同质图"的失败模式。
  const roleKeys = new Set<string>();
  for (const item of items) {
    const key = `${item.shotRole}|${item.assetType}`;
    if (roleKeys.has(key)) throw new Error(`Planning model returned duplicate visual-task assignment: shotRole ${item.shotRole} with template ${item.assetType} appears more than once`);
    roleKeys.add(key);
  }
  return { campaignStyleLock: plan.campaignStyleLock, items };
}

function requiredTargetImageCount(value: number | undefined): number {
  const count = value ?? DEFAULT_TARGET_IMAGE_COUNT;
  if (!Number.isInteger(count) || count < MIN_TARGET_IMAGE_COUNT || count > MAX_TARGET_IMAGE_COUNT) {
    throw new Error(`targetImageCount must be an integer between ${MIN_TARGET_IMAGE_COUNT} and ${MAX_TARGET_IMAGE_COUNT}`);
  }
  return count;
}

function assertFinalPrompt(prompt: string): string {
  const value = prompt.trim();
  if (!value) throw new Error("Planning model returned an empty final image prompt");
  if (/upstream template|template fields|anti-ai guidance|category guidance|promptcontract/i.test(value)) {
    throw new Error("Planning model exposed internal template metadata in the final image prompt; please regenerate the storyboard");
  }
  return value;
}

function clampCandidates(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CANDIDATES_PER_TYPE, Math.max(1, Math.round(value)));
}
