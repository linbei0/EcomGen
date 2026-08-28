import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { categoryTipFor } from "./product-family.js";

export type ConversionDriver = "VISUAL" | "PAIN_POINT" | "EMOTIONAL";
export interface UpstreamVariant { description: string; overrides: Record<string, string>; }
export interface UpstreamTemplate {
  id: string;
  name: string;
  keywords: string[];
  trigger_phrases: string[];
  prompt_template: Record<string, string>;
  defaults: Record<string, string>;
  variants: Record<string, UpstreamVariant>;
  category_tips: Record<string, string>;
  examples: string[];
  anti_ai_tips: string;
  supports_image_reference: boolean;
}
export interface EcomTemplate extends UpstreamTemplate {
  upstreamNumber: number;
  defaultSize: "1024x1024" | "1024x1536";
  productOccupancy: string;
  whitespace: string;
  camera: string;
}

export const ECOM_DETAILS_IMAGE_SOURCE = {
  repository: "https://github.com/liangdabiao/ecom-details-image",
  commit: "1ec867b743179af3598db55388f65287c4e04de1",
  sourcePath: "packages/ecom-skill/src/templates"
} as const;

const executionProfiles: Record<string, Omit<EcomTemplate, keyof UpstreamTemplate | "upstreamNumber">> = {
  "hero-image": p("1024x1024", "35-40%", "at least 45%", "slight 3/4 full-product angle"),
  "lifestyle-scene": p("1024x1024", "20-25%", "at least 50%", "high 45-degree environmental view"),
  "flat-lay": p("1024x1024", "35-40%", "at least 45%", "90-degree overhead"),
  "detail-macro": p("1024x1024", "55-60%", "at least 45%", "extreme close-up macro"),
  "poster-banner": p("1024x1024", "25-30%", "at least 45%", "asymmetric campaign composition"),
  "social-media": p("1024x1024", "40%", "at least 45%", "casual handheld framing"),
  "ugc-style": p("1024x1024", "40%", "at least 45%", "imperfect smartphone snapshot"),
  "model-showcase": p("1024x1536", "35-40%", "at least 45%", "full or medium human-centered framing"),
  "before-after": p("1024x1024", "25-30%", "at least 45%", "split-screen comparison composition"),
  packaging: p("1024x1024", "35-40%", "at least 45%", "three-quarter tabletop still life"),
  infographic: p("1024x1536", "25-30%", "at least 50%", "left-product right-information composition"),
  "creative-concept": p("1024x1024", "20-25%", "at least 50%", "dramatic conceptual perspective"),
  "size-spec": p("1024x1536", "25-30%", "at least 50%", "orthographic or clear side profile"),
  "multi-product": p("1024x1024", "60-70%", "at least 35%", "clean frontal product lineup"),
  livestream: p("1024x1024", "40%", "at least 45%", "wide livestream set view"),
  "try-on-virtual": p("1024x1536", "35-40%", "at least 45%", "full-body or torso crop"),
  "exploded-view": p("1024x1024", "35-40%", "at least 45%", "orthographic exploded arrangement"),
  "ghost-mannequin": p("1024x1536", "45-50%", "at least 45%", "front three-quarter apparel form"),
  "multi-angle-grid": p("1024x1024", "60-70%", "at least 30%", "front, side, rear and macro grid"),
  "magazine-editorial": p("1024x1536", "20-25%", "at least 50%", "editorial low-angle composition"),
  "seasonal-campaign": p("1024x1024", "25-30%", "at least 50%", "environmental campaign composition"),
  "luxury-atmospherics": p("1024x1024", "20-25%", "at least 50%", "dramatic side-lit hero view"),
  "device-mockup": p("1024x1024", "35-40%", "at least 45%", "clean device perspective"),
  storefront: p("1024x1024", "20-25%", "at least 50%", "wide store interior view"),
  "sports-campaign": p("1024x1024", "25-30%", "at least 50%", "dynamic low-angle action frame")
};

export const ECOM_TEMPLATES: readonly EcomTemplate[] = Object.freeze(loadTemplates());

export function getTemplate(templateId: string): EcomTemplate | undefined { return ECOM_TEMPLATES.find((template) => template.id === templateId); }
export function resolveTemplates(requestedTypes?: string[]): EcomTemplate[] {
  if (!requestedTypes?.length) return [];
  const resolved = new Map<string, EcomTemplate>();
  for (const requested of requestedTypes.map(normalize).filter(Boolean)) {
    const template = ECOM_TEMPLATES.find((candidate) => [candidate.id, candidate.name, ...candidate.keywords, ...candidate.trigger_phrases].some((value) => normalize(value) === requested));
    if (template) resolved.set(template.id, template);
  }
  return [...resolved.values()];
}
export function defaultTemplateSequence(driver: ConversionDriver): EcomTemplate[] {
  const ids = driver === "PAIN_POINT" ? ["hero-image", "infographic", "before-after", "lifestyle-scene", "packaging"] : driver === "EMOTIONAL" ? ["lifestyle-scene", "model-showcase", "hero-image", "ugc-style", "poster-banner"] : ["hero-image", "detail-macro", "lifestyle-scene", "before-after", "poster-banner"];
  return ids.map((id) => getTemplate(id)).filter((template): template is EcomTemplate => Boolean(template));
}
export interface TemplateGuidance {
  visualFields: Record<string, string>;
  productOccupancy: string;
  whitespace: string;
  camera: string;
  platformReservations: string[];
  categoryGuidance: string | null;
  antiAiTips: string;
}
export function templateGuidance(template: EcomTemplate, platformTargets: readonly string[], variantName?: string | null, category?: string | null): TemplateGuidance {
  const variant = variantName ? template.variants[variantName] : undefined;
  return {
    visualFields: { ...template.prompt_template, ...template.defaults, ...(variant?.overrides ?? {}) },
    productOccupancy: template.productOccupancy,
    whitespace: template.whitespace,
    camera: template.camera,
    platformReservations: platformReservationsFor(template.id, platformTargets),
    categoryGuidance: categoryTipFor(template.category_tips, category),
    antiAiTips: template.anti_ai_tips
  };
}
export function templatePromptContract(template: EcomTemplate, platformTargets: readonly string[], variantName?: string | null, category?: string | null): string {
  const variant = variantName ? template.variants[variantName] : undefined;
  const categoryTip = categoryTipFor(template.category_tips, category);
  const base = Object.entries({ ...template.prompt_template, ...template.defaults, ...(variant?.overrides ?? {}) }).map(([key, value]) => `${key}: ${value}`).join("; ");
  const reservations = platformReservationsFor(template.id, platformTargets);
  return `Upstream template ${String(template.upstreamNumber).padStart(2, "0")} ${template.name}. Template fields: ${base}. Product occupies ${template.productOccupancy}; whitespace ${template.whitespace}; camera: ${template.camera}. Use hex colors and explicit negative constraints.${reservations.length ? ` Platform reservations: ${reservations.join("; ")}.` : ""}${categoryTip ? ` Category guidance: ${categoryTip}.` : ""}${template.anti_ai_tips ? ` Anti-AI guidance: ${template.anti_ai_tips}` : ""}`;
}

const PACKSHOT_IDS = new Set(["hero-image", "ghost-mannequin", "multi-angle-grid", "flat-lay"]);
const INFO_IDS = new Set(["infographic", "poster-banner", "size-spec"]);

/** 平台规则按模板职责套用，不按分镜列表第几张；价签区不再套在每张大陆电商图上。 */
function platformReservationsFor(templateId: string, platformTargets: readonly string[]): string[] {
  const rules = new Set<string>();
  const packshot = PACKSHOT_IDS.has(templateId);
  const info = INFO_IDS.has(templateId);
  for (const platform of platformTargets) {
    if (platform === "AMAZON" && packshot) rules.add("纯白背景 #FFFFFF，主体占画面至少 85%，不要任何文字、徽章、Logo、边框或无关道具");
    else if (platform === "JD" && packshot) rules.add("纯白背景，商品居中，主体约占 80%，不要文字、拼接或诱导点击");
    else if ((platform === "TAOBAO" || platform === "PDD") && packshot) rules.add("主体占画面 70-85%，高对比，几乎不要文字；不要生成价格或 Logo");
    else if (platform === "DOUYIN" && (packshot || templateId === "lifestyle-scene" || templateId === "social-media" || templateId === "ugc-style")) rules.add("按商品卡可读来构图：中心主体、高对比，文字极少；不要二维码或他平台标识");
    else if (platform === "SHOPIFY" && packshot) rules.add("干净统一背景，集合页缩略图可识别，不要促销标");
    if (info) rules.add("仅使用已核验事实的短文案；不要生成价格、认证或未提供的承诺");
  }
  if (platformTargets.length) rules.add("不要生成价格、Logo 或促销文字");
  return [...rules];
}

function loadTemplates(): EcomTemplate[] {
  const directory = fileURLToPath(new URL("./templates/", import.meta.url));
  return readdirSync(directory).filter((name) => /^\d{2}-.+\.json$/.test(name)).sort().map((filename) => {
    const upstream = JSON.parse(readFileSync(resolve(directory, filename), "utf8")) as UpstreamTemplate;
    const profile = executionProfiles[upstream.id]; if (!profile) throw new Error(`No execution profile has been defined for upstream template ${upstream.id}`);
    return { ...upstream, ...profile, upstreamNumber: Number.parseInt(filename.slice(0, 2), 10) };
  });
}
function p(defaultSize: EcomTemplate["defaultSize"], productOccupancy: string, whitespace: string, camera: string): Omit<EcomTemplate, keyof UpstreamTemplate | "upstreamNumber"> { return { defaultSize, productOccupancy, whitespace, camera }; }
function normalize(value: string): string { return value.trim().toLowerCase(); }
