import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { computeLongImageLayout, computeLongImageSlices, orderLongImageScreens, renderLongImage, resolveLongImageConfig } from "./long-image.js";

const CONFIG = resolveLongImageConfig({ targetWidth: 750 });

/** 长图排序与切片是不随渲染变化的不变量：顺序跟随分镜 sort_order，切片永不裁穿单屏。 */
describe("orderLongImageScreens", () => {
  it("按分镜顺序重排，屏内按 candidateIndex，乱序输入产出确定全序", () => {
    const rank = new Map([["item-2", 1], ["item-1", 0]]);
    const screens = [
      { id: "c", storyboardItemId: "item-2", candidateIndex: 1, createdAt: "2026-01-03T00:00:00Z" },
      { id: "a", storyboardItemId: "item-1", candidateIndex: 2, createdAt: "2026-01-02T00:00:00Z" },
      { id: "b", storyboardItemId: "item-1", candidateIndex: 1, createdAt: "2026-01-01T00:00:00Z" },
    ];
    expect(orderLongImageScreens(screens, rank).map((screen) => screen.id)).toEqual(["b", "a", "c"]);
    expect(orderLongImageScreens(screens.slice().reverse(), rank).map((screen) => screen.id)).toEqual(["b", "a", "c"]);
  });

  it("显式 outputIds 顺序覆盖分镜排序（用户在导出弹窗调整顺序）", () => {
    const rank = new Map([["item-1", 0], ["item-2", 1]]);
    const screens = [
      { id: "a", storyboardItemId: "item-1", candidateIndex: 1, createdAt: "2026-01-01T00:00:00Z" },
      { id: "b", storyboardItemId: "item-2", candidateIndex: 1, createdAt: "2026-01-02T00:00:00Z" },
    ];
    expect(orderLongImageScreens(screens, rank, ["b", "a"]).map((screen) => screen.id)).toEqual(["b", "a"]);
  });
});

describe("computeLongImageLayout", () => {
  it("各屏等比缩放到目标宽度并在屏间保留固定 divider", () => {
    const layout = computeLongImageLayout([
      { outputId: "o1", width: 1000, height: 800 },
      { outputId: "o2", width: 1500, height: 1500 },
    ], CONFIG);
    // 只锁关键几何（缩放高度、divider 占位、总高），不整对象比对，避免字段增删连带改测试
    expect(layout.screens.map((screen) => [screen.yTop, screen.height])).toEqual([[0, 600], [632, 750]]);
    expect(layout.totalHeight).toBe(1382);
    expect(layout.targetWidth).toBe(750);
  });

  it("超过总高上限时显式失败而不是截断", () => {
    const screens = Array.from({ length: 31 }, (_, index) => ({ outputId: `o${index}`, width: 750, height: 1000 }));
    expect(() => computeLongImageLayout(screens, CONFIG)).toThrow(/limit 30000/);
  });
});

describe("computeLongImageSlices", () => {
  const layout = computeLongImageLayout([
    { outputId: "o1", width: 750, height: 500 },
    { outputId: "o2", width: 750, height: 800 },
  ], CONFIG);

  it("切点只落在屏边界，贪心取不超上限的最远边界", () => {
    // 边界集合 {500, 1332}：第一片到 500；第二片从 500 出发 500+960=1560 ≥ 1332，覆盖剩余全部。
    expect(computeLongImageSlices(layout, 960)).toEqual([
      { yTop: 0, height: 500 },
      { yTop: 500, height: 832 },
    ]);
  });

  it("整图不超过切片高度时不产出与整图重复的切片", () => {
    expect(computeLongImageSlices(layout, 2000)).toEqual([]);
  });

  it("单屏高于切片上限时显式失败而不是切进内容", () => {
    expect(() => computeLongImageSlices(layout, 400)).toThrow(/exceeding sliceHeight 400/);
  });
});

describe("renderLongImage", () => {
  it("渲染长图与切片：宽度统一、总高与几何一致", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ecomgen-long-image-test-"));
    try {
      const first = join(dir, "a.png");
      const second = join(dir, "b.png");
      await writeFile(first, await sharp({ create: { width: 1000, height: 800, channels: 3, background: "#111111" } }).png().toBuffer());
      await writeFile(second, await sharp({ create: { width: 1500, height: 1500, channels: 3, background: "#222222" } }).png().toBuffer());
      const render = await renderLongImage({
        screens: [{ outputId: "o1", absolutePath: first }, { outputId: "o2", absolutePath: second }],
        config: { targetWidth: 750, sliceHeight: 960 },
        nameStem: "测试项目",
      });
      expect(render.files.map((file) => file.name)).toEqual(["测试项目_长图_750w.jpg", "测试项目_切片_01.jpg", "测试项目_切片_02.jpg"]);
      expect(await sharp(render.files[0]!.path).metadata()).toMatchObject({ width: 750, height: 1382 });
      expect(await sharp(render.files[1]!.path).metadata()).toMatchObject({ width: 750, height: 600 });
      expect(await sharp(render.files[2]!.path).metadata()).toMatchObject({ width: 750, height: 782 });
      await render.cleanup();
      await expect(sharp(render.files[0]!.path).metadata()).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
