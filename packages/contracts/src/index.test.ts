import { describe, expect, it } from "vitest";
import { API_SCHEMA_REGISTRY, ImageResolution, dispatchedReferenceOrdinals, findDraftPalettes, resolveImageSize, rewriteDraftPalettes, schemaRef, supportsTransparentBackground } from "./index.js";

describe("参考图下发", () => {
  const availableOrdinals = [1, 3, 7];

  it("起稿下发全部参考图，顺序按编号升序", () => {
    expect(dispatchedReferenceOrdinals({ operation: "GENERATE", availableOrdinals: [7, 1, 3] })).toEqual([1, 3, 7]);
  });

  it("改稿只下发说明里 @ 到的参考图，重复引用只算一次", () => {
    expect(dispatchedReferenceOrdinals({ operation: "EDIT", instruction: "照 @图7 的配色，@图7 的构图", availableOrdinals })).toEqual([7]);
    // 说明里没有 @ 引用就是不下发任何参考图。
    expect(dispatchedReferenceOrdinals({ operation: "EDIT", instruction: "调暖一点", availableOrdinals })).toEqual([]);
  });

  it("不下发参考图的操作一律返回空，即使文本里写了引用", () => {
    for (const operation of ["SEAM_EDIT", "RECOLOR", "CUTOUT"] as const) {
      expect(dispatchedReferenceOrdinals({ operation, instruction: "照 @图1 做", availableOrdinals })).toEqual([]);
    }
  });

  it("引用不存在的编号时原样返回，由调用方按引用不存在拒绝，而不是静默丢弃", () => {
    expect(dispatchedReferenceOrdinals({ operation: "EDIT", instruction: "照 @图9", availableOrdinals })).toEqual([9]);
    // 裸的「图3」不是引用语法，不该被当成下发依据。
    expect(dispatchedReferenceOrdinals({ operation: "EDIT", instruction: "照图3 的感觉", availableOrdinals })).toEqual([]);
  });
});

describe("配色 token", () => {
  it("认 3/4/6/8 位色值，保留出现顺序", () => {
    const matches = findDraftPalettes("把叶子改成 #4f7dc9 的配色，花心用 #fff，描边 #aabbccdd");
    expect(matches.map((match) => match.color)).toEqual(["#4f7dc9", "#fff", "#aabbccdd"]);
    expect(matches[1]!.start).toBeGreaterThan(matches[0]!.end);
  });

  /*
   * 正文里 `#` 太常见，所以长度卡死才是"这算不算颜色"的分界线；而且长写法必须整体命中，
   * 否则 `#11223344` 会被六位规则截成 `#112233` 加一串残字，颜色悄悄变了值。
   */
  it("正文里的 # 不是颜色，长度不对的十六进制也不是", () => {
    expect(findDraftPalettes("第 #2 版、#标签，共 3 项")).toEqual([]);
    expect(findDraftPalettes("#12345")).toEqual([]);
    expect(findDraftPalettes("#1234567")).toEqual([]);
    expect(findDraftPalettes("#11223344").map((match) => match.color)).toEqual(["#11223344"]);
  });

  it("改写成配色组，并如实报告是否出现过配色", () => {
    const rewritten = rewriteDraftPalettes("把叶子改成 #4f7dc9 的配色");
    expect(rewritten.text).toBe("把叶子改成 [配色 #4f7dc9] 的配色");
    expect(rewritten.hasPalette).toBe(true);
    // 没有 token 时逐字节原样返回，调用方据此决定要不要追加意图句。
    expect(rewriteDraftPalettes("整体提亮")).toEqual({ text: "整体提亮", hasPalette: false });
  });
});

describe("contracts", () => {
  it("maps project-level aspect ratios to the OpenAI-compatible size family", () => {
    expect(resolveImageSize("1K", "AUTO", "1024x1536")).toBe("1024x1536");
    expect(resolveImageSize("2K", "1:1", "1024x1536")).toBe("1024x1024");
    expect(resolveImageSize("4K", "3:4", "1024x1024")).toBe("1024x1536");
    expect(resolveImageSize("1K", "9:16", "1024x1024")).toBe("1024x1536");
    expect(resolveImageSize("1K", "21:9", "1024x1024")).toBe("1536x1024");
    expect(resolveImageSize("1K", "4:5", "1024x1024")).toBe("1024x1536");
    expect(resolveImageSize("1K", "5:4", "1024x1024")).toBe("1536x1024");
  });

  it("keeps every registered API schema serializable with a unique component id", () => {
    const ids = Object.values(API_SCHEMA_REGISTRY).map((schema) => schema.$id);
    expect(ids.every((id) => typeof id === "string" && id.startsWith("#/components/schemas/"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => JSON.stringify(API_SCHEMA_REGISTRY)).not.toThrow();
  });

  it("creates string-based refs without the deprecated schema overload", () => {
    expect(schemaRef(ImageResolution).$ref).toBe("#/components/schemas/ImageResolution");
  });

  /**
   * 透明底能力判定是 Provider 协议边界：判错的方向有两个，一个会发出被拒的请求（浪费一次付费调用），
   * 一个会让本可直印的透明花型退回白底。所以两侧都钉住——尤其是快照 ID 必须跟随家族判定，
   * 以及"提示词驱动"家族（Gemini / seedream / qwen-3.0）必须留在拒绝侧：它们能画出看起来透明的
   * 棋盘格，但那不是 alpha 通道，按支持处理等于让用户拿到一张印出来带底纹的图。
   */
  it("judges transparent-background support per model family, refusing the prompt-only families", () => {
    // gpt-image-2 于 2026-08-20 开放透明底预览（官方 changelog 与 Cookbook 均以 background: "transparent" 为例），
    // 快照 ID 与未版本化的滚动别名一视同仁。
    const supported = ["gpt-image-1", "gpt-image-1-mini", "gpt-image-1.5", "gpt-image-1.5-2025-12-16", "gpt-image-2", "gpt-image-2-2026-04-21", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", " GPT-Image-1.5 "];
    for (const modelId of supported) expect(supportsTransparentBackground(modelId)).toBe(true);

    // 后三类只能在提示词里求透明，拿不到参数级保证：gemini 全系输出无 alpha，seedream 4.x 只给 jpeg，
    // qwen-image-3.0 接受该字段却不生效（字段被路由丢弃，仍返回无 alpha 的 PNG）。
    const unsupported = ["gemini-2.5-flash-image", "gemini-3-pro-image", "doubao-seedream-4-0-250828", "doubao-seedream-4-5", "qwen-image-3.0", "gpt-image-2-all", "gpt-image-2-vip", "dall-e-3", "flux-1.1-pro", "gpt-image-10", ""];
    for (const modelId of unsupported) expect(supportsTransparentBackground(modelId)).toBe(false);
  });
});
