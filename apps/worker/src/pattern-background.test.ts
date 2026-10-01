import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { hasTransparentPixels, resolvePatternBackground, verifyPatternBackground } from "./pattern-background.js";

/** 生成纯色测试图：`alpha` 为 0/1 时分别得到全透明与不透明的四通道 PNG。 */
async function solidPng(alpha: number): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 255, b: 255, alpha } } }).png().toBuffer();
}

describe("花型底版解析", () => {
  const capable = { id: "gpt-image-1.5", imageApiKind: "openai_images" };
  const gemini = { id: "gemini-2.5-flash-image", imageApiKind: "gemini" };
  const thirdParty = { id: "doubao-seedream-4-0-250828", imageApiKind: "openai_images" };

  it("白底不要求透明参数，也不做 alpha 校验", () => {
    const plan = resolvePatternBackground({ mode: "WHITE", model: capable });
    expect(plan).toMatchObject({ prompt: "WHITE", transparent: null, verifyTransparent: false });
  });

  it("透明底在有能力的模型上同时给出请求参数与校验要求", () => {
    const plan = resolvePatternBackground({ mode: "TRANSPARENT", model: capable });
    // output_format 必须跟着给：jpeg 装不下 alpha，Provider 会报错或悄悄给一张不透明图。
    expect(plan.transparent).toEqual({ background: "transparent", outputFormat: "png" });
    expect(plan.verifyTransparent).toBe(true);
  });

  it("模型给不了透明底时在付费调用前就拒绝，并给出两条出路", () => {
    for (const model of [gemini, thirdParty]) {
      // 兼容端点上的第三方模型同样给不了：imageApiKind 说是 images 接口，能力表不认它。
      expect(() => resolvePatternBackground({ mode: "TRANSPARENT", model })).toThrow(/不支持透明底/);
      expect(() => resolvePatternBackground({ mode: "TRANSPARENT", model })).toThrow(/白底/);
    }
  });

  it("跟随源图只在源本身透明时才要透明底，源不透明时连参数都不发", () => {
    expect(resolvePatternBackground({ mode: "SOURCE", model: capable, sourceTransparent: false })).toMatchObject({ prompt: "SOURCE", transparent: null, verifyTransparent: false });
    expect(resolvePatternBackground({ mode: "SOURCE", model: capable })).toMatchObject({ transparent: null });
    expect(resolvePatternBackground({ mode: "SOURCE", model: capable, sourceTransparent: true })).toMatchObject({
      prompt: "SOURCE",
      transparent: { background: "transparent", outputFormat: "png" },
      verifyTransparent: true,
    });
  });

  it("源是透明底但模型给不了时拒绝，并说明透明底会被换成白底", () => {
    expect(() => resolvePatternBackground({ mode: "SOURCE", model: gemini, sourceTransparent: true })).toThrow(/透明底会被换成白底|换成白底或棋盘格/);
    // 用户没主动要透明底，所以出路里必须点出"源花型"这一前提，否则看不懂为什么被拒。
    expect(() => resolvePatternBackground({ mode: "SOURCE", model: gemini, sourceTransparent: true })).toThrow(/源花型是透明底/);
  });
});

describe("透明底产物校验", () => {
  it("区分真透明与只是带了 alpha 通道的图", async () => {
    expect(await hasTransparentPixels(await solidPng(0))).toBe(true);
    // 全 255 的 alpha 通道不是透明：模型把"透明"画成棋盘格时最常见的就是这种通道 + 实心像素。
    expect(await hasTransparentPixels(await solidPng(1))).toBe(false);
    // 三通道 PNG 连 alpha 都没有。
    expect(await hasTransparentPixels(await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer())).toBe(false);
  });

  it("解码失败按不透明处理，不把坏图当透明底放行", async () => {
    expect(await hasTransparentPixels(Buffer.from("not an image"))).toBe(false);
  });

  it("要了透明却拿到不透明时抛错，且错误信息指向已保存的产物", async () => {
    const plan = resolvePatternBackground({ mode: "TRANSPARENT", model: { id: "gpt-image-1.5", imageApiKind: "openai_images" } });
    await expect(verifyPatternBackground(plan, await solidPng(1), "起稿")).rejects.toThrow(/产物已保存/);
    await expect(verifyPatternBackground(plan, await solidPng(0), "起稿")).resolves.toBeUndefined();
  });

  it("没要透明底时校验形同不存在", async () => {
    const plan = resolvePatternBackground({ mode: "WHITE", model: { id: "gpt-image-1.5", imageApiKind: "openai_images" } });
    await expect(verifyPatternBackground(plan, await solidPng(1), "衍生")).resolves.toBeUndefined();
  });
});
