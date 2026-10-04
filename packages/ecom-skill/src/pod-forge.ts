import type { PatternBackgroundMode, PodPrintCategory } from "@ecomgen/contracts";

import { PATTERN_FLAT_PRINT_REGISTER, PATTERN_NEGATIVE_CONSTRAINTS, patternBackgroundClause } from "./pattern-prompt-fragments.js";

/**
 * 花型工坊的确定性 prompt 编译层（同 model-cast.ts 的设计立场）：
 * 起稿/提取的提示词是输入的纯函数——同输入重算逐字节一致，任务指纹因此可复现；
 * 模板固化在本文件，不经 LLM 改写，也不允许业务代码在旁边另拼一份。
 *
 * 底版、印刷 register 与排除项来自 pattern-prompt-fragments.ts：那些片段与 AI 起稿工作台共用，
 * 措辞依据（官方提示词指南）也记在那里。
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

/**
 * 起稿提示词版本：必须进入任务指纹（api 侧）。
 *
 * 指纹只覆盖 theme/style/category/candidateCount/name 这些输入，不含编译后的提示词——
 * 不把版本写进指纹，改模板后同输入的旧任务会被判为可复用，用户拿到旧模板的产物，
 * 而且没有任何地方说明为什么。修订下面任何一句都必须递增这个常量。
 */
export const PATTERN_FORGE_PROMPT_VERSION = "2026.10.2";

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

/**
 * 编译 AI 起稿 prompt：一张可直接入库的花型图稿。
 *
 * 底版由调用方按"用户选择 + 模型能力"判定后传入，本函数只把结论编译进文本，不做能力猜测。
 */
export function compilePatternForgePrompt(input: PatternForgeInput): string {
  const theme = input.theme.trim();
  const style = input.style?.trim();
  const composition = input.category ? CATEGORY_COMPOSITION[input.category] : undefined;
  // 顺序固定为「媒介 → 主体 → 风格 → 构图 → 底版 → 排除项」：先定产物类别再描述内容，
  // 是官方指南给出的稳定结构，也让提示词在日志里可以按段落扫读。
  return [
    PATTERN_FLAT_PRINT_REGISTER,
    `Subject: one original print-ready pattern artwork of ${theme}.`,
    style ? `Style: ${style}.` : "",
    composition ?? "",
    patternBackgroundClause(input.background),
    PATTERN_NEGATIVE_CONSTRAINTS,
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

/**
 * 提取提示词版本：两种提取方式共用，必须进入任务指纹（api 侧）。
 *
 * 分割提示与生成提示任一措辞修订都要递增——指纹里没有版本时，改模板后同输入的旧任务会被
 * 判为可复用，用户拿到旧模板的产物。该常量补上之前提取指纹不含提示词版本的缺口。
 */
export const PATTERN_EXTRACT_PROMPT_VERSION = "2026.10.2";

export interface PatternGenerateExtractInput {
  /** 补充描述（用户输入，中英皆可），原样透传为 Hints。 */
  brief?: string;
  /** 底版要求。能力判定（模型能不能给真透明底）不在这里做，调用方判定后把结论传进来。 */
  background: Exclude<PatternBackgroundMode, "SOURCE">;
}

/**
 * 编译生成式提取 prompt：让生图模型把商品实拍图上的图案摊平重绘成可入库的花型图稿。
 *
 * 与分割提取（compilePatternExtractPrompt）指向同一个目标物——商品上的印花图案本身，
 * 但产物是模型重绘：实拍图上的透视、褶皱与光影是分割路线给不了干净图稿的原因，
 * 生成路线按"正面平铺、完整图案"重画一遍。重绘允许重画呈现方式，但图案本身的颜色、
 * 纹样与构图必须忠实于源图——这是提取（而非创作）的边界。底版与排除项复用共享片段：
 * 生成提取的产物会与起稿/衍生的产物并排出现在同一个花型墙里，可印性约束必须一致。
 */
export function compilePatternGenerateExtractPrompt(input: PatternGenerateExtractInput): string {
  const hint = input.brief?.trim();
  return [
    "Extract the printed graphic artwork from this product photo into one print-ready flat pattern: redraw the complete decorative pattern itself squared-up front view, not the product body, hardware, shadows, wrinkles or background.",
    "Keep the artwork's own colors, motifs and composition faithful to the source photo.",
    patternBackgroundClause(input.background),
    PATTERN_NEGATIVE_CONSTRAINTS,
    hint ? `Hints: ${hint}` : "",
  ].filter(Boolean).join(" ");
}
