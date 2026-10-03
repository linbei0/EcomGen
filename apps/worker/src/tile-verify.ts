/**
 * 可平铺的本地判定：环绕接缝与图内相邻差的相对比较，纯函数、零费用、同输入恒同输出。
 *
 * 为什么不相信提示词：闭源生图 API 不暴露平铺控制——真正管用的 circular padding 只适用于
 * SD 时代的卷积 U-Net，对当前主流的 DiT 架构无效——因此把 seamless 写进 Prompt 不构成任何保证。
 * 「可平铺」只能由本地判定给出并如实标注，这也是竞品普遍缺失的一步（它们宣称无缝，却不把判定
 * 结果交给用户）。
 *
 * 判据为什么是"相对"而不是"边缘是否相等"：
 * - 只看左右边缘是否相等，会把衔接完全正常的周期图案（条纹、格纹）判成失败——B 接 A 的跳变
 *   与图内既有的 A 接 B 跳变完全一样，铺开后根本看不出接缝。
 * - 只看整体均差，又会被"一个轴好一个轴坏"稀释：竖直边接不上、水平边刚好相等时，均差会被
 *   拉回中等分，从而漏判。
 * 所以两个轴各自比较"环绕处的色差"与"该轴图内最大的相邻色差"，取较差的那个轴作为结论：
 * 环绕跳变不比图内已有跳变更大，就说明接缝与图内的自然过渡无从区分。
 *
 * 已知边界（如实记录，不静默）：图内若存在一条很硬的边（例如明显的物体轮廓），它会把该轴的
 * 容差抬到很高，从而掩盖真实的接缝——这是偏向"不冤枉可平铺图案"的取舍。判定只影响 TILE
 * 提示与满印出口，不阻塞单区域印花，且分数随花型一起下发供人工复核。
 *
 * 边界：这里只判定，不改动像素。开发期曾实现过"中缝羽化修复 + 修边"，实测效果不达预期
 * （透明底花型会沿中缝产生色晕）已整体下线；在出现新的验证手段前不要恢复修复路径——
 * 判定与修复是两件事，判定本身既不需要也不应该动图。
 */

import sharp from "sharp";
import { TILEABILITY_VERIFIED_MIN, type TileableStatus } from "@ecomgen/contracts";

export interface TileabilityVerdict {
  status: TileableStatus;
  score: number;
}

/** 逐轴分数：水平轴=逐行比较首列/末列（左右接缝），垂直轴=逐列比较首行/末行（上下接缝）。 */
export interface TileabilityAxes {
  horizontal: number;
  vertical: number;
  width: number;
  height: number;
}

/**
 * 可平铺分数：两个轴各自算 `1 - (环绕色差 - 图内最大相邻色差) / 255`，取较小值。
 * 1 表示环绕跳变不大于图内任何一条相邻跳变（接缝无从分辨），0 表示环绕跳变比图内最强边还大 255。
 */
export function scoreTileability(rgba: Buffer, width: number, height: number): number {
  // 至少需要一格内部相邻对，否则"图内最大色差"无从谈起。
  if (width < 3 || height < 3) return 0;
  return Math.min(axisScore(rgba, width, height, true), axisScore(rgba, width, height, false));
}

/** 单个轴的判定：沿该轴取环绕对与全部内部相邻对。horizontal=true 逐行（环绕=首列接末列）。 */
function axisScore(rgba: Buffer, width: number, height: number, horizontal: boolean): number {
  const lines = horizontal ? height : width;
  const lineLength = horizontal ? width : height;
  const at = (line: number, index: number): number => (horizontal ? line * width + index : index * width + line) * 4;
  let wrapTotal = 0;
  let innerMax = 0;
  for (let line = 0; line < lines; line += 1) {
    wrapTotal += pixelDiff(rgba, at(line, 0), at(line, lineLength - 1));
    for (let index = 0; index < lineLength - 1; index += 1) {
      innerMax = Math.max(innerMax, pixelDiff(rgba, at(line, index), at(line, index + 1)));
    }
  }
  // 归一化到"每通道均值"：像素差含 4 个通道，各通道差上限 255。
  const wrapDiff = wrapTotal / lines / 4;
  const tolerance = innerMax / 4;
  return 1 - Math.min(1, Math.max(0, (wrapDiff - tolerance) / 255));
}

/**
 * 单个像素对的加权差：RGB 按 alpha 预乘后比较。
 *
 * 预乘是关键——透明底花型的边缘像素 alpha=0，其存储 RGB 是任意值；不预乘会把"两边都是空的"
 * 算成巨大色差，从而把一张本可无缝铺设的花型错判为 FAILED。预乘后透明像素恒等，语义也正确：
 * 边缘为空的花型铺起来本来就没有接缝。
 */
function pixelDiff(rgba: Buffer, a: number, b: number): number {
  const alphaA = rgba[a + 3] / 255;
  const alphaB = rgba[b + 3] / 255;
  return Math.abs(rgba[a] * alphaA - rgba[b] * alphaB)
    + Math.abs(rgba[a + 1] * alphaA - rgba[b + 1] * alphaB)
    + Math.abs(rgba[a + 2] * alphaA - rgba[b + 2] * alphaB)
    + Math.abs(rgba[a + 3] - rgba[b + 3]);
}

/** 按当前阈值把分数落成判定。阈值是经验值，分数本身随花型下发，供人工复核边界样本。 */
export function verdictForScore(score: number): TileableStatus {
  return score >= TILEABILITY_VERIFIED_MIN ? "VERIFIED" : "FAILED";
}

/** 判定入口：只关心结论与总分的调用方用它；需要分轴证据的用 verifyTileableDetailed。 */
export async function verifyTileable(png: Buffer): Promise<TileabilityVerdict> {
  const { status, score } = await verifyTileableDetailed(png);
  return { status, score };
}

/** 带证据的判定：除总分外给出两个轴各自得分，界面据此指出是哪条边接不上。 */
export async function verifyTileableDetailed(png: Buffer): Promise<TileabilityVerdict & TileabilityAxes> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width < 3 || info.height < 3) return { status: "FAILED", score: 0, horizontal: 0, vertical: 0, width: info.width, height: info.height };
  const horizontal = axisScore(data, info.width, info.height, true);
  const vertical = axisScore(data, info.width, info.height, false);
  const score = Math.min(horizontal, vertical);
  return { status: verdictForScore(score), score, horizontal, vertical, width: info.width, height: info.height };
}
