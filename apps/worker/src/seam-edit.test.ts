import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { applySeamEdit, buildSeamCanvas, compileSeamEditPrompt } from "./seam-edit.js";

async function solid(width: number, height: number, color: [number, number, number, number]): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const at = index * 4;
    data[at] = color[0]; data[at + 1] = color[1]; data[at + 2] = color[2]; data[at + 3] = color[3];
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function rgba(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
function pixelAt(image: { data: Buffer; width: number }, x: number, y: number): number[] {
  const at = (y * image.width + x) * 4;
  return [image.data[at]!, image.data[at + 1]!, image.data[at + 2]!, image.data[at + 3]!];
}

/** 左右两半异色的样本：左半红、右半蓝，用于验证环绕与成对写回。 */
async function twoTone(width: number, height: number): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const at = (y * width + x) * 4;
    const left = x < width / 2;
    data[at] = left ? 255 : 0; data[at + 1] = 0; data[at + 2] = left ? 0 : 255; data[at + 3] = 255;
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe("接缝改稿的跨边几何", () => {
  it("环绕画布把对边像素补在两侧，画布中心是原图", async () => {
    const source = await twoTone(16, 8);
    const context = await buildSeamCanvas(source, "LEFT_RIGHT", 4, 256);
    expect(context.canvasWidth).toBe(24);
    const canvas = await rgba(context.canvas);
    // 画布最右侧补的是原图最左侧（红），最左侧补的是原图最右侧（蓝）。
    expect(pixelAt(canvas, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(pixelAt(canvas, 23, 0)).toEqual([255, 0, 0, 255]);
    // 中心区仍是原图：x=4 是原图左半（红），x=19 是原图右半（蓝）。
    expect(pixelAt(canvas, 4, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(canvas, 19, 0)).toEqual([0, 0, 255, 255]);
  });

  it("写回只替换两条边缘带，中间像素保持原样", async () => {
    const source = await twoTone(16, 8);
    const context = await buildSeamCanvas(source, "LEFT_RIGHT", 4, 256);
    const replacement = await solid(context.canvasWidth, context.canvasHeight, [10, 200, 10, 255]);
    const result = await rgba(await applySeamEdit(source, replacement, context));
    // 左右边缘带被替换为绿色（成对写回）
    for (let x = 0; x < 4; x += 1) {
      expect(pixelAt(result, x, 0)).toEqual([10, 200, 10, 255]);
      expect(pixelAt(result, 15 - x, 0)).toEqual([10, 200, 10, 255]);
    }
    // 中间未被触碰：x=5 仍是原图左半（红），x=11 仍是原图右半（蓝）。
    expect(pixelAt(result, 5, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(result, 11, 0)).toEqual([0, 0, 255, 255]);
  });

  it("上下接缝的环绕与写回按行进行", async () => {
    const source = await twoTone(8, 16);
    const context = await buildSeamCanvas(source, "TOP_BOTTOM", 4, 256);
    expect(context.canvasHeight).toBe(24);
    const replacement = await solid(context.canvasWidth, context.canvasHeight, [1, 2, 3, 255]);
    const result = await rgba(await applySeamEdit(source, replacement, context));
    expect(pixelAt(result, 0, 0)).toEqual([1, 2, 3, 255]);
    expect(pixelAt(result, 0, 15)).toEqual([1, 2, 3, 255]);
    expect(pixelAt(result, 0, 8)).toEqual([255, 0, 0, 255]);
  });

  // 只保护「用户补充要求确实进了付费提示词」这一条：漏掉它是白花钱，措辞本身不是契约。
  it("补充要求原样进入接缝提示词", () => {
    expect(compileSeamEditPrompt("TOP_BOTTOM", "柔化过渡")).toContain("柔化过渡");
  });
});
