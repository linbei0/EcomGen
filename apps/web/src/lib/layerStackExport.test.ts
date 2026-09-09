import { initializeCanvas, readPsd, writePsd } from "ag-psd";
import { describe, expect, it } from "vitest";

import { buildManifest, buildPsdDocument, buildZipEntries, layerDisplayName, moveLayer, numberedName, visibleLayers, type StackLayer } from "./layerStackExport";

// jsdom 没有 canvas 实现（getContext 返回 null），而 ag-psd 读层通道数据必须分配 ImageData；
// 注入纯 JS 替身，往返测试不依赖真实 canvas
initializeCanvas(
  (width, height) => ({ width, height, getContext: () => ({}) }) as unknown as HTMLCanvasElement,
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData,
);

const make = (id: string, name: string, kind: "element" | "background" = "element"): StackLayer => ({ id, name, kind, downloadUrl: `/files/${id}` });
const bytes = (text: string) => new TextEncoder().encode(text);

describe("moveLayer", () => {
  it("把元素从 from 移到 to，其余相对顺序不变", () => {
    const layers = ["a", "b", "c", "d"].map((id) => make(id, id));
    expect(moveLayer(layers, 0, 2).map((layer) => layer.id)).toEqual(["b", "c", "a", "d"]);
    expect(moveLayer(layers, 3, 0).map((layer) => layer.id)).toEqual(["d", "a", "b", "c"]);
  });
  it("越界目标收敛到有效区间，且不修改原数组", () => {
    const layers = ["a", "b"].map((id) => make(id, id));
    expect(moveLayer(layers, 0, 99).map((layer) => layer.id)).toEqual(["b", "a"]);
    expect(moveLayer(layers, 1, -5).map((layer) => layer.id)).toEqual(["b", "a"]);
    expect(layers.map((layer) => layer.id)).toEqual(["a", "b"]);
  });
});

describe("命名", () => {
  it("去掉 .png 后缀；1 起始两位序号", () => {
    expect(layerDisplayName("01_自定义元素 1.png")).toBe("01_自定义元素 1");
    expect(layerDisplayName("薄荷叶")).toBe("薄荷叶");
    expect(numberedName(1, "立着的菠萝.png")).toBe("01_立着的菠萝.png");
    expect(numberedName(12, "薄荷叶.png")).toBe("12_薄荷叶.png");
  });
});

describe("visibleLayers", () => {
  it("过滤隐藏层并保持原（bottom→top）顺序", () => {
    const layers = [make("bg", "背景.png", "background"), make("a", "a.png"), make("b", "b.png")];
    expect(visibleLayers(layers, new Set(["a", "bg"])).map((layer) => layer.id)).toEqual(["b"]);
    expect(visibleLayers(layers, new Set()).map((layer) => layer.id)).toEqual(["bg", "a", "b"]);
  });
});

describe("buildManifest", () => {
  it("记录来源、导出时间、完整层序与包含/排除清单", () => {
    const layers = [make("bg", "背景.png", "background"), make("a", "a.png"), make("b", "b.png")];
    const manifest = JSON.parse(buildManifest({ exportId: "exp-1", outputId: "out-1", createdAt: "2026-09-10T01:02:03.000Z" }, layers, new Set(["b"]))) as Record<string, unknown>;
    expect(manifest.source).toEqual({ exportId: "exp-1", outputId: "out-1", createdAt: "2026-09-10T01:02:03.000Z" });
    expect(manifest.order).toEqual(["背景.png", "a.png", "b.png"]);
    expect(manifest.included).toEqual(["背景.png", "a.png"]);
    expect(manifest.excluded).toEqual(["b.png"]);
    expect(typeof manifest.exportedAt).toBe("string");
  });
});

describe("buildZipEntries", () => {
  const layers = [make("bg", "背景.png", "background"), make("a", "a.png"), make("b", "b.png"), make("c", "c.png")];
  const bytesByUrl = new Map([["/files/bg", bytes("bg")], ["/files/a", bytes("a")], ["/files/b", bytes("b")], ["/files/c", bytes("c")]]);
  it("可见层 bottom→top 编号重命名（隐藏层序号顺延），manifest 收尾", () => {
    const manifest = buildManifest({ exportId: "exp-1", outputId: "out-1", createdAt: "2026-09-10T01:02:03.000Z" }, layers, new Set(["b"]));
    const entries = buildZipEntries(layers, new Set(["b"]), bytesByUrl, manifest);
    expect(entries.map((entry) => entry.name)).toEqual(["01_背景.png", "02_a.png", "03_c.png", "manifest.json"]);
    expect(new TextDecoder().decode(entries[0]?.data ?? new Uint8Array())).toBe("bg");
    expect(new TextDecoder().decode(entries.at(-1)!.data)).toBe(manifest);
  });
  it("可见层字节缺失时抛错，不产出半成品", () => {
    expect(() => buildZipEntries(layers, new Set(), new Map(), "{}")).toThrow(/图层文件缺失/);
  });
});

describe("buildPsdDocument + readPsd 往返", () => {
  const imageData = (color: number) => ({ width: 2, height: 2, data: new Uint8ClampedArray(16).fill(color) }) as ImageData;
  it("children 仅含可见层且自底向上，往返后层序与尺寸一致", () => {
    const layers = [make("bg", "背景.png", "background"), make("a", "a.png"), make("b", "b.png")];
    const imageDataByUrl = new Map([["/files/bg", imageData(10)], ["/files/a", imageData(20)], ["/files/b", imageData(30)]]);
    const document = buildPsdDocument(2, 2, layers, new Set(["b"]), imageDataByUrl);
    // jsdom 无 canvas 实现：useImageData 让 reader 以 imageData 附着而不走 canvas；
    // 文档未提供合成图，跳过 composite 段避免空数据解析
    const parsed = readPsd(writePsd(document as unknown as Parameters<typeof writePsd>[0]), { useImageData: true, skipCompositeImageData: true });
    const children = parsed.children ?? [];
    expect(children.map((child) => child.name)).toEqual(["背景", "a"]);
    expect(children[0]?.imageData?.width).toBe(2);
    expect(children[0]?.imageData?.data[0]).toBe(10);
    expect(children[1]?.imageData?.data[0]).toBe(20);
  });
});
