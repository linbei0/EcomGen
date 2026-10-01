import { PATTERN_VARIANT_PRESETS, type PatternBackgroundMode, type PatternVariantAxis, type PatternVariantPreset } from "@ecomgen/contracts";

/**
 * 生成式衍生（画风 / 构图）的确定性 prompt 编译层。
 *
 * 与起稿同一条纪律：提示词是「轴向 + 预设 + 补充描述」的纯函数——同输入重算逐字节一致，
 * 任务指纹因此可复现；模板固化在本文件，不经 LLM 改写，也不允许业务代码在旁边另拼一份。
 * 因此契约里的 preset 是枚举而不是自由文本：用户能做的是"选一个加"而不是"写一个"。
 *
 * 定位是快速铺款筛选而非风格锁定：闭源生图 API 无法锁 seed 或风格向量，所以提示词只描述目标，
 * 不承诺产出之间的一致性——UI 也照此措辞，用户按候选挑选而不是期待系列自动对齐。
 */

/**
 * 预设 → 所属轴向：由 contracts 的 PATTERN_VARIANT_PRESETS 反转派生，不在本文件再写一份归属。
 * 那张表是轴向归属的唯一真相源（web 的预设 chips 也读它），这里漏派生只会是编译期缺键错误；
 * 派生关系由 pattern-variant.test.ts 与契约表对账。
 */
const PRESET_AXIS: Record<PatternVariantPreset, PatternVariantAxis> = Object.fromEntries(
  (Object.entries(PATTERN_VARIANT_PRESETS) as Array<[PatternVariantAxis, readonly PatternVariantPreset[]]>).flatMap(
    ([axis, presets]) => presets.map((preset) => [preset, axis]),
  ),
) as Record<PatternVariantPreset, PatternVariantAxis>;

/**
 * 预设 → prompt 片段。画风轴改画种与笔触（内容与配色应保持），构图轴改元素排布（画风应保持）。
 * 用 Record<PatternVariantPreset, …> 声明：契约新增预设而这里漏登记时是编译期错误，不是运行期兜底。
 */
const PRESET_FRAGMENTS: Record<PatternVariantPreset, string> = {
  WATERCOLOR: "Repaint with translucent watercolor washes, soft blooming pigment edges and visible paper grain.",
  LINE_ART: "Repaint as clean monoline line art with even stroke weight, open shapes and minimal fill.",
  FLAT_VECTOR: "Repaint as flat vector shapes with a limited palette, crisp edges and no gradients or texture.",
  GOUACHE: "Repaint with opaque gouache strokes, matte finish and slightly irregular hand-painted contours.",
  PAPER_CUT: "Repaint as layered paper-cut shapes with subtle drop shadows and hard cut-out edges.",
  SCATTER: "Rearrange into an even scatter of motifs with consistent spacing and no dominant focal element.",
  GRID: "Rearrange into a regular grid, motif centers aligned on a straight lattice with equal gutters.",
  BORDER: "Rearrange as a border frame of motifs around an open center field.",
  CENTER_MOTIF: "Rearrange into one large centered motif surrounded by generous even margins.",
  HALF_DROP: "Rearrange into a half-drop repeat so every other column is offset by half a motif height.",
};

/**
 * 预设 → 中文标签。放在这里而不是前端常量表：标签与它描述的 prompt 片段必须成对修订，
 * 分开维护时最容易出现"改了词不达意的片段却忘了改名字"。
 */
export const PATTERN_VARIANT_PRESET_LABELS: Record<PatternVariantPreset, string> = {
  WATERCOLOR: "水彩",
  LINE_ART: "线稿",
  FLAT_VECTOR: "扁平矢量",
  GOUACHE: "厚涂",
  PAPER_CUT: "剪纸",
  SCATTER: "散点铺陈",
  GRID: "规整网格",
  BORDER: "边框环绕",
  CENTER_MOTIF: "中央主体",
  HALF_DROP: "半错位重复",
};

/** 轴向的中文名，供 UI 分组展示。 */
export const PATTERN_VARIANT_AXIS_LABELS: Record<PatternVariantAxis, string> = { STYLE: "画风", COMPOSITION: "构图" };

/** 预设是否属于给定轴向；路由与 worker 共用同一条归属判断，避免两处各写一份。 */
export function presetBelongsToAxis(axis: PatternVariantAxis, preset: PatternVariantPreset): boolean {
  return PRESET_AXIS[preset] === axis;
}

/**
 * 衍生提示词版本：必须进入任务指纹（api 侧），理由同起稿——指纹含 axial/preset/extra 等输入，
 * 不含编译后的提示词，改模板不递增版本会让旧任务被复用成"新模板的产物"。
 */
export const PATTERN_VARIANT_PROMPT_VERSION = "2026.10.1";

/**
 * 底版护栏：与轴向预设正交，按用户选定的底版模式取一条。三个模式互斥——挑了透明底就不能
 * 同时要求铺白底，模型会把"保持白底"当最高优先级，最后拿回一张白底的图。
 *
 * 为什么 `SOURCE` 不是"什么都不说"：不写护栏时模型会按自己的偏好重画背景（多半铺一块白底），
 * 而用户选"跟随源图"的意思恰恰是不要动底。透明底的 alpha 保留必须明写，它不会被"保持原样"隐含。
 */
const VARIANT_GUARDRAILS: Record<PatternBackgroundMode, string> = {
  SOURCE: "Keep the artwork's theme, subject matter and overall color character: change only what the instruction asks for. Leave the background treatment exactly as it is in the reference: if the reference is transparent keep it transparent and preserve the alpha channel, and if the reference has a background fill keep that same fill.",
  WHITE: "Keep the artwork's theme, subject matter and overall color character: change only what the instruction asks for. Keep the artwork on a plain pure-white background with crisp clean edges, no shadows, no perspective and no product mockup.",
  TRANSPARENT: "Keep the artwork's theme, subject matter and overall color character: change only what the instruction asks for. Keep the artwork on a fully transparent background and preserve its alpha channel: no white box and no drawn checkerboard standing in for transparency. Crisp clean edges, no shadows, no perspective and no product mockup.",
};

export interface PatternVariantPromptInput {
  axis: PatternVariantAxis;
  preset: PatternVariantPreset;
  /** 补充描述（可选）：追加在固化模板之后，不替换模板。 */
  extra?: string;
  /** 底版要求；缺省 SOURCE（跟随源图，即不主动改底版）。 */
  background?: PatternBackgroundMode;
}

/**
 * 编译生成式衍生的 prompt：源花型作为参考图送入 images/edits，
 * 提示词只负责说明"在哪些方面改、哪些方面保持不变"。
 */
export function compilePatternVariantPrompt(input: PatternVariantPromptInput): string {
  const extra = input.extra?.trim();
  return [
    PRESET_FRAGMENTS[input.preset],
    extra ?? "",
    VARIANT_GUARDRAILS[input.background ?? "SOURCE"],
    "No watermark, no signature, no text or letters.",
  ].filter(Boolean).join(" ");
}

/** 衍生花型的缺省名称：源名 + 轴向 + 预设，保证列表里可辨认且确定可复现。 */
export function defaultVariantName(sourceName: string, axis: PatternVariantAxis, preset: PatternVariantPreset): string {
  const stem = sourceName.trim().slice(0, 40);
  return `${stem} · ${PATTERN_VARIANT_AXIS_LABELS[axis]}${PATTERN_VARIANT_PRESET_LABELS[preset]}`;
}
