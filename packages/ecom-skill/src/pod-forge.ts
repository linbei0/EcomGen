import type { PatternBackgroundMode, PodPrintCategory } from "@ecomgen/contracts";

/**
 * 花型工坊的确定性 prompt 编译层（同 model-cast.ts 的设计立场）：
 * 起稿/提取的提示词是输入的纯函数——同输入重算逐字节一致，任务指纹因此可复现；
 * 模板固化在本文件，不经 LLM 改写，也不允许业务代码在旁边另拼一份。
 */

export interface PatternForgeInput {
  /** 图案主题描述（用户输入，中英皆可）。 */
  theme: string;
  /** 风格画种（可选，如 watercolor / geometric / line art）。 */
  style?: string;
  /** 目标承印品类（可选）：只影响构图建议，不改变画布与像素。 */
  category?: PodPrintCategory;
  /**
   * 底版要求（可选，缺省白底）。
   *
   * 起稿没有源图，所以这里收窄掉 `SOURCE`——它只对"以既有花型为参考图"的衍生有意义。
   * 能力判定（模型能不能给真透明底）不在这里做，调用方判定后把结论传进来。
   */
  background?: Exclude<PatternBackgroundMode, "SOURCE">;
}

/** 品类构图建议表：一行一句英文构图约束，新增品类时在此登记，不写进业务代码。 */
const CATEGORY_COMPOSITION: Partial<Record<PodPrintCategory, string>> = {
  TSHIRT: "Compose as a single centered front-print motif with breathing room around the artwork, suitable for a T-shirt chest print.",
  HOODIE: "Compose as a single centered chest-print motif with generous margins, suitable for a hoodie front print.",
  MUG_11OZ: "Compose within a wide horizontal band, suitable for the wrap area of an 11oz mug.",
  POSTER: "Compose as a poster-grade artwork with a deliberate focal hierarchy and clean margins.",
  TOTE_BAG: "Compose as a bold, readable motif that stays legible on woven fabric at distance.",
  PHONE_CASE: "Compose as a compact vertical motif that survives a small, curved print surface.",
};

const FORGE_NEGATIVE_CONSTRAINTS = "No watermark, no signature, no text or letters, no product mockup, no background scene: the artwork itself only.";

/**
 * 起稿提示词版本：必须进入任务指纹（api 侧）。
 *
 * 指纹只覆盖 theme/style/category/candidateCount/name 这些输入，不含编译后的提示词——
 * 不把版本写进指纹，改模板后同输入的旧任务会被判为可复用，用户拿到旧模板的产物，
 * 而且没有任何地方说明为什么。修订下面任何一句都必须递增这个常量。
 */
export const PATTERN_FORGE_PROMPT_VERSION = "2026.10.1";

/**
 * 底版模式的中文标签，起稿与衍生两处的选择控件共用。
 *
 * 与 prompt 片段放在同一个包里：标签说的正是片段要求的事，分开维护最容易出现
 * "片段已经改了、标签还在描述旧行为"。`SOURCE` 只对衍生可选。
 */
export const PATTERN_BACKGROUND_MODE_LABELS: Record<PatternBackgroundMode, string> = {
  SOURCE: "跟随源图",
  WHITE: "白底",
  TRANSPARENT: "透明底",
};

/** 不支持透明底时的底板要求：白底，可由「提取」链路的分割模型再转成透明底。 */
const FORGE_BACKGROUND_OPAQUE = "Flatten the artwork on a plain pure-white background with crisp clean edges, even lighting, no shadows and no perspective.";

/**
 * 支持透明底时的底板要求。
 *
 * 透明要求同时写在提示词与请求参数（background: "transparent"）两处：参数保证 alpha 通道，
 * 提示词负责别让模型自己铺一块白底——只给参数时它仍可能那么做。明写 no drawn checkerboard，
 * 是因为画出来的棋盘格不是透明；那正是 worker 必须解码校验 alpha 的原因，一句祈使句不能替代校验。
 */
const FORGE_BACKGROUND_TRANSPARENT = "Isolate the artwork on a fully transparent background: no white box, no paper texture, no drop shadow, no halos and no drawn checkerboard standing in for transparency. Crisp clean edges, even lighting, no perspective.";

/**
 * 编译 AI 起稿 prompt：一张可直接入库的花型图稿。
 *
 * 底版由调用方按"用户选择 + 模型能力"判定后传入，本函数只把结论编译进文本，不做能力猜测。
 */
export function compilePatternForgePrompt(input: PatternForgeInput): string {
  const theme = input.theme.trim();
  const style = input.style?.trim();
  const composition = input.category ? CATEGORY_COMPOSITION[input.category] : undefined;
  return [
    `Design an original print-ready pattern artwork: ${theme}.`,
    style ? `Art style: ${style}.` : "",
    composition ?? "",
    input.background === "TRANSPARENT" ? FORGE_BACKGROUND_TRANSPARENT : FORGE_BACKGROUND_OPAQUE,
    FORGE_NEGATIVE_CONSTRAINTS,
  ].filter(Boolean).join(" ");
}

/** 花型名称缺省派生：主题截断 + 日期，保证列表里可辨认且确定可复现。 */
export function defaultPatternName(theme: string): string {
  const normalized = theme.replace(/\s+/g, " ").trim();
  const stem = normalized.length > 24 ? `${normalized.slice(0, 24)}…` : normalized;
  const date = new Date().toISOString().slice(0, 10);
  return stem ? `${stem} · ${date}` : `花型 · ${date}`;
}

/**
 * 编译提取用途的分割文本提示：目标是商品上的印花图案本身，排除商品本体与背景。
 * brief 原样透传（用户词表是最准确的指向），不放英文改写——分割模型按图文匹配取目标。
 */
export function compilePatternExtractPrompt(brief?: string): string {
  const base = "the printed graphic artwork on the product: only the decorative pattern itself, not the product body, hardware, shadows or background";
  const hint = brief?.trim();
  return hint ? `${base}. Hints: ${hint}` : base;
}
