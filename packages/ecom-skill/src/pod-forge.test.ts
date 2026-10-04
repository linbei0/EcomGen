import { describe, expect, it } from "vitest";

import { PATTERN_EXTRACT_PROMPT_VERSION, compilePatternExtractPrompt, compilePatternForgePrompt, compilePatternGenerateExtractPrompt } from "./pod-forge.js";

/**
 * 起稿 Prompt 与衍生同属固化模板：任务指纹只覆盖输入、不覆盖编译结果，模板一旦漂移，
 * 旧任务会被判为可复用而静默复用旧产物。这里锁确定性，以及透明底/白底两条互斥的底板要求
 * （worker 依据前者校验 alpha，并把"要了透明却没拿到"判为失败）。
 */
describe("pattern forge prompt", () => {
  it("同输入逐字节一致，保证指纹可复现", () => {
    const input = { theme: "山茶花线描", style: "line art", category: "TSHIRT" as const };
    expect(compilePatternForgePrompt(input)).toBe(compilePatternForgePrompt(input));
  });

  it("白底与透明底两条底板要求互斥，缺省是白底", () => {
    const opaque = compilePatternForgePrompt({ theme: "山茶花" });
    const explicitWhite = compilePatternForgePrompt({ theme: "山茶花", background: "WHITE" });
    const transparent = compilePatternForgePrompt({ theme: "山茶花", background: "TRANSPARENT" });
    expect(opaque).toBe(explicitWhite);
    expect(opaque).not.toBe(transparent);
    expect(opaque).toContain("plain pure-white background");
    expect(transparent).toContain("fully transparent background");
    expect(transparent).not.toContain("pure-white");
    // 画出来的棋盘格不是透明：这句是 worker 校验 alpha 之外唯一能劝住模型的地方。
    expect(transparent).toContain("no drawn checkerboard");
    expect(opaque).not.toContain("alpha");
  });

  it("主题、构图建议与负面约束按输入进入 Prompt", () => {
    const withoutCategory = compilePatternForgePrompt({ theme: "山茶花", style: "watercolor" });
    expect(withoutCategory).toContain("山茶花");
    expect(withoutCategory).toContain("Style: watercolor");
    expect(withoutCategory).not.toContain("chest-print motif");

    const shirt = compilePatternForgePrompt({ theme: "山茶花", category: "TSHIRT" });
    expect(shirt).toContain("chest print");
    // 排除项在所有分支都必须存在：文案与水印会跟着花型一起印到布料上。
    for (const prompt of [withoutCategory, shirt, compilePatternForgePrompt({ theme: "山茶花", background: "TRANSPARENT" })]) {
      expect(prompt).toContain("no watermark, no signature");
      // 印刷 register 与排除项一样是每个分支的固定件。
      expect(prompt).toContain("flat two-dimensional print artwork");
    }
  });

  it("提取提示原样透传用户词表，缺省时只用基底描述", () => {
    expect(compilePatternExtractPrompt()).toContain("the printed graphic artwork on the product");
    expect(compilePatternExtractPrompt("  左下角的花  ")).toBe(`${compilePatternExtractPrompt()}. Hints: 左下角的花`);
  });

  it("生成式提取：底版子句、用户词表与可印性约束进同一份提示词", () => {
    expect(compilePatternGenerateExtractPrompt({ background: "TRANSPARENT" })).toContain("no drawn checkerboard");
    expect(compilePatternGenerateExtractPrompt({ background: "WHITE" })).toContain("pure-white background");
    const hinted = compilePatternGenerateExtractPrompt({ background: "TRANSPARENT", brief: "只留杯壁图案" });
    expect(hinted).toContain("Hints: 只留杯壁图案");
    // 生成提取的产物会与起稿/衍生的产物并排出现在同一个花型墙里，可印性约束必须同源。
    expect(hinted).toContain("no watermark, no signature");
    // 提取不是创作：重绘结果对源图图案的保真要求必须一直在模板里。
    expect(hinted).toContain("faithful to the source photo");
    expect(PATTERN_EXTRACT_PROMPT_VERSION).toMatch(/^\d{4}\.\d+\.\d+$/);
  });
});
