import { describe, expect, it } from "vitest";
import { PATTERN_VARIANT_PRESETS } from "@ecomgen/contracts";

import { compilePatternVariantPrompt, defaultVariantName, PATTERN_VARIANT_PRESET_LABELS, presetBelongsToAxis } from "./pattern-variant.js";

/**
 * 衍生 Prompt 是固化模板的纯函数：契约把预设限死为枚举，就是为了让"用户能选不能写"这件事
 * 在编译层成立（不存在自由 Prompt 通道）。这里锁三件事：确定性、预设与轴向真的改变输出、
 * 轴向归属判定与契约的预设表一致。
 */
describe("pattern variant prompt", () => {
  it("同输入逐字节一致，且不因调用次数改变", () => {
    const input = { axis: "STYLE" as const, preset: "WATERCOLOR" as const, extra: "偏冷色调" };
    expect(compilePatternVariantPrompt(input)).toBe(compilePatternVariantPrompt(input));
  });

  it("不同预设与不同轴向产出不同 Prompt，补充描述只是追加而不是替换模板", () => {
    const watercolor = compilePatternVariantPrompt({ axis: "STYLE", preset: "WATERCOLOR" });
    const lineArt = compilePatternVariantPrompt({ axis: "STYLE", preset: "LINE_ART" });
    const grid = compilePatternVariantPrompt({ axis: "COMPOSITION", preset: "GRID" });
    expect(watercolor).not.toBe(lineArt);
    expect(watercolor).not.toBe(grid);

    // 顺序固定为「输入图角色 → 预设片段 → 补充描述 → 护栏 → 排除项」：补充描述只是插入，
    // 不替换模板，也不越过护栏。
    const withExtra = compilePatternVariantPrompt({ axis: "STYLE", preset: "WATERCOLOR", extra: "偏冷色调" });
    const presetAt = withExtra.indexOf("Repaint with translucent watercolor");
    const extraAt = withExtra.indexOf("偏冷色调");
    const guardrailAt = withExtra.indexOf("Change only what the instruction asks for");
    expect(presetAt).toBeGreaterThanOrEqual(0);
    expect(extraAt).toBeGreaterThan(presetAt);
    expect(guardrailAt).toBeGreaterThan(extraAt);
    // 输入图角色先声明：只有一个图像输入时不说清角色，模型会把它当成风格参考而非待改的图。
    expect(withExtra.indexOf("Image 1 is the source pattern artwork")).toBe(0);
    // 模板自带的保持约束在任何预设下都存在：改了画风不该顺手改主题与配色。
    for (const prompt of [watercolor, lineArt, grid, withExtra]) expect(prompt).toContain("the artwork's theme, subject matter, motif positions, composition and overall color character all stay as they are");
  });

  it("轴向归属判定与契约的预设表一致，且每个预设都有标签", () => {
    for (const [axis, presets] of Object.entries(PATTERN_VARIANT_PRESETS)) {
      for (const preset of presets) {
        expect(presetBelongsToAxis(axis as keyof typeof PATTERN_VARIANT_PRESETS, preset)).toBe(true);
        expect(PATTERN_VARIANT_PRESET_LABELS[preset]).toBeTruthy();
      }
    }
    // 跨轴向调用必须被拒：预设清单与轴向的对应关系不能靠调用方自觉。
    expect(presetBelongsToAxis("STYLE", "GRID")).toBe(false);
    expect(presetBelongsToAxis("COMPOSITION", "WATERCOLOR")).toBe(false);
  });

  it("缺省名带源名与轴向预设，便于在花型墙辨认", () => {
    expect(defaultVariantName("水彩野花", "STYLE", "WATERCOLOR")).toBe("水彩野花 · 画风水彩");
  });

  /**
   * 三种底版护栏互斥：同时出现"保持透明"和"铺纯白底"是自相矛盾的指令，模型会按其中任意一条发挥，
   * 产物就成了随机行为。缺省必须是 SOURCE——衍生默认"不动底"，替用户改底是以前的行为，
   * 那时用户没得选，现在得由用户明确要白底才会铺白。
   */
  it("三种底版护栏互斥，缺省跟随源图，且都保留不许改主题的约束", () => {
    const byDefault = compilePatternVariantPrompt({ axis: "STYLE", preset: "LINE_ART" });
    const source = compilePatternVariantPrompt({ axis: "STYLE", preset: "LINE_ART", background: "SOURCE" });
    const white = compilePatternVariantPrompt({ axis: "STYLE", preset: "LINE_ART", background: "WHITE" });
    const transparent = compilePatternVariantPrompt({ axis: "STYLE", preset: "LINE_ART", background: "TRANSPARENT" });

    expect(byDefault).toBe(source);
    expect(source).toContain("Leave the background treatment exactly as it is in the reference");
    expect(white).toContain("plain pure-white background");
    expect(transparent).toContain("fully transparent background");
    expect(transparent).toContain("no drawn checkerboard");
    for (const prompt of [source, white, transparent]) {
      expect(prompt).toContain("Change only what the instruction asks for");
      expect(prompt).toContain("no elements are added or removed");
    }
    // 三句护栏互不同时出现：底版是单选，不是叠加。
    expect(source).not.toContain("pure-white");
    expect(white).not.toContain("alpha");
    expect(transparent).not.toContain("pure-white");
    expect(white).not.toContain("exactly as it is");
  });
});
