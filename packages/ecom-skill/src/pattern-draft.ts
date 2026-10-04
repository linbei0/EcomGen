import type { DraftComposeType } from "@ecomgen/contracts";
import { findDraftReferences, rewriteDraftPalettes } from "@ecomgen/contracts";

import { PATTERN_BACKGROUND_TRANSPARENT, PATTERN_BACKGROUND_WHITE, PATTERN_FLAT_PRINT_REGISTER, PATTERN_NEGATIVE_CONSTRAINTS } from "./pattern-prompt-fragments.js";

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
export const DRAFT_PROMPT_VERSION = "2026.10.8";

/**
 * 连续花型的构图要求：这是"打算平铺"的表述，不是"已经平铺"。
 *
 * 措辞按 POD 行业的公开规范逐条收紧：
 * - 平铺失败的常见成因不是密度，而是四边不接续：全局的光照渐变与晕影让对边各自偏亮偏暗，
 *   落单的视觉中心让画面朝中间收，画框与留白直接在接缝处形成硬边，所以这几项显式排除。
 * - 两种构造都成立（Spoonflower《What's a Seamless Repeating Pattern?》）：母题在单元内居中、
 *   边缘留纯净底色时，直接拼接就不会有缝；母题跨边延续时，拼起来是一整片连续花型。
 *   因此这里不强制跨边，只禁止真正的失败形态——在边界处被切掉半枚母题。
 * 先说要什么再排除什么：模型对"no X"式纯否定不如对正面描述敏感。
 */
const COMPOSE_REPEAT = "Compose it as one repeat tile of an all-over pattern: an even field of evenly distributed motifs with no single focal point, so that repeating the tile side by side reads as one uninterrupted surface. Keep every motif either fully inside the tile with even spacing, or continuing cleanly across the tile edge so it meets its own continuation on the opposite side; what must never happen is a motif cut off mid-shape at the boundary. Do not draw a border, frame, margin or seam line. Light the whole tile with flat, uniform illumination and keep every part of it at one brightness level: no directional light, no shadow and no vignette anywhere in the frame, because a gradient or vignette across the tile is what makes the repeat visible.";

/** 单幅印花：整枚母题必须留在画布内，不留裁切风险。 */
const COMPOSE_PLACEMENT = "Compose it as one complete standalone print artwork: keep the whole motif inside the canvas with even margin on all sides, nothing cropped at the edges.";

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
 *
 * 通用方向句只在起稿时发，因为它描述的是"这些图整体作为参考"。改稿的参考图必然是用户逐个
 * `@` 出来的，用途已经写在他自己的措辞里，再补一句"作为风格、配色与母题的视觉方向"会与那句话打架。
 */
function referenceHintLines(references: readonly DraftReferenceHint[] | undefined, referenceImageOffset: number, emitDirection: boolean): string[] {
  if (!references?.length) return [];
  const lines: string[] = [];
  if (emitDirection) {
    const count = `${references.length} reference image${references.length > 1 ? "s" : ""}`;
    // 单复数与指代都要对上：只有一张时写 "them" 会让模型去找那张并不存在的第二张图。
    const direction = references.length > 1
      ? "use them as visual direction for style, palette and motifs"
      : "use it as visual direction for style, palette and motifs";
    lines.push(`${count} attached: ${direction}.`);
  }
  const notes = references
    .map((reference, index) => ({ image: index + referenceImageOffset, note: reference.notes?.trim() }))
    .filter((entry): entry is { image: number; note: string } => Boolean(entry.note));
  if (notes.length) lines.push(`Reference notes by image: ${notes.map((entry) => `Image ${entry.image}: ${entry.note}`).join("; ")}.`);
  return lines;
}

/**
 * 配色意图句：文本里的色值只表达"往这个颜色靠"，不是逐像素的 HEX 替换。
 *
 * 这两句从原「色板变体」操作整句搬过来，一字未改——那个操作消失不代表它做不到的事就变少了。
 * 放在全局说明而不是色值内部：色值在句子里只是一个词，关于"精度到哪"的限定属于整段说明。
 * 句子里说的 bracketed 指的是改写后的 `[配色 #d9a441]`，那是模型看到的形式，用户输入的就是色值本身。
 */
const PALETTE_INTENT = "Where a bracketed color group appears, treat it as the intended color scheme: move the palette toward it rather than reproducing those exact hex values, keep every shape, motif position and composition exactly where it is, do not re-render textures, and do not add or remove elements.";

export function compileDraftGeneratePrompt(input: DraftGeneratePromptInput): string {
  const theme = rewriteDraftReferences(input.theme.trim(), input.references, 1);
  // 主题框里也可以直接写色值：正文说明它是文本 token，不该只有改稿那一侧认它。
  const palette = rewriteDraftPalettes(theme);
  return [
    PATTERN_FLAT_PRINT_REGISTER,
    `Subject: one original print-ready pattern artwork of ${palette.text}.`,
    input.composeType === "REPEAT" ? COMPOSE_REPEAT : COMPOSE_PLACEMENT,
    palette.hasPalette ? PALETTE_INTENT : "",
    ...referenceHintLines(input.references, 1, true),
    input.background === "TRANSPARENT" ? PATTERN_BACKGROUND_TRANSPARENT : PATTERN_BACKGROUND_WHITE,
    PATTERN_NEGATIVE_CONSTRAINTS,
  ].filter(Boolean).join(" ");
}

export interface DraftEditPromptInput {
  /**
   * 本次下发的源图上是否叠着用户画的笔迹——"整图"与"按笔迹"的唯一区别。
   *
   * 合并前这里是一个 operation（EDIT_LOCAL / EDIT_WHOLE），现在是这一个布尔：有笔迹才谈得上
   * "笔迹指到哪就改哪"，没有笔迹就只能要求"只改说明说的"。用布尔而不是让调用方自己挑一句范围话，
   * 是为了让"哪句话成立"这件事只在一个地方决定。
   */
  annotated: boolean;
  instruction: string;
  background?: "WHITE" | "TRANSPARENT";
  /** 本次实际下发的参考图，按下发顺序排列；父候选占据 Image 1，因此参考从 Image 2 开始。 */
  references?: readonly DraftReferenceHint[];
}

/**
 * 带笔迹的范围句。两件事必须都说，缺一条都会出事：
 * - 笔迹是"要改这里"的指示，不是画面内容：不说清，模型会把它当成原图的一部分原样保留。
 * - 笔迹必须在结果里彻底消失：局部改稿最典型的失败形态就是留下半透明的色斑或描边轮廓。
 *
 * 同时不承诺"笔迹外逐像素不变"：源图整张交给模型，没有哪条边界是可保证的，这句话兑现不了。
 */
const ANNOTATED_SCOPE = "The coloured strokes painted over that image are the user's marks showing where the change goes; they are annotations, not artwork. Apply the change at the marked areas and erase the marks completely: nothing of their colour, outline or texture may remain in the result. Keep everything outside the marked areas as close to the original as the change allows.";

/** 无笔迹（整图）的范围句：没有任何边界可以承诺，只能要求"只动说明里说的"。 */
const WHOLE_IMAGE_SCOPE = "Change only what the instruction asks for and keep everything else the same: subject, motif positions, composition, color character and the flat print register all stay as they are, and no elements are added or removed.";

function editScope(input: DraftEditPromptInput): string {
  return input.annotated ? ANNOTATED_SCOPE : WHOLE_IMAGE_SCOPE;
}

export function compileDraftEditPrompt(input: DraftEditPromptInput): string {
  // 改稿的图 1 是父候选（被改的那张），参考图从图 2 起算。
  const instruction = rewriteDraftReferences(input.instruction.trim(), input.references, 2);
  const palette = rewriteDraftPalettes(instruction);
  return [
    "Image 1 is the pattern artwork to edit; the change below applies to that image.",
    `Edit it: ${palette.text}.`,
    editScope(input),
    palette.hasPalette ? PALETTE_INTENT : "",
    ...referenceHintLines(input.references, 2, false),
    input.background === "TRANSPARENT" ? "Keep the background fully transparent; reproduce the existing alpha exactly." : "",
    PATTERN_NEGATIVE_CONSTRAINTS,
  ].filter(Boolean).join(" ");
}

/**
 * 新建草图时预填的备注，按创作类型各一句。
 *
 * 草图以普通参考图身份参与（见 ADR-0004），没有类型字段，"约束构图而不是提供风格"这层语义
 * 只能由备注承担。这两句是用户可见、可改、可删的默认值，不是隐藏语义。
 *
 * 连续花型那句额外要求把草图当作可平铺单元：手绘的四边通常不接续，只让它"照着排"会把接缝
 * 风险直接带进成品，而接缝是否真的接上仍由 tile-verify 判定——这里只表达意图，不替能力背书。
 */
export function defaultSketchNote(composeType: DraftComposeType): string {
  return composeType === "REPEAT"
    ? "照这张草图里母题的形态、大小、间距与排列作画，把它当作一个可平铺的单元：每枚母题要么完整落在格内，要么跨越边缘延续到对边；不要复现手绘线条和它的颜色，也不要照抄草图四边不接续的排布。"
    : "照这张草图的位置与比例作画，不要复现手绘线条和它的颜色。";
}
