import { describe, expect, it } from "vitest";
import { computePrintPackPlacement, computePrintPackTileLayout, computeRepeatUnitGeometry } from "./print-pack.js";
import { computeMockupArtworkPlacement, MOCKUP_CANVAS, mockupGeometryFor, MUG_VISIBLE_WRAP_FRACTION } from "./print-mockups.js";
import { getPodPrintSpec, POD_PRINT_CATEGORIES, POD_PRINT_SPECS, POD_REPEAT_LAYOUTS } from "@ecomgen/contracts";

/**
 * 规格包排版数学是 PRINT_PACK 的领域不变量：像素只来自花型的确定性 contain-fit，
 * 这里锁住缩放方向、居中取整与越界防护，Worker 执行器不重复承担这些语义。
 */
describe("computePrintPackPlacement", () => {
  it("方形图稿进入竖版画布时受安全区宽度限制并精确居中", () => {
    // T恤规格：3600×4800，安全边距按短边 6% = 216，安全区 3168×4368。
    expect(computePrintPackPlacement(3600, 4800, 6, 1800, 1800)).toEqual({
      width: 3168,
      height: 3168,
      left: 216,
      top: 816,
    });
  });

  it("横版图稿进入横版画布时等比缩放，两个方向都不越出安全区", () => {
    // 马克杯围边：2550×1110，短边 2% = 22，安全区 2506×1066；受高度限制 scale=1.3325。
    const placement = computePrintPackPlacement(2550, 1110, 2, 2000, 800);
    expect(placement.width).toBeLessThanOrEqual(2506);
    expect(placement.height).toBeLessThanOrEqual(1066);
    expect(placement.left + placement.width).toBeLessThanOrEqual(2550);
    expect(placement.top + placement.height).toBeLessThanOrEqual(1110);
    expect(placement.left).toBeGreaterThanOrEqual(22);
    expect(placement.top).toBeGreaterThanOrEqual(22);
  });

  it("小于安全区的图稿允许放大铺满可印区（印刷需要，不虚称无损）", () => {
    // 手机壳：900×1650，短边 6% = 54，安全区 792×1542；400×300 放大到宽受限于 792。
    expect(computePrintPackPlacement(900, 1650, 6, 400, 300)).toEqual({
      width: 792,
      height: 594,
      left: 54,
      top: 528,
    });
  });

  it("零边距时图稿 contain-fit 到整张画布并贴边居中", () => {
    expect(computePrintPackPlacement(4500, 4500, 0, 6000, 3000)).toEqual({
      width: 4500,
      height: 2250,
      left: 0,
      top: 1125,
    });
  });

  it("安全边距吃满画布（50%）时抛错而不是产出不可打印的结果", () => {
    expect(() => computePrintPackPlacement(1000, 1000, 50, 500, 500)).toThrow("Safe margin consumes the entire print canvas");
  });

  it("任意奇数尺寸组合下取整结果永不越界、永不出现零边", () => {
    const canvases = [[1001, 1333], [2550, 1110], [901, 1651], [819, 819]] as const;
    const sources = [[1801, 1801], [2001, 799], [401, 301], [613, 1024], [79, 79]] as const;
    for (const [canvasWidth, canvasHeight] of canvases) {
      for (const safeMarginPct of [0, 2, 6, 30]) {
        for (const [sourceWidth, sourceHeight] of sources) {
          const placement = computePrintPackPlacement(canvasWidth, canvasHeight, safeMarginPct, sourceWidth, sourceHeight);
          expect(placement.width).toBeGreaterThanOrEqual(1);
          expect(placement.height).toBeGreaterThanOrEqual(1);
          expect(placement.left).toBeGreaterThanOrEqual(0);
          expect(placement.top).toBeGreaterThanOrEqual(0);
          expect(placement.left + placement.width).toBeLessThanOrEqual(canvasWidth);
          expect(placement.top + placement.height).toBeLessThanOrEqual(canvasHeight);
        }
      }
    }
  });

  it("非法输入（非正尺寸、边距越界）抛错而不是静默产出", () => {
    expect(() => computePrintPackPlacement(0, 100, 0, 10, 10)).toThrow();
    expect(() => computePrintPackPlacement(100, 100, 0, 0, 10)).toThrow();
    expect(() => computePrintPackPlacement(100, 100, 51, 10, 10)).toThrow();
  });
});

/**
 * TILE 满印版式的领域不变量：至少 2×2 重复、保纵横比、覆盖整幅画布、负向越界对称。
 */
describe("computePrintPackTileLayout", () => {
  it("花型长边缩到画布短边一半，纵横比保持，覆盖整幅画布", () => {
    // 马克杯围边 2550×1110，花型 800×400：target = 1110/2 = 555，scale = 555/800。
    const layout = computePrintPackTileLayout(2550, 1110, 800, 400);
    expect(layout.tileWidth).toBe(555);
    expect(layout.tileHeight).toBe(278);
    expect(Math.abs(layout.tileWidth / layout.tileHeight - 2)).toBeLessThan(0.01);
    expect(layout.columns * layout.tileWidth + Math.abs(layout.left)).toBeGreaterThanOrEqual(2550);
    expect(layout.rows * layout.tileHeight + Math.abs(layout.top)).toBeGreaterThanOrEqual(1110);
    expect(layout.columns).toBeGreaterThanOrEqual(2);
    expect(layout.rows).toBeGreaterThanOrEqual(2);
  });

  it("竖版画布上以画布短边为准，方形花型精确 2×2", () => {
    // T恤 3600×4800，花型 100×100：target = 3600/2 = 1800 → 1800 方形 tile。
    const layout = computePrintPackTileLayout(3600, 4800, 100, 100);
    expect(layout.tileWidth).toBe(1800);
    expect(layout.tileHeight).toBe(1800);
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(3);
    expect(layout.left).toBe(0);
  });

  it("非法输入抛错而不是产出不可打印的结果", () => {
    expect(() => computePrintPackTileLayout(0, 100, 10, 10)).toThrow();
    expect(() => computePrintPackTileLayout(100, 100, 0, 10)).toThrow();
  });

  /**
   * 平铺排列只改"重复单元"不改花型缩放：错位类与直排同尺寸同密度（ADR-0001）；
   * 镜像强制单元 ≥2×2，缩放目标减半。单元覆盖与居中越界语义与直排共用同一套数学。
   */
  describe("平铺排列", () => {
    const canvas = [3600, 4800] as const;
    const source = [600, 600] as const;

    it("直排与缺省行为逐字段一致：单元=花型本身", () => {
      const byDefault = computePrintPackTileLayout(canvas[0], canvas[1], source[0], source[1]);
      const explicit = computePrintPackTileLayout(canvas[0], canvas[1], source[0], source[1], "STRAIGHT");
      expect(explicit).toEqual(byDefault);
      expect(explicit.unitWidth).toBe(explicit.tileWidth);
      expect(explicit.unitHeight).toBe(explicit.tileHeight);
      expect(explicit.placements).toEqual([{ left: 0, top: 0, flipX: false, flipY: false }]);
    });

    it("半落单元 2×1，第二列下错半高；花型缩放与直排一致", () => {
      const straight = computePrintPackTileLayout(canvas[0], canvas[1], source[0], source[1], "STRAIGHT");
      const layout = computePrintPackTileLayout(canvas[0], canvas[1], source[0], source[1], "HALF_DROP");
      expect(layout.tileWidth).toBe(straight.tileWidth);
      expect(layout.tileHeight).toBe(straight.tileHeight);
      expect(layout.unitWidth).toBe(layout.tileWidth * 2);
      expect(layout.unitHeight).toBe(layout.tileHeight);
      expect(layout.placements).toEqual([
        { left: 0, top: 0, flipX: false, flipY: false },
        { left: layout.tileWidth, top: Math.round(layout.tileHeight / 2), flipX: false, flipY: false },
      ]);
    });

    it("三落单元 3×1，错位比例为 1/3、2/3 高", () => {
      const layout = computePrintPackTileLayout(canvas[0], canvas[1], source[0], source[1], "ONE_THIRD_DROP");
      expect(layout.unitWidth).toBe(layout.tileWidth * 3);
      expect(layout.placements.map((placement) => placement.top)).toEqual([0, Math.round(layout.tileHeight / 3), Math.round((layout.tileHeight * 2) / 3)]);
    });

    it("错砖单元 1×2，第二行右错半宽", () => {
      const layout = computePrintPackTileLayout(canvas[0], canvas[1], source[0], source[1], "HALF_BRICK");
      expect(layout.unitWidth).toBe(layout.tileWidth);
      expect(layout.unitHeight).toBe(layout.tileHeight * 2);
      expect(layout.placements).toEqual([
        { left: 0, top: 0, flipX: false, flipY: false },
        { left: Math.round(layout.tileWidth / 2), top: layout.tileHeight, flipX: false, flipY: false },
      ]);
    });

    it("镜像单元 2×2 四象限翻转，缩放减半保证单元在画布每轴至少重复 2 次", () => {
      const straight = computePrintPackTileLayout(canvas[0], canvas[1], source[0], source[1], "STRAIGHT");
      const layout = computePrintPackTileLayout(canvas[0], canvas[1], source[0], source[1], "MIRROR");
      expect(layout.tileWidth).toBe(Math.round(straight.tileWidth / 2));
      expect(layout.placements).toEqual([
        { left: 0, top: 0, flipX: false, flipY: false },
        { left: layout.tileWidth, top: 0, flipX: true, flipY: false },
        { left: 0, top: layout.tileHeight, flipX: false, flipY: true },
        { left: layout.tileWidth, top: layout.tileHeight, flipX: true, flipY: true },
      ]);
      expect(layout.columns).toBeGreaterThanOrEqual(2);
      expect(layout.rows).toBeGreaterThanOrEqual(2);
    });

    it("全部排列的单元都覆盖整幅画布，摆放位不越出单元", () => {
      for (const repeat of POD_REPEAT_LAYOUTS) {
        const layout = computePrintPackTileLayout(canvas[0], canvas[1], source[0], source[1], repeat);
        expect(layout.columns * layout.unitWidth + Math.abs(layout.left)).toBeGreaterThanOrEqual(canvas[0]);
        expect(layout.rows * layout.unitHeight + Math.abs(layout.top)).toBeGreaterThanOrEqual(canvas[1]);
        for (const placement of layout.placements) {
          expect(placement.left).toBeGreaterThanOrEqual(0);
          expect(placement.top).toBeGreaterThanOrEqual(0);
          expect(placement.left).toBeLessThan(layout.unitWidth);
          expect(placement.top).toBeLessThan(layout.unitHeight);
        }
      }
    });

    it("无缝单元几何按源图原生分辨率计算，不放大插值", () => {
      const geometry = computeRepeatUnitGeometry(1254, 1254, "HALF_DROP");
      expect(geometry.unitWidth).toBe(2508);
      expect(geometry.unitHeight).toBe(1254);
      const mirror = computeRepeatUnitGeometry(1254, 1254, "MIRROR");
      expect(mirror.unitWidth).toBe(2508);
      expect(mirror.unitHeight).toBe(2508);
      expect(() => computeRepeatUnitGeometry(0, 10, "STRAIGHT")).toThrow();
    });
  });
});

/**
 * 品类示意图几何不变量：印刷区完全落在画布内且占据可观面积；除马克杯可见带外，
 * 印刷区纵横比必须等于规格画布纵横比（贴图 cover 后零变形）。马克杯带纵横比 =
 * 围边纵横比 × 可见比例——这三条共同防止回归「竖条 sliver 拉伸」事故。
 */
describe("mockup geometry", () => {
  it("全部品类的印刷区在画布界内且面积可观", () => {
    for (const category of POD_PRINT_CATEGORIES) {
      const geometry = mockupGeometryFor(category);
      expect(geometry.width).toBe(MOCKUP_CANVAS);
      expect(geometry.height).toBe(MOCKUP_CANVAS);
      const area = geometry.printArea;
      expect(area.x).toBeGreaterThanOrEqual(0);
      expect(area.y).toBeGreaterThanOrEqual(0);
      expect(area.x + area.width).toBeLessThanOrEqual(geometry.width);
      expect(area.y + area.height).toBeLessThanOrEqual(geometry.height);
      expect(area.width).toBeGreaterThanOrEqual(120);
      expect(area.height).toBeGreaterThanOrEqual(120);
    }
  });

  it("非马克杯品类的印刷区纵横比锁定为规格纵横比", () => {
    for (const spec of POD_PRINT_SPECS) {
      if (spec.category === "MUG_11OZ") continue;
      const area = mockupGeometryFor(spec.category).printArea;
      const specRatio = spec.widthPx / spec.heightPx;
      expect(Math.abs(area.width / area.height - specRatio)).toBeLessThan(0.02);
    }
  });

  it("马克杯可见带呈现围边中央横向段，纵横比约 0.965 而非竖条", () => {
    const spec = getPodPrintSpec("mug-11oz-wrap");
    if (!spec) throw new Error("mug-11oz-wrap spec missing");
    const area = mockupGeometryFor("MUG_11OZ").printArea;
    const expectedRatio = (spec.widthPx * MUG_VISIBLE_WRAP_FRACTION) / spec.heightPx;
    expect(Math.abs(area.width / area.height - expectedRatio)).toBeLessThan(0.02);
    expect(area.width / area.height).toBeGreaterThan(0.9);
  });

  it("placement 对等比规格直出印刷区，对马克杯带裁出围边中央 42%", () => {
    const poster = mockupGeometryFor("POSTER");
    expect(computeMockupArtworkPlacement(poster, 5400, 7200)).toEqual({
      resizeWidth: 420,
      resizeHeight: 560,
      extract: { left: 0, top: 0, width: 420, height: 560 },
    });
    const mug = mockupGeometryFor("MUG_11OZ");
    const placement = computeMockupArtworkPlacement(mug, 2550, 1110);
    // cover 后宽 850（=1110/370×2550），中央裁 357 → 裁切宽度恰为围边的 MUG_VISIBLE_WRAP_FRACTION。
    expect(placement.resizeHeight).toBe(370);
    expect(placement.resizeWidth).toBe(850);
    expect(placement.extract.width / placement.resizeWidth).toBeCloseTo(MUG_VISIBLE_WRAP_FRACTION, 2);
    expect(placement.extract.left).toBe(Math.round((850 - 357) / 2));
    expect(placement.extract.left + placement.extract.width).toBeLessThanOrEqual(placement.resizeWidth);
  });
});
