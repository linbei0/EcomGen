import { describe, expect, it } from "vitest";
import { API_SCHEMA_REGISTRY, ImageResolution, resolveImageSize, schemaRef, supportsTransparentBackground } from "./index.js";

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
