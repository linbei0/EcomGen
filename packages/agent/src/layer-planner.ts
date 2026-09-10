import type { ImageContent } from "@earendil-works/pi-ai";
import { createAgent, type ReasoningModel } from "./runtime.js";
import { parseJsonResponse } from "./json-response.js";
import { LAYER_ELEMENTS_OUTPUT_SCHEMA } from "./structured-output.js";

export interface LayerElementPlannerInput {
  model: ReasoningModel;
  apiKey: string;
  image: ImageContent;
  maxElements?: number;
}

export interface PlannedLayerElement {
  name: string;
  /** 与 name 指同一物体的英文分割提示；部分分割渠道（如 Gitee AI SAM 3）只接受英文 prompt。 */
  promptEn: string;
}

// 分层导出的元素识别只负责产出"语义名称清单"；mask 由 SAM 3 按名称/画框生成。
// 名称质量直接决定 SAM 文本提示的命中率，因此约束为具体物件短语而非场景描述。
// name 供界面展示，promptEn 供文本提示分割渠道使用：已实测中文 prompt 在此类渠道命中率为 0。
const SYSTEM_PROMPT = `# Role
You are a layer planner for an e-commerce image workspace. You look at one rendered product image and list the distinct physical elements a designer would want as separate Photoshop layers.

# Output
Output only valid JSON matching the requested schema. No Markdown.

# Rules
- Each element is one distinct physical object or object part visible in the image (for example: bottle body, cap, pump head, box, lid, straw, accessory, badge).
- Do NOT list the background, surface, shadow, reflection, lighting, or the whole product as one element.
- Order elements from foreground/most visually prominent to least prominent.
- Names are short concrete Chinese noun phrases (2-10 Chinese characters), suitable as segmentation prompts; no scene descriptions, no marketing words.
- For every element also give promptEn: the equivalent English phrase (1-4 plain English words, for example "bottle body", "pump head"). It is used verbatim as an English text prompt for segmentation, so keep it a concrete object phrase with no scene or marketing wording.`;

export async function planLayerElements(input: LayerElementPlannerInput): Promise<PlannedLayerElement[]> {
  const maxElements = Math.min(32, Math.max(1, input.maxElements ?? 12));
  const agent = createAgent({ workflow: "LAYER_PLAN", model: input.model, apiKey: input.apiKey, systemPrompt: SYSTEM_PROMPT, tools: [], outputSchema: LAYER_ELEMENTS_OUTPUT_SCHEMA });
  await agent.prompt(`List the separable physical elements in this product image. Return {"elements":[{"name":string,"promptEn":string}]} with at most ${maxElements} elements, ordered foreground first.`, input.model.input.includes("image") ? [input.image] : undefined);
  if (agent.state.errorMessage) throw new Error(`Layer planning model request failed: ${agent.state.errorMessage}`);
  const response = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
  const text = response && response.role === "assistant" ? response.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
  if (!text) throw new Error("Layer planning model returned no text");
  return validateLayerElements(parseJsonResponse(text) as { elements?: unknown }, maxElements);
}

function validateLayerElements(value: { elements?: unknown }, maxElements: number): PlannedLayerElement[] {
  const entries = Array.isArray(value?.elements) ? value.elements : [];
  if (entries.length === 0) throw new Error("Layer planning model returned no elements");
  const seen = new Set<string>();
  const elements: PlannedLayerElement[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const raw = record.name;
    const rawPromptEn = record.promptEn;
    if (typeof raw !== "string" || typeof rawPromptEn !== "string") continue;
    const name = raw.trim();
    const promptEn = rawPromptEn.trim();
    // promptEn 与 name 同为必产出字段：缺英文提示的元素无法服务文本提示分割渠道，直接丢弃该条目。
    if (!name || name.length > 60 || !promptEn || promptEn.length > 80 || seen.has(name)) continue;
    seen.add(name);
    elements.push({ name, promptEn });
    if (elements.length >= maxElements) break;
  }
  if (elements.length === 0) throw new Error("Layer planning model returned no usable element names");
  return elements;
}
