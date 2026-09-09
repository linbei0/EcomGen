import { readPsd, writePsdBuffer } from "ag-psd";
import { describe, expect, it } from "vitest";
import { compositeOver, createPsdLayerAccumulator, extractAlpha, invertMask, multiplyAlpha, psdLayerFromRgba, unionOfMasks } from "./layer-composite.js";

function pixel(r: number, g: number, b: number, a: number): Buffer {
  return Buffer.from([r, g, b, a]);
}

describe("layer composite helpers", () => {
  it("multiplyAlpha keeps original transparency and applies the selection", () => {
    const rgba = pixel(10, 20, 30, 200);
    const output = multiplyAlpha(rgba, Buffer.from([128]));
    // 原图 alpha 200 先被选区缩放，再写回；RGB 不受影响，避免把软边替换成硬边。
    expect([...output]).toEqual([10, 20, 30, Math.round((200 * 128) / 255)]);
  });

  it("multiplyAlpha preserves a fully transparent source pixel", () => {
    const output = multiplyAlpha(pixel(1, 2, 3, 0), Buffer.from([255]));
    expect(output[3]).toBe(0);
  });

  it("compositeOver rebuilds the exact source pixel when the background is opaque", () => {
    // 元素 alpha=mask、背景 alpha=255（不挖空）时，标准 source-over 在软边处仍还原原像素。
    const composite = pixel(0, 0, 0, 0);
    compositeOver(composite, pixel(90, 120, 150, 255));
    compositeOver(composite, pixel(90, 120, 150, 128));
    expect([...composite]).toEqual([90, 120, 150, 255]);
  });

  it("unionOfMasks takes the per-pixel maximum and invertMask flips 0-255", () => {
    const union = unionOfMasks([Buffer.from([0, 255, 10]), Buffer.from([200, 0, 20])], 3, 1);
    expect([...union]).toEqual([200, 255, 20]);
    expect([...invertMask(Buffer.from([0, 255, 10]))]).toEqual([255, 0, 245]);
  });

  it("extractAlpha pulls the alpha channel out of RGBA", () => {
    expect([...extractAlpha(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))]).toEqual([4, 8]);
  });

  it("psdLayerFromRgba crops to the non-empty alpha bounds and keeps coordinates", () => {
    const width = 4; const height = 4;
    const rgba = Buffer.alloc(width * height * 4, 0);
    const offset = (1 * width + 2) * 4;
    rgba[offset] = 10; rgba[offset + 1] = 20; rgba[offset + 2] = 30; rgba[offset + 3] = 200;
    const layer = psdLayerFromRgba(rgba, width, height, "元素");
    expect(layer).not.toBeNull();
    expect([layer!.left, layer!.top, layer!.right, layer!.bottom]).toEqual([2, 1, 3, 2]);
    expect([layer!.imageData!.width, layer!.imageData!.height]).toEqual([1, 1]);
    expect([...layer!.imageData!.data]).toEqual([10, 20, 30, 200]);
  });

  it("psdLayerFromRgba returns null for a fully transparent layer", () => {
    expect(psdLayerFromRgba(Buffer.alloc(2 * 2 * 4, 0), 2, 2, "空")).toBeNull();
  });

  it("createPsdLayerAccumulator puts the background first (ag-psd bottom) and composites elements above it", () => {
    const width = 2; const height = 2;
    const background = Buffer.from([90, 120, 150, 255, 90, 120, 150, 255, 90, 120, 150, 255, 90, 120, 150, 255]);
    const element = Buffer.from([10, 20, 30, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const psd = createPsdLayerAccumulator(width, height);
    psd.append({ name: "背景", rgba: background });
    psd.append({ name: "01 元素", rgba: element });
    // children 顺序即 PSD 层序：背景在 children[0]（最底层），元素在其上，不会被背景遮住
    expect(psd.children.map((layer) => layer.name)).toEqual(["背景", "01 元素"]);
    // 写出的 PSD 读回后保持同一层序
    const written = readPsd(writePsdBuffer({ width, height, children: psd.children, imageData: { width, height, data: new Uint8ClampedArray(psd.composite) } }), { skipLayerImageData: true, skipCompositeImageData: true });
    expect(written.children?.map((layer) => layer.name)).toEqual(["背景", "01 元素"]);
    // 合成预览来自真实图层叠加：元素覆盖处 alpha 不透明，而不是直接用原图顶替
    expect(psd.composite[3]).toBe(255);
  });

  it("createPsdLayerAccumulator documents the holed-background soft-edge alpha in the composite preview", () => {
    // 挖空背景：元素 alpha=mask、背景 alpha=原图 alpha×(1-mask)，软边处二者叠加后 alpha<255，
    // 这是“可移动元素”与“逐像素还原原图”不可兼得的取舍，合成预览如实呈现而不隐藏。
    const mask = Buffer.from([128]);
    const original = pixel(90, 120, 150, 255);
    const psd = createPsdLayerAccumulator(1, 1);
    psd.append({ name: "背景", rgba: multiplyAlpha(original, invertMask(mask)) });
    psd.append({ name: "01 元素", rgba: multiplyAlpha(original, mask) });
    expect(psd.composite[3]).toBe(191);
  });

  it("createPsdLayerAccumulator starts with the first element when no background is requested", () => {
    const psd = createPsdLayerAccumulator(1, 1);
    psd.append({ name: "01 元素", rgba: pixel(10, 20, 30, 255) });
    expect(psd.children.map((layer) => layer.name)).toEqual(["01 元素"]);
  });
});
