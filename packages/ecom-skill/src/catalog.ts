import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

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
    platformReservations: platformTargets.includes("DOMESTIC") ? ["预留顶部居中的价格叠加区", "预留左上角 Logo 区", "不要生成价格、Logo 或促销文字"] : [],
    categoryGuidance: category ? template.category_tips[category] ?? null : null,
    antiAiTips: template.anti_ai_tips
  };
}
export function templatePromptContract(template: EcomTemplate, platformTargets: readonly string[], variantName?: string | null, category?: string | null): string {
  const variant = variantName ? template.variants[variantName] : undefined;
  const categoryTip = category ? template.category_tips[category] : undefined;
  const base = Object.entries({ ...template.prompt_template, ...template.defaults, ...(variant?.overrides ?? {}) }).map(([key, value]) => `${key}: ${value}`).join("; ");
  const domestic = platformTargets.includes("DOMESTIC") ? " Reserve a blank top-center 200x100 price-overlay zone and blank top-left 200x100 logo zone." : "";
  return `Upstream template ${String(template.upstreamNumber).padStart(2, "0")} ${template.name}. Template fields: ${base}. Product occupies ${template.productOccupancy}; whitespace ${template.whitespace}; camera: ${template.camera}. Use hex colors and explicit negative constraints.${domestic}${categoryTip ? ` Category guidance: ${categoryTip}.` : ""}${template.anti_ai_tips ? ` Anti-AI guidance: ${template.anti_ai_tips}` : ""}`;
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
