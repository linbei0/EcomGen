/**
 * 花型衍生的确定性运算：改色（HSL 调制）。
 *
 * 全部为本地 sharp 运算，同输入恒同输出，无外部计费请求。
 * 曾经的修边（中值平滑 + 裁边）与无缝化的"中缝羽化修复"实测效果不达预期（透明底会沿中缝产生
 * 色晕），已整体下线——不要在没有新的验证手段前恢复这些路径。验缝（只判定、不改像素）另见
 * tile-verify.ts，与修复是两件事。
 */

import sharp from "sharp";

export interface RecolorParams {
  hueShift?: number;
  saturationPct?: number;
  brightnessPct?: number;
}

/** 改色：色相旋转 + 饱和度/亮度缩放；像素结构不变。 */
export async function applyRecolor(png: Buffer, params: RecolorParams): Promise<Buffer> {
  return sharp(png)
    .ensureAlpha()
    .modulate({
      hue: params.hueShift ?? 0,
      saturation: (params.saturationPct ?? 100) / 100,
      brightness: (params.brightnessPct ?? 100) / 100,
    })
    .png()
    .toBuffer();
}
