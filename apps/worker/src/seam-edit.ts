import sharp from "sharp";
import type { DraftSeamEdge } from "@ecomgen/contracts";

/**
 * 定向接缝改稿的跨边坐标：把成对边缘折叠到同一张画布上，让模型在「可见接缝」的坐标系里改稿，
 * 再把结果成对写回原尺寸单元。
 *
 * 为什么不能只修单侧：图案在左右边缘处的两条边是同一处接缝的两半，只改左边会让右边与新的左边
 * 对不上，接缝从一处挪到另一处。修复必须先构造环绕上下文（左边缘左侧补的是右边缘像素），
 * 生成后同时写回左右两条边缘带，才能让这一对边互相自洽。
 *
 * 这里只做几何构造与写回，不判定、不承诺成功；改稿结果必须由 verifyTileable 复检，失败时保留旧候选。
 */

export interface SeamEditContext {
  /** 供 Provider 编辑的环绕画布（中心为原图，两侧为对边像素）。 */
  canvas: Buffer;
  edge: DraftSeamEdge;
  band: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
}

/** 构造环绕画布；band 会被限制在 [4, min(单元短边/2, 上限)]，避免两侧窗口重叠。 */
export async function buildSeamCanvas(source: Buffer, edge: DraftSeamEdge, bandHint: number, bandMax: number): Promise<SeamEditContext> {
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) throw new Error("Source image dimensions are unavailable");
  const { width, height } = meta;
  const band = Math.max(4, Math.min(Math.floor(Math.min(width, height) / 2), bandHint, bandMax));
  const png = await sharp(source).ensureAlpha().png().toBuffer();
  if (edge === "LEFT_RIGHT") {
    const canvasWidth = width + band * 2;
    const canvas = await sharp({ create: { width: canvasWidth, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: await sharp(png).extract({ left: width - band, top: 0, width: band, height }).png().toBuffer(), left: 0, top: 0 },
        { input: png, left: band, top: 0 },
        { input: await sharp(png).extract({ left: 0, top: 0, width: band, height }).png().toBuffer(), left: band + width, top: 0 },
      ])
      .png().toBuffer();
    return { canvas, edge, band, width, height, canvasWidth, canvasHeight: height };
  }
  const canvasHeight = height + band * 2;
  const canvas = await sharp({ create: { width, height: canvasHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: await sharp(png).extract({ left: 0, top: height - band, width, height: band }).png().toBuffer(), left: 0, top: 0 },
      { input: png, left: 0, top: band },
      { input: await sharp(png).extract({ left: 0, top: 0, width, height: band }).png().toBuffer(), left: 0, top: band + height },
    ])
    .png().toBuffer();
  return { canvas, edge, band, width, height, canvasWidth: width, canvasHeight };
}

/**
 * 把生成后的环绕画布写回原尺寸单元：只替换两条边缘带，中心内容保持原像素。
 * 成对写回保证修改后的左右（或上下）两条边互相自洽；透明区域按生成结果保留，不做不透明化。
 */
export async function applySeamEdit(source: Buffer, generatedCanvas: Buffer, context: SeamEditContext): Promise<Buffer> {
  const { band, width, height, canvasWidth } = context;
  const [sourceRgba, generatedRgba] = await Promise.all([
    sharp(source).ensureAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer(),
    sharp(generatedCanvas).ensureAlpha().resize(context.canvasWidth, context.canvasHeight, { fit: "fill" }).raw().toBuffer(),
  ]);
  const out = Buffer.from(sourceRgba);
  const copyPixel = (targetIndex: number, sourceIndex: number): void => {
    for (let channel = 0; channel < 4; channel += 1) out[targetIndex + channel] = generatedRgba[sourceIndex + channel]!;
  };
  if (context.edge === "LEFT_RIGHT") {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < band; x += 1) {
        const row = y * canvasWidth;
        // 左边缘带：源 [0,band) ← 画布 [band,2band)
        copyPixel((y * width + x) * 4, (row + band + x) * 4);
        // 右边缘带：源 [width-band,width) ← 画布 [width,width+band)
        copyPixel((y * width + (width - band + x)) * 4, (row + width + x) * 4);
      }
    }
  } else {
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < band; y += 1) {
        // 上边缘带：源 [0,band) ← 画布 [band,2band)
        copyPixel((y * width + x) * 4, ((band + y) * width + x) * 4);
        // 下边缘带：源 [height-band,height) ← 画布 [height,height+band)
        copyPixel(((height - band + y) * width + x) * 4, (((height + y) * width) + x) * 4);
      }
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** 接缝改稿指令：明确成对边缘与「其余不变」，避免模型把整图重绘。 */
export function compileSeamEditPrompt(edge: DraftSeamEdge, instruction: string | undefined): string {
  const edgeText = edge === "LEFT_RIGHT" ? "左右" : "上下";
  const seamPosition = edge === "LEFT_RIGHT" ? "图像中部的竖直接缝" : "图像中部的水平接缝";
  return [
    `这是把图案${edgeText}边缘环绕拼接后的画面，${seamPosition}就是原始单元接缝的位置。`,
    "请修复这条接缝，使接缝两侧连续自然、没有明显断裂或色差；不要改变图案主体与整体构图，接缝以外区域保持原样。",
    instruction?.trim() ? `补充要求：${instruction.trim()}` : "",
  ].filter(Boolean).join("\n");
}
