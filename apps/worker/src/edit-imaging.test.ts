import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { compositeMaskedEdit, compositeNaturalBlend } from "./edit-imaging.js";

/** 构造纯色 RGBA 图，便于逐像素断言合成结果。 */
async function solid(width: number, height: number, color: [number, number, number, number]): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const at = index * 4;
    data[at] = color[0]; data[at + 1] = color[1]; data[at + 2] = color[2]; data[at + 3] = color[3];
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** 构造灰度蒙版（1 通道 PNG）。 */
async function mask(width: number, height: number, fill: (x: number, y: number) => number): Promise<Buffer> {
  const data = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data[y * width + x] = fill(x, y);
  return sharp(data, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

async function rgba(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function pixelAt(image: { data: Buffer; width: number }, x: number, y: number): number[] {
  const at = (y * image.width + x) * 4;
  return [image.data[at]!, image.data[at + 1]!, image.data[at + 2]!, image.data[at + 3]!];
}

describe("compositeMaskedEdit alpha 语义", () => {
  it("生成图透明区域不应被选区蒙版变成不透明（旧实现会烧成不透明）", async () => {
    const source = await solid(4, 4, [255, 0, 0, 255]);
    const generated = await solid(4, 4, [0, 255, 0, 0]);
    const editMask = await mask(4, 4, () => 255);
    const result = await rgba(await compositeMaskedEdit(source, generated, editMask));
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) {
      expect(pixelAt(result, x, y)).toEqual([255, 0, 0, 255]);
    }
  });

  it("保留区像素逐像素不变，未保留区接受生成结果", async () => {
    const source = await solid(4, 4, [255, 0, 0, 255]);
    const generated = await solid(4, 4, [0, 0, 255, 255]);
    const editMask = await mask(4, 4, () => 255);
    const protectMask = await mask(4, 4, (x, y) => (x < 2 && y < 2 ? 255 : 0));
    const result = await rgba(await compositeMaskedEdit(source, generated, editMask, protectMask));
    expect(pixelAt(result, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(result, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(result, 3, 3)).toEqual([0, 0, 255, 255]);
  });

  it("透明源图在生成图透明时保持透明", async () => {
    const source = await solid(2, 2, [0, 0, 0, 0]);
    const generated = await solid(2, 2, [0, 0, 0, 0]);
    const editMask = await mask(2, 2, () => 255);
    const result = await rgba(await compositeMaskedEdit(source, generated, editMask));
    expect(pixelAt(result, 0, 0)[3]).toBe(0);
  });

  it("自然融合同样保留生成图 alpha", async () => {
    const source = await solid(8, 8, [255, 0, 0, 255]);
    const generated = await solid(8, 8, [0, 255, 0, 0]);
    const result = await rgba(await compositeNaturalBlend(source, generated));
    expect(pixelAt(result, 4, 4)).toEqual([255, 0, 0, 255]);
  });
});
