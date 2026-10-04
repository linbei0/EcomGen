import { describe, expect, it } from "vitest";

import { compileDraftEditPrompt, compileDraftGeneratePrompt, defaultSketchNote } from "./pattern-draft.js";

/**
 * 起稿工作台的提示词合约。
 *
 * 这里钉的是"什么内容会进入模型请求"，不是文案本身：参考图的两条规则（通用方向句只在起稿发、
 * 备注逐图转述）、改稿的范围句随"有没有选区"切换、配色 token 被渲染成配色子句、
 * 以及 `@图N` 在起稿与改稿下落到不同的 Image 号。
 * 这些一旦错位，界面上看着带上了的参考图在请求里可能落空，或者承诺了并不成立的锁定。
 */

describe("起稿提示词", () => {
  it("通用方向句与逐图备注同时下发，备注不再挤掉方向句", () => {
    const prompt = compileDraftGeneratePrompt({
      theme: "玉兰",
      composeType: "REPEAT",
      background: "WHITE",
      references: [{ ordinal: 2, notes: "这张是布局草图" }, { ordinal: 5 }],
    });
    expect(prompt).toContain("2 reference images attached: use them as visual direction for style, palette and motifs.");
    expect(prompt).toContain("Reference notes by image: Image 1: 这张是布局草图.");
  });

  it("没有备注时只发方向句，不做逐图转述", () => {
    const prompt = compileDraftGeneratePrompt({ theme: "玉兰", composeType: "PLACEMENT", background: "WHITE", references: [{ ordinal: 1 }] });
    expect(prompt).toContain("1 reference image attached: use it as visual direction for style, palette and motifs.");
    expect(prompt).not.toContain("Reference notes by image");
  });

  it("主题里的配色 token 被渲染成配色组并附上意图句", () => {
    const prompt = compileDraftGeneratePrompt({ theme: "玉兰，#c94f4f 主色，#4f7dc9 辅助", composeType: "PLACEMENT", background: "WHITE" });
    expect(prompt).toContain("玉兰，[配色 #c94f4f] 主色，[配色 #4f7dc9] 辅助");
    expect(prompt).toContain("treat it as the intended color scheme");
  });
});

describe("改稿提示词", () => {
  it("只发逐图备注，不补通用方向句——用途已写在用户自己的措辞里", () => {
    const prompt = compileDraftEditPrompt({ annotated: false, instruction: "照 @图2 的配色调暖", references: [{ ordinal: 2, notes: "配色参考" }] });
    expect(prompt).toContain("Reference notes by image: Image 2: 配色参考.");
    expect(prompt).not.toContain("visual direction");
    // 改稿的父候选占 Image 1，参考图从 Image 2 起算：编号的说法变了，编号本身没变。
    expect(prompt).toContain("Edit it: 照 Image 2 的配色调暖.");
  });

  it("范围句随有无笔迹切换：有笔迹才谈得上按笔迹改，没有就是整图", () => {
    const marked = compileDraftEditPrompt({ annotated: true, instruction: "把这朵花改成粉色" });
    // 少了任一条都会出事：不说笔迹是标注，模型会把它当画面内容保留；不说要抹掉，结果里会留下色斑。
    expect(marked).toContain("annotations, not artwork");
    expect(marked).toContain("erase the marks completely");
    // 没有笔迹时不能出现任何"笔迹外如何如何"的承诺——源图整张交给模型，那句话兑现不了。
    const whole = compileDraftEditPrompt({ annotated: false, instruction: "整体提亮" });
    expect(whole).toContain("Change only what the instruction asks for");
    expect(whole).not.toContain("annotations");
  });

  it("说明里的配色 token 变成配色组，并附上不承诺精确色值的意图句", () => {
    const prompt = compileDraftEditPrompt({ annotated: false, instruction: "把叶子改成 #4f7dc9 的配色，花心 #c94f4f" });
    expect(prompt).toContain("把叶子改成 [配色 #4f7dc9] 的配色，花心 [配色 #c94f4f]");
    // token 提升的是可控性，不是精度：这句限定必须跟着 token 一起进提示词。
    expect(prompt).toContain("rather than reproducing those exact hex values");
  });

  it("没写配色时不出现任何配色措辞", () => {
    expect(compileDraftEditPrompt({ annotated: false, instruction: "整体提亮" })).not.toContain("color scheme");
  });
});

describe("草图默认备注", () => {
  it("按创作类型各一句，连续花型额外要求可平铺", () => {
    const placement = defaultSketchNote("PLACEMENT");
    const repeat = defaultSketchNote("REPEAT");
    expect(placement).not.toBe(repeat);
    for (const note of [placement, repeat]) expect(note).toContain("不要复现手绘线条");
    // 手绘的四边通常不接续：只让它"照排"会把接缝风险直接带进成品，所以 REPEAT 必须显式要求可平铺。
    expect(repeat).toContain("可平铺");
  });
});
