import { supportsTransparentBackground, type PatternBackgroundMode } from "@ecomgen/contracts";
import sharp from "sharp";

/**
 * 花型底版的"用户选择 × 模型能力"解析与结果校验。
 *
 * 分两步而不是一步，是因为这两件事的可靠性根本不同：
 * - 解析：用户选了透明底，模型却只会照提示词画一块"看起来透明"的棋盘格，那种图印到承印物上就是
 *   一块棋盘格底纹。所以解析阶段就拒绝，而不是硬发一个不可能被满足的请求（拒绝发生在付费调用之前）。
 * - 校验：即便模型支持 background 参数，回来的图也要解码看 alpha，因为"要了"不等于"拿到了"。
 *
 * 只校验透明这一件事，不校验白底/跟随源图的实际颜色：透明底丢没丢是无形的（图和它的不透明版本
 * 在预览里几乎一样，直到印出来才发现），而底色对不对用户一眼就能在花型墙上看到。为后者失败掉一次
 * 已付费的生成，代价大于它带来的信息——那属于"展示给用户看"的范畴，不是"替用户裁决"的范畴。
 */

/** 透明底请求字段：能力判定与请求参数必须同源，所以由本模块统一产出而不是各调用点自己拼。 */
export interface TransparentRequest {
  background: "transparent";
  outputFormat: "png";
}

export interface PatternBackgroundPlan {
  /** 编译进提示词的底版模式。`SOURCE` 原样保留——"跟随源图"的护栏文案与白底/透明底都不同。 */
  prompt: PatternBackgroundMode;
  /** 要透传给 Provider 的透明底字段；不要求透明底时为 null。 */
  transparent: TransparentRequest | null;
  /** 是否需要校验产物真的带透明像素。 */
  verifyTransparent: boolean;
}

/** 模型的可判定信息；`imageApiKind` 为 null 表示不是可执行的生图模型。 */
export interface BackgroundModel {
  id: string;
  imageApiKind: string | null;
}

export interface ResolvePatternBackgroundInput {
  mode: PatternBackgroundMode;
  model: BackgroundModel;
  /** 源图是否为透明底（调用方解码判定，不靠调用方口头声明）。只有 `SOURCE` 模式会用到。 */
  sourceTransparent?: boolean;
}

/**
 * 解析底版计划；需要透明底而模型给不了时抛错。
 *
 * `SOURCE` 的语义是"不要动底"：源透明就保住透明，源有底色就保留底色。它不会退化成白底——
 * 源是透明底却铺回白底，等于把一张能直接印的花型降级成还要再抠一次的白底图。
 */
export function resolvePatternBackground(input: ResolvePatternBackgroundInput): PatternBackgroundPlan {
  const fromSource = input.mode === "SOURCE" && input.sourceTransparent === true;
  if (input.mode !== "TRANSPARENT" && !fromSource) return { prompt: input.mode, transparent: null, verifyTransparent: false };

  if (input.model.imageApiKind !== "openai_images" || !supportsTransparentBackground(input.model.id)) {
    throw new Error(unsupportedTransparentMessage(input));
  }
  // output_format 显式给 png：jpeg 装不下 alpha，Provider 会直接报错或悄悄给一张不透明图。
  return { prompt: input.mode, transparent: { background: "transparent", outputFormat: "png" }, verifyTransparent: true };
}

/** 拒绝透明底的说明：必须同时给出"换模型"和"改底版"两条可执行出路，否则用户只能盲试。 */
function unsupportedTransparentMessage(input: ResolvePatternBackgroundInput): string {
  const reason = `模型 ${input.model.id} 不支持透明底（它的 images 接口没有 background 参数，只会按提示词画一块看起来透明的棋盘格）`;
  return input.mode === "TRANSPARENT"
    ? `所选${reason}。请改用 gpt-image-1 / 1.5 / 2 系列，或把底版改成白底（白底图可走「提取」链路再转透明底）。`
    : `源花型是透明底，所选${reason}，硬跑会把透明底换成白底或棋盘格。请改用支持透明底的模型，或把底版明确改成白底。`;
}

/**
 * 图稿是否真的带透明像素。
 *
 * `metadata().hasAlpha` 只说明通道存在——不少 Provider 会补一个全 255 的 alpha 通道，那不是透明。
 * 所以要看 alpha 的最小值：出现过 <255 的像素才算透明真的生效。解码失败按"不透明"处理：宁可多报
 * 一次没有透明底，也不把一张不透明的图当透明底放行。
 */
export async function hasTransparentPixels(image: Buffer): Promise<boolean> {
  try {
    const alpha = (await sharp(image).ensureAlpha().stats()).channels[3];
    return alpha ? alpha.min < 255 : false;
  } catch {
    return false;
  }
}

/**
 * 校验产物是否兑现了透明底承诺；`flow` 只用于拼错误信息里的流程名。
 *
 * 产物在调用本函数前已落盘，所以这里只抛错、不删文件：钱已经花出去，图留在库里至少还能用。
 */
export async function verifyPatternBackground(plan: PatternBackgroundPlan, image: Buffer, flow: "起稿" | "衍生"): Promise<void> {
  if (!plan.verifyTransparent) return;
  if (await hasTransparentPixels(image)) return;
  throw new Error(`${flow}要求透明底，但回来的图不是带 alpha 的透明图（模型也可能画了一块棋盘格当透明）。产物已保存，可改用支持透明底的模型重跑，或按白底花型继续。`);
}
