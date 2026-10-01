import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { computeRepeatUnitGeometry } from "./print-pack.js";
import { composeRepeatUnit } from "./repeat-unit.js";

/**
 * 重复单元的"构造性无缝"是平铺排列的核心领域不变量：单元在无限平铺时每条接缝两侧像素恒等。
 * 用可手工验算的 2×2 色块源图锁两件事——错位排列的环绕补画（裁掉的部分从对侧补回）与
 * 镜像排列的翻转象限（右=左的水平镜像、下=上的垂直镜像）。这两条一旦回归，成包产物会出现
 * 缺口或错位，而排版数学单测（print-pack.test.ts）只锁数字、锁不住像素。
 */

/** 2×2 源图：左上红、右上绿、左下蓝、右下黄；返回 RGBA 像素数组。 */
async function sourceTile(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: Buffer.from([255, 0, 0, 255]), raw: { width: 1, height: 1, channels: 4 }, left: 0, top: 0 },
      { input: Buffer.from([0, 255, 0, 255]), raw: { width: 1, height: 1, channels: 4 }, left: 1, top: 0 },
      { input: Buffer.from([0, 0, 255, 255]), raw: { width: 1, height: 1, channels: 4 }, left: 0, top: 1 },
      { input: Buffer.from([255, 255, 0, 255]), raw: { width: 1, height: 1, channels: 4 }, left: 1, top: 1 },
    ])
    .png()
    .toBuffer();
}

async function pixelAt(unit: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(unit).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!];
}

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const YELLOW = [255, 255, 0, 255];

describe("composeRepeatUnit", () => {
  it("半落：第二列下错半格，越界的下半从单元顶部补回（环绕无缝）", async () => {
    const source = await sourceTile();
    const unit = await composeRepeatUnit({ data: source, width: 2, height: 2 }, computeRepeatUnitGeometry(2, 2, "HALF_DROP"));
    expect(await sharp(unit).metadata()).toMatchObject({ width: 4, height: 2 });
    // 第一列 = 源图原位；第二列下错 1 行：单元第 1 行是源图第 0 行，源图第 1 行环绕回单元第 0 行。
    expect(await pixelAt(unit, 0, 0)).toEqual(RED);
    expect(await pixelAt(unit, 1, 0)).toEqual(GREEN);
    expect(await pixelAt(unit, 0, 1)).toEqual(BLUE);
    expect(await pixelAt(unit, 1, 1)).toEqual(YELLOW);
    expect(await pixelAt(unit, 2, 0)).toEqual(BLUE);
    expect(await pixelAt(unit, 3, 0)).toEqual(YELLOW);
    expect(await pixelAt(unit, 2, 1)).toEqual(RED);
    expect(await pixelAt(unit, 3, 1)).toEqual(GREEN);
  });

  it("镜像：右半是左半的水平镜像，下半是上半的垂直镜像，接缝两侧像素恒等", async () => {
    const source = await sourceTile();
    const unit = await composeRepeatUnit({ data: source, width: 2, height: 2 }, computeRepeatUnitGeometry(2, 2, "MIRROR"));
    expect(await sharp(unit).metadata()).toMatchObject({ width: 4, height: 4 });
    // 内部竖缝：x=1 与 x=2 恒等（左位右缘 = 右位（水平翻）左缘）。
    expect(await pixelAt(unit, 2, 0)).toEqual(await pixelAt(unit, 1, 0));
    // 内部横缝：y=1 与 y=2 恒等（上位下缘 = 下位（垂直翻）上缘）。
    expect(await pixelAt(unit, 0, 2)).toEqual(await pixelAt(unit, 0, 1));
    // 环绕缝：单元右缘 x=3 与下个单元左缘 x=0 恒等（右位（水平翻）右缘 = 源图左缘）。
    expect(await pixelAt(unit, 3, 0)).toEqual(await pixelAt(unit, 0, 0));
    expect(await pixelAt(unit, 3, 3)).toEqual(await pixelAt(unit, 0, 3));
    // 翻转方向抽查：右上象限是源图的水平镜像。
    expect(await pixelAt(unit, 2, 0)).toEqual(GREEN);
    expect(await pixelAt(unit, 3, 0)).toEqual(RED);
  });

  it("错砖：第二行右错半格，越界的右半从单元左侧补回", async () => {
    const source = await sourceTile();
    const unit = await composeRepeatUnit({ data: source, width: 2, height: 2 }, computeRepeatUnitGeometry(2, 2, "HALF_BRICK"));
    expect(await sharp(unit).metadata()).toMatchObject({ width: 2, height: 4 });
    // 第一行 = 源图原位；第二行 = 源图整体右移 1 列：源图右列出界，从单元左缘补回。
    expect(await pixelAt(unit, 0, 0)).toEqual(RED);
    expect(await pixelAt(unit, 1, 0)).toEqual(GREEN);
    expect(await pixelAt(unit, 0, 2)).toEqual(GREEN);
    expect(await pixelAt(unit, 1, 2)).toEqual(RED);
    expect(await pixelAt(unit, 0, 3)).toEqual(YELLOW);
    expect(await pixelAt(unit, 1, 3)).toEqual(BLUE);
  });
});
