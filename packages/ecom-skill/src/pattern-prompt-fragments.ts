import type { PatternBackgroundMode } from "@ecomgen/contracts";

/**
 * 花型提示词共享片段：起稿（pod-forge）与 AI 起稿工作台（pattern-draft）编译的是同一类图稿，
 * 底版要求、负面约束与印刷 register 必须逐字一致——分开维护时改一处、另一处仍在描述旧行为，
 * 而两者的产物会并排出现在同一个花型墙里。
 *
 * 措辞依据（2026-10 依官方指南校对）：
 * - OpenAI《Image generation models prompting guide》：提示词按固定顺序组织（媒介/场景 → 主体 →
 *   关键细节 → 约束），复杂请求用可扫读的分段而不是一长句；约束要写明"改什么"与"保持不变"；
 *   透明底必须同时给参数与文本，并在文本里显式排除场景、实底、棋盘格与多余阴影。
 * - Google《How to prompt Gemini image generation》：用语义化负面提示——与其只罗列"不要什么"，
 *   不如先正面描述想要的状态；纯否定会让模型盯住被否定的对象去生成。
 *   因此下面的排除项统一写成"正面目标 + 少量显式排除"，而不是一串 no/without。
 *
 * 这里只放被两处以上引用的片段；单点使用的措辞留在各自的编译函数里，避免为复用而失真。
 */

/**
 * 印刷 register：花型是印在布料与纸张上的平面图形，不是照片、三维渲染或场景图。
 * 放在提示词最前面，用于设定产物的"模式"（OpenAI 指南称之为 set the mode）。
 *
 * 后两句是可印性下限，来自 POD 工厂的公开规范：
 * - Printify《AOP limitations》与《How can I create AOP products》：可印细节有下限（其文字最小 5px），
 *   过细过小的元素印出来会糊掉；Spoonflower《Sizing Your Design》同样建议细节不小于 1/2 英寸。
 * - Printify《Design guide》：热升华/AOP 走染料升华与 CMYK 分色，屏幕上的高饱和与荧光色在布料上
 *   会明显偏移，所以调色板要落在可印范围内。
 * 这两条与"平面 2D"同属"产物要能印"的约束，因此放在 register 里，起稿、起稿工作台与衍生共用。
 */
export const PATTERN_FLAT_PRINT_REGISTER = "Deliver flat two-dimensional print artwork for fabric and paper: clean graphic register, no perspective, no depth of field, no 3D render and no photographic lighting. Keep it legible at print size: no hairline strokes and no details so small they would disappear on fabric. Keep the palette within a printable range: no neon, fluorescent or glowing colors, which cannot be reproduced faithfully by fabric printing.";

/** 白底：不支持透明底时的落点，后续可由提取链路的分割模型再转成透明底。 */
export const PATTERN_BACKGROUND_WHITE = "Place the artwork on a plain pure-white background that fills the whole canvas edge to edge: crisp clean edges, no baked-in shadow, no paper or canvas texture, no border and no vignette.";

/**
 * 透明底：同时写在提示词与请求参数（background: "transparent"）两处——参数保证 alpha 通道，
 * 提示词负责别让模型自己铺一块白底，只给参数时它仍可能那么做。明写 no drawn checkerboard，
 * 是因为画出来的棋盘格不是透明；那正是 worker 必须解码校验 alpha 的原因，一句祈使句不能替代校验。
 */
export const PATTERN_BACKGROUND_TRANSPARENT = "Isolate the artwork on a fully transparent background that fills the whole canvas edge to edge: no white box, no paper texture, no drop shadow, no halo, no drawn checkerboard standing in for transparency, and no border or vignette. Crisp clean edges.";

/** 按底版取片段；起稿只有白底与透明底两种取值（SOURCE 只对"以既有花型为参考图"的衍生有意义）。 */
export function patternBackgroundClause(background: Exclude<PatternBackgroundMode, "SOURCE"> | undefined): string {
  return background === "TRANSPARENT" ? PATTERN_BACKGROUND_TRANSPARENT : PATTERN_BACKGROUND_WHITE;
}

/**
 * 排除项：正面目标在前、显式排除在后。
 *
 * 文案与水印会跟着花型一起印到布料上，所以"图上没有字"必须与其他约束一起出现在每个分支；
 * 但只写 no/without 会让模型把注意力放在被否定的对象上，因此先声明交付物是什么。
 */
export const PATTERN_NEGATIVE_CONSTRAINTS = "The deliverable is the artwork alone, shown straight-on as a finished print file: no watermark, no signature, no lettering or captions, no labels, no logos, no product mockup and no room or lifestyle scene.";
