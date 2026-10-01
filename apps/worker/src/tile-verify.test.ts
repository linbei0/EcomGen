import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { TILEABILITY_VERIFIED_MIN } from "@ecomgen/contracts";
import { scoreTileability, verdictForScore, verifyTileable } from "./tile-verify.js";

async function pngFromRgba(data: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function rawRgba(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** 用 fill(x, y) 构造 RGBA 图，便于表达"边缘是否对得上"的样本。 */
function rgba(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = fill(x, y);
      const at = (y * width + x) * 4;
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = a;
    }
  }
  return data;
}

/** 灰度值 → 不透明 RGBA 像素，用于构造可逐像素推理的样本。 */
const gray = (value: number): [number, number, number, number] => [value, value, value, 255];

/**
 * "可平铺"没有任何上游保证（闭源 API 不暴露平铺控制），本地验缝是唯一判据来源，
 * 所以这里锁的是判据本身：接缝看不出来要判过，接缝比图内任何过渡都突兀要判不过。
 */
describe("tileability verification", () => {
  it("无色差的均匀图判 VERIFIED", async () => {
    const uniform = await pngFromRgba(rgba(8, 8, () => gray(120)), 8, 8);
    expect((await verifyTileable(uniform)).status).toBe("VERIFIED");
  });

  it("渐变图判 FAILED：首尾列无法衔接，环绕处必然出现一条硬边", async () => {
    // 横向线性渐变：首列 0、末列 255（环绕跳变 255），而图内最大相邻差只有约 36。
    const gradient = await pngFromRgba(rgba(8, 8, (x) => gray(Math.round((x * 255) / 7))), 8, 8);
    expect((await verifyTileable(gradient)).status).toBe("FAILED");
  });

  it("周期图案判 VERIFIED：末列接首列正是图内已有的同一种跳变", async () => {
    // 4 像素周期的条纹（AABB 重复）。只看"边缘是否相等"会把它误判成失败，实际铺开是连续条纹。
    const stripes = await pngFromRgba(rgba(8, 8, (x) => gray(x % 4 < 2 ? 240 : 20)), 8, 8);
    expect((await verifyTileable(stripes)).status).toBe("VERIFIED");
    // 左右对分同理：铺开后是等距条纹，接缝与图内过渡无从区分。
    const halves = await pngFromRgba(rgba(8, 8, (x) => gray(x < 4 ? 240 : 20)), 8, 8);
    expect((await verifyTileable(halves)).status).toBe("VERIFIED");
  });

  it("一个轴接不上就判 FAILED：两轴取较差者，不被另一轴的好成绩稀释", async () => {
    // 竖直方向完全均匀（该轴满分），水平方向首尾异色且图内没有同量级过渡 → 必须判失败。
    const misalignedData = rgba(9, 8, (x) => (x === 0 ? gray(0) : x === 8 ? gray(255) : gray(128)));
    const misaligned = await pngFromRgba(misalignedData, 9, 8);
    const decoded = await rawRgba(misaligned);
    expect(scoreTileability(decoded.data, decoded.width, decoded.height)).toBeLessThan(TILEABILITY_VERIFIED_MIN);
    expect((await verifyTileable(misaligned)).status).toBe("FAILED");
  });

  it("透明底边缘不被误判：alpha 为 0 时存储的 RGB 不参与比较", async () => {
    // 边缘全透明但 RGB 是任意值（现实中抠图产物如此）；不做 alpha 预乘会被算成巨大色差。
    const data = rgba(6, 6, (x, y) => {
      const border = x === 0 || y === 0 || x === 5 || y === 5;
      return border ? [255, 0, 0, 0] : [90, 140, 200, 255];
    });
    const decoded = await rawRgba(await pngFromRgba(data, 6, 6));
    expect(scoreTileability(decoded.data, decoded.width, decoded.height)).toBeGreaterThanOrEqual(TILEABILITY_VERIFIED_MIN);
    expect((await verifyTileable(await pngFromRgba(data, 6, 6))).status).toBe("VERIFIED");
  });

  it("判定是内容的确定性函数，且不改动像素", async () => {
    const png = await pngFromRgba(rgba(12, 10, () => gray(120)), 12, 10);
    const first = await verifyTileable(png);
    expect(first).toEqual(await verifyTileable(png));
    expect(first.status).toBe("VERIFIED");
    // 验缝不能顺手把图改了——判定与修复是两件事。
    const before = await rawRgba(png);
    await verifyTileable(png);
    const after = await rawRgba(png);
    expect(after.data.equals(before.data)).toBe(true);
    expect(after.width).toBe(12);
    expect(after.height).toBe(10);
  });

  it("verdictForScore 在阈值两侧切换，过小的图返回 0 分而不抛错", () => {
    expect(verdictForScore(TILEABILITY_VERIFIED_MIN)).toBe("VERIFIED");
    expect(verdictForScore(TILEABILITY_VERIFIED_MIN - 0.01)).toBe("FAILED");
    // 边长 < 3 无法同时构成环绕对与图内相邻对，返回 0 而不是抛错。
    expect(scoreTileability(Buffer.alloc(16), 2, 2)).toBe(0);
  });
});
