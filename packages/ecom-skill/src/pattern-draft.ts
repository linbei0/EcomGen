import type { DraftBatchOperation, DraftComposeType } from "@ecomgen/contracts";
import { findDraftReferences } from "@ecomgen/contracts";

/**
 * AI 起稿工作台的确定性 prompt 编译层。
 *
 * 与 pod-forge.ts 同一立场：提示词是输入与参考用途的纯函数，同输入重算逐字节一致；
 * 模板固化在本文件，业务代码不再另拼一份。参考图只按用途进入文本（主体/风格/配色/构图），
 * 实际图像输入由调用方装配。
 *
 * 提示词不能替能力背书：写 "seamless" 不会让输出真的可平铺，连续花型是否合格由
 * tile-verify 的确定性判定给出；这里只表达创作意图，因此措辞是 "intended to repeat"。
 *
 * 修订下面任何一句都必须递增 DRAFT_PROMPT_VERSION，并把版本写进任务指纹相关输入。
 */
export const DRAFT_PROMPT_VERSION = "2026.10.4";

const NEGATIVE_CONSTRAINTS = "No watermark, no signature, no labels, no text or letters, no product mockup, no photographic scene: the artwork itself only.";

const BACKGROUND_WHITE = "Flatten the artwork on a plain pure-white background with crisp clean edges, even lighting, no shadows and no perspective.";

export interface DraftReferenceHint {
  /** 参考图的引用编号（界面上的「图N」），与它在本数组里的位置无关。 */
  ordinal: number;
  /** 用户在参考条目上填写的补充说明；原样透传，不翻译。 */
  notes?: string;
}

export interface DraftGeneratePromptInput {
  theme: string;
  composeType: DraftComposeType;
  background: "WHITE" | "TRANSPARENT";
  /** 本次实际下发的参考图，按下发顺序排列；同时决定 `@图N` 落在哪个 Image 号上。 */
  references?: readonly DraftReferenceHint[];
}

/**
 * 把用户写的 `@图N` 换成本次请求里图像的实际位置说法 `Image k`。
 *
 * 位置由真正下发的图像数组决定，不由编号推断：起稿时参考图从 Image 1 开始，
 * 改稿时父候选占据 Image 1，参考图从 Image 2 开始。同一句 `@图1` 在两类操作下
 * 落到的 Image 号因此不同——变的是位置的说法，编号本身始终稳定。
 * 编号在下发的图里找不到时抛错，而不是把无意义的 `@图N` 原样交给模型：
 * 宁可让这次调用明确失败，也不产生一份指向不明却看起来成功的提示词。
 */
function rewriteDraftReferences(text: string, references: readonly DraftReferenceHint[] | undefined, referenceImageOffset: number): string {
  const matches = findDraftReferences(text);
  if (!matches.length) return text;
  const imageIndexByOrdinal = new Map((references ?? []).map((reference, index) => [reference.ordinal, index + referenceImageOffset]));
  let rewritten = "";
  let cursor = 0;
  for (const match of matches) {
    const imageIndex = imageIndexByOrdinal.get(match.ordinal);
    if (imageIndex === undefined) throw new Error(`提示词引用了本次未下发的参考图：@图${match.ordinal}`);
    rewritten += text.slice(cursor, match.start) + `Image ${imageIndex}`;
    cursor = match.end;
  }
  return rewritten + text.slice(cursor);
}

/**
 * 参考图的文本提示。
 *
 * 参考图本身作为图像输入随请求附上，模型直接看得到；这里不再按用途分类猜测每张图的作用，
 * 只在用户写了备注时按图号转述备注，否则如实声明附了几张图。备注带图号是为了和提示词里的
 * `Image k` 对齐——否则模型无法知道哪条备注对应哪张图。
 */
function referenceHintLines(references: readonly DraftReferenceHint[] | undefined, referenceImageOffset: number): string[] {
  if (!references?.length) return [];
  const notes = references
    .map((reference, index) => ({ image: index + referenceImageOffset, note: reference.notes?.trim() }))
    .filter((entry): entry is { image: number; note: string } => Boolean(entry.note));
  const count = `${references.length} reference image${references.length > 1 ? "s" : ""}`;
  return notes.length
    ? [`${count} attached. Reference notes by image: ${notes.map((entry) => `Image ${entry.image}: ${entry.note}`).join("; ")}.`]
    : [`${count} attached; follow the visual direction they establish.`];
}

export function compileDraftGeneratePrompt(input: DraftGeneratePromptInput): string {
  const theme = rewriteDraftReferences(input.theme.trim(), input.references, 1);
  const compose = input.composeType === "REPEAT"
    ? "Compose as a repeating pattern artwork intended to tile continuously across fabric: distribute motifs evenly with balanced density, and let elements run naturally toward the canvas edges. Do not draw a border, frame or visible seam."
    : "Compose as one complete standalone print artwork; keep the whole motif inside the canvas with margin around it.";
  const background = input.background === "TRANSPARENT"
    ? "Isolate the artwork on a fully transparent background: no white box, no paper texture, no drop shadow, no halos and no drawn checkerboard standing in for transparency. Crisp clean edges, even lighting, no perspective."
    : BACKGROUND_WHITE;
  return [
    `Design an original print-ready pattern artwork: ${theme}.`,
    compose,
    ...referenceHintLines(input.references, 1),
    background,
    NEGATIVE_CONSTRAINTS,
  ].filter(Boolean).join(" ");
}

export interface DraftEditPromptInput {
  operation: Exclude<DraftBatchOperation, "GENERATE" | "RECOLOR" | "CUTOUT">;
  instruction: string;
  background?: "WHITE" | "TRANSPARENT";
  /** 本次实际下发的参考图，按下发顺序排列；父候选占据 Image 1，因此参考从 Image 2 开始。 */
  references?: readonly DraftReferenceHint[];
}

export function compileDraftEditPrompt(input: DraftEditPromptInput): string {
  // 改稿的图 1 是父候选（被改的那张），参考图从图 2 起算。
  const instruction = rewriteDraftReferences(input.instruction.trim(), input.references, 2);
  const scope = input.operation === "EDIT_LOCAL"
    ? "Apply the change only inside the selected region; everything outside the selection must stay exactly as it is."
    : input.operation === "SEAM_EDIT"
      ? "This image is the wrapped seam context; fix continuity across the central seam and keep the rest of the artwork unchanged."
      : "Apply the change to the whole artwork while preserving the subject and overall composition.";
  return [
    `Edit this pattern artwork: ${instruction}.`,
    scope,
    ...referenceHintLines(input.references, 2),
    input.background === "TRANSPARENT" ? "Keep the background fully transparent; reproduce the existing alpha exactly." : "",
    NEGATIVE_CONSTRAINTS,
  ].filter(Boolean).join(" ");
}

/** 色板变体：把用户色板当作配色意图，不承诺精确 HEX 替换。参考图同样从 Image 2 起算。 */
export function compileDraftPalettePrompt(input: { palette: readonly string[]; instruction?: string; references?: readonly DraftReferenceHint[] }): string {
  const colors = input.palette.map((color) => color.trim()).filter(Boolean);
  const direction = input.instruction?.trim() ? rewriteDraftReferences(input.instruction.trim(), input.references, 2) : "";
  return [
    `Recolor this pattern artwork using the provided color palette: ${colors.join(", ")}.`,
    "Map the existing design onto these colors while keeping every shape, motif position and composition exactly where they are.",
    direction ? `Additional direction: ${direction}.` : "",
    ...referenceHintLines(input.references, 2),
    "Keep the background transparent exactly as in the source; do not add or remove elements.",
  ].filter(Boolean).join(" ");
}
