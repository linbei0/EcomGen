import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { applyRecolor } from "./pattern-derive.js";

async function pngFromRgba(data: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function rawRgba(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** 改色是 PATTERN_DERIVE 的领域不变量：确定性（同参数同输出）与色相旋转方向。 */
describe("pattern derive recolor", () => {
  it("applyRecolor 确定性调制像素（同参数同输出）", async () => {
    const data = Buffer.alloc(4 * 4 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 180;
      data[i + 1] = 60;
      data[i + 2] = 40;
      data[i + 3] = 255;
    }
    const source = await pngFromRgba(data, 4, 4);
    const first = await applyRecolor(source, { hueShift: 180 });
    const second = await applyRecolor(source, { hueShift: 180 });
    expect(first.equals(second)).toBe(true);
    const { data: shifted } = await rawRgba(first);
    // 红色 (180,60,40) 旋转 180° 后应变成偏青色：绿色通道显著高于红色通道。
    expect(shifted[1]).toBeGreaterThan(shifted[0]);
  });

  it("饱和度为 0 时输出灰阶（三通道趋同）", async () => {
    const data = Buffer.alloc(2 * 2 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 200;
      data[i + 1] = 80;
      data[i + 2] = 40;
      data[i + 3] = 255;
    }
    const { data: desaturated } = await rawRgba(await applyRecolor(await pngFromRgba(data, 2, 2), { saturationPct: 0 }));
    expect(Math.abs(desaturated[0] - desaturated[1])).toBeLessThanOrEqual(2);
    expect(Math.abs(desaturated[1] - desaturated[2])).toBeLessThanOrEqual(2);
  });
});
