import { describe, expect, it } from "vitest";
import type { ModelSpec } from "@ecomgen/contracts";
import { MODEL_SPEC_DEFAULTS } from "@ecomgen/contracts";
import {
  blockedModelOptions,
  compileModelCastPrompt,
  compileModelPortraitPrompt,
  findModelSpecConflicts,
  MODEL_CAST_PRESETS,
  MODEL_PROMPT_WORD_BUDGET,
  MODEL_REFERENCE_FACE_PREFIX,
  modelOptionIssue,
  modelSpecSummary,
  reconcileModelSpecDraft,
  repairModelSpec,
} from "./model-cast.js";

const baseSpec: ModelSpec = {
  gender: "FEMALE", age: "LATE_20S", heritage: "EAST_ASIAN", stature: "STANDARD_165", build: "BALANCED",
  faceShape: "OVAL", eyeShape: "ALMOND", eyeColor: "DARK_BROWN", browShape: "STRAIGHT_SOFT", noseShape: "STRAIGHT", lipShape: "NATURAL",
  hairLength: "SHOULDER", hairstyle: "SOFT_WAVE", hairColor: "INK_BLACK", hairTexture: "NATURAL_VOLUME", hairline: "ROUNDED",
  complexion: "FAIR_WARM", skinTexture: "NATURAL_PORES", facialHair: "NONE", distinctiveMarks: [],
  expression: "CALM_DIRECT", gaze: "DIRECT_TO_CAMERA", aura: ["WARM_APPROACHABLE"], makeup: "MINIMAL_DEWY", baseWardrobe: "WHITE_TANK",
  framing: "THREE_QUARTER", pose: "HANDS_RELAXED", backdrop: "SEAMLESS_GREY", lighting: "SOFTBOX_THREE_POINT", lens: "LENS_50",
};

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

describe("compileModelPortraitPrompt", () => {
  it("is deterministic: the same spec compiles byte-identical prompts", () => {
    const first = compileModelPortraitPrompt(baseSpec, "");
    const second = compileModelPortraitPrompt(baseSpec, "");
    expect(first).toBe(second);
  });

  it("keeps the compiled body within the word budget even with every optional segment filled", () => {
    const full: ModelSpec = {
      ...baseSpec,
      distinctiveMarks: ["FRECKLES_NOSE", "MOLE_CHEEK"],
      aura: ["WARM_APPROACHABLE", "QUIET_CONFIDENCE", "METROPOLITAN"],
    };
    // notes 不计入预算；无 notes 时整段就是正文。
    expect(countWords(compileModelPortraitPrompt(full, ""))).toBeLessThanOrEqual(MODEL_PROMPT_WORD_BUDGET);
  });

  it("injects notes as an Additional requirements clause and keeps them regardless of budget", () => {
    const longNotes = "记忆点但不得网红脸；适合米白与大地色品牌视觉，整体高于真实卖点。".repeat(10);
    const prompt = compileModelPortraitPrompt(baseSpec, longNotes);
    expect(prompt).toContain("Additional requirements: ");
    expect(prompt.endsWith(longNotes)).toBe(true);
  });

  it("derives exactly two distinguishable asymmetries from the spec", () => {
    const matches = compileModelPortraitPrompt(baseSpec, "").match(/Naturally asymmetric details: ([^.]+)\./);
    expect(matches).not.toBeNull();
    const items = matches![1].split(", ");
    // 两条派生细节必须落在不同语料上：重复项会让「对抗完美对称」变成同一句话说两遍。
    expect(items).toHaveLength(2);
    expect(new Set(items).size).toBe(2);
  });

  // 四个层各取一个代表维度：证明编译器读的是 spec 的取值，而不是写死的常量。
  it.each([
    { field: "framing", patch: { framing: "FULL_BODY" }, expected: "Full-body studio portrait" },
    { field: "age", patch: { age: "MID_40S" }, expected: "a 46-year-old" },
    { field: "eyeColor", patch: { eyeColor: "HAZEL" }, expected: "hazel" },
    { field: "gaze", patch: { gaze: "LOWERED_LIDS" }, expected: "gaze lowered with relaxed lids" },
    { field: "lens", patch: { lens: "LENS_85" }, expected: "85mm lens" },
  ] as Array<{ field: string; patch: Partial<ModelSpec>; expected: string }>)("把 $field 的取值映射进 prompt", ({ patch, expected }) => {
    expect(compileModelPortraitPrompt({ ...baseSpec, ...patch }, "")).toContain(expected);
  });

  it("anchors adult plus-size build with a concrete size", () => {
    // 正向：成人档才带尺码锚定；童模侧的省略由下一条用例反向验证。
    expect(compileModelPortraitPrompt({ ...baseSpec, build: "PLUS" }, "")).toContain("US size 16");
  });

  it("compiles child ages with child model nouns and omits adult-only size anchors", () => {
    const child = compileModelPortraitPrompt({ ...baseSpec, age: "CHILD_7" }, "");
    expect(child).toContain("a 7-year-old female child model");
    expect(child).not.toContain("cm");
    expect(child).not.toContain("US size 16");
    expect(compileModelPortraitPrompt({ ...baseSpec, age: "PRETEEN_11" }, "")).toContain("an 11-year-old female preteen model");
    expect(compileModelPortraitPrompt({ ...baseSpec, age: "TEEN_16" }, "")).toContain("a 16-year-old female teen model");
    // 大码 + 童模：仍表述体型，但不带成人尺码锚定。
    expect(compileModelPortraitPrompt({ ...baseSpec, age: "CHILD_7", build: "PLUS" }, "")).toContain("a plus-size build.");
  });

  it("expands aura keywords into linked presence clauses without overriding explicit lighting", () => {
    const prompt = compileModelPortraitPrompt(baseSpec, "");
    expect(prompt).toContain("The overall presence is warm and approachable (open, relaxed shoulders");
    expect(prompt).toContain("softbox");
  });

  it("compiles every shipped preset within the word budget", () => {
    // 出厂预设是随包数据：取值表与编译器脱钩（漏改选项键）会让这里直接抛错，
    // 而词数上界保证预设不靠丢弃可选段收场。
    for (const preset of MODEL_CAST_PRESETS) {
      expect(countWords(compileModelPortraitPrompt(preset.spec, "")), `预设 ${preset.id}`).toBeLessThanOrEqual(MODEL_PROMPT_WORD_BUDGET);
    }
  });

  it("实发 prompt 无参考脸时等于编译正文，有参考脸时只前置身份锚点句", () => {
    const notes = "耳后有一缕碎发";
    const body = compileModelPortraitPrompt(baseSpec, notes);
    // 前端预览与 Worker 生图请求共用这两个函数：分解方式变了，两边会同时错，因此这里钉死组合关系。
    expect(compileModelCastPrompt(baseSpec, notes, false)).toBe(body);
    expect(compileModelCastPrompt(baseSpec, notes, true)).toBe(`${MODEL_REFERENCE_FACE_PREFIX} ${body}`);
  });
});

describe("modelSpecSummary", () => {
  it("摘要把「不参与编译」的维度挡在外面", () => {
    // 童模不输出身高锚点：摘要里出现「165cm」等于向用户承诺一个不会进提示词的规格。
    expect(modelSpecSummary({ ...baseSpec, age: "CHILD_7" })).toBe("女 · 儿童 7 岁上下 · 东亚 · 匀称");
  });
});

describe("规格互斥判定", () => {
  /** 键名与 blockedModelOptions 一致，便于按维度断言。 */
  const blocked = (spec: Partial<ModelSpec>): string[] => [...blockedModelOptions(spec).keys()];

  it("基准款自身通过互斥校验，且每个出厂预设都可直接生成", () => {
    expect(findModelSpecConflicts(MODEL_SPEC_DEFAULTS)).toEqual([]);
    for (const preset of MODEL_CAST_PRESETS) {
      expect(findModelSpecConflicts(preset.spec), `预设 ${preset.id} 存在互斥组合`).toEqual([]);
    }
  });

  it("判定是双向的：无论先改哪一侧，互斥组合都会被拦下", () => {
    // 短发侧的候选：高盘发需要齐肩以上。
    expect(modelOptionIssue("hairstyle", "HIGH_BUN", { hairLength: "CROP" })?.kind).toBe("conflict");
    // 换到发长侧改，同一组合同样被拦：发型已经定了高盘发。
    expect(modelOptionIssue("hairLength", "CROP", { hairstyle: "HIGH_BUN" })?.kind).toBe("conflict");
  });

  it("发长是发型的下界，寸头与及腰长发互斥", () => {
    const short = blocked({ hairLength: "CROP" });
    expect(short).toEqual(expect.arrayContaining(["hairstyle:HIGH_BUN", "hairstyle:PONYTAIL", "hairstyle:DEEP_CURL", "hairstyle:BRAIDED", "hairstyle:SLEEK_STRAIGHT"]));
    // 短发下仍成立的前额造型与短造型不受影响。
    expect(short).not.toContain("hairstyle:TEXTURED_FRINGE");
    expect(short).not.toContain("hairstyle:SHAVED");
    expect(blocked({ hairLength: "WAIST" })).toContain("hairstyle:SHAVED");
  });

  it("童模档位排除成妆、岁月纹理、胡须与超模骨架", () => {
    const child = blocked({ age: "CHILD_7" });
    expect(child).toEqual(expect.arrayContaining([
      "makeup:RED_LIP", "makeup:SMOKY", "makeup:MINIMAL_DEWY", "skinTexture:MATURE_LINES",
      "facialHair:STUBBLE", "stature:RUNWAY_180", "build:MATERNITY",
    ]));
    // 素颜全年龄可用；童模的身高锚点标为「不参与」而不是「矛盾」。
    expect(child).not.toContain("makeup:NONE");
    expect(modelOptionIssue("stature", "STANDARD_165", { age: "CHILD_7" })).toEqual({ kind: "inapplicable", reason: expect.any(String) });
  });

  it("胡须需要男性骨相，孕味需要女性呈现", () => {
    expect(blocked({ gender: "FEMALE" })).toEqual(expect.arrayContaining(["facialHair:BEARD", "facialHair:FULL_BEARD", "facialHair:MUSTACHE"]));
    expect(blocked({ gender: "FEMALE" })).not.toContain("facialHair:NONE");
    // 中性呈现可以有胡茬，但浓密胡须仍限男性。
    expect(modelOptionIssue("facialHair", "STUBBLE", { gender: "ANDROGYNOUS" })).toBeNull();
    expect(modelOptionIssue("facialHair", "BEARD", { gender: "ANDROGYNOUS" })?.kind).toBe("conflict");
    expect(modelOptionIssue("build", "MATERNITY", { gender: "MALE" })?.kind).toBe("conflict");
  });

  it("特写拍不到的姿态被排除，走动要求全身", () => {
    const closeup = blocked({ framing: "BEAUTY_CLOSEUP" });
    expect(closeup).toEqual(expect.arrayContaining(["pose:NATURAL_WALK", "pose:SEATED_STOOL", "pose:LEANING_WALL", "pose:HANDS_ON_HIPS", "pose:ARMS_CROSSED"]));
    expect(closeup).not.toContain("pose:HANDS_RELAXED");
    expect(blocked({ pose: "NATURAL_WALK" })).toEqual(expect.arrayContaining(["framing:WAIST_UP", "framing:THREE_QUARTER", "framing:BEAUTY_CLOSEUP"]));
    expect(blocked({ pose: "NATURAL_WALK" })).not.toContain("framing:FULL_BODY");
  });

  it("棚内灯具与外景背景互斥，自然光不受此限", () => {
    expect(blocked({ backdrop: "OUTDOOR_BOKEH" })).toEqual(expect.arrayContaining(["lighting:SOFTBOX_THREE_POINT", "lighting:RING_LIGHT", "lighting:HIGH_KEY_STUDIO"]));
    expect(modelOptionIssue("backdrop", "OUTDOOR_BOKEH", { lighting: "GOLDEN_BACKLIT" })).toBeNull();
  });

  it("未指定的维度不构成约束：空白草稿里没有不可选的取值", () => {
    expect(modelOptionIssue("hairstyle", "HIGH_BUN", {})).toBeNull();
    expect([...blockedModelOptions({}).values()]).toEqual([]);
  });

  it("草稿收敛清掉被动冲突的维度，显式选择不被改动", () => {
    const draft: Partial<ModelSpec> = { ...baseSpec, age: "CHILD_7", makeup: "MINIMAL_DEWY" };
    const { spec, dropped } = reconcileModelSpecDraft(draft, new Set(["age"] as const));
    expect(spec.age).toBe("CHILD_7");
    // 日常淡妆要求 11 岁以上，让位；无约束的维度不受牵连。
    expect(spec.makeup).toBeUndefined();
    expect(spec.skinTexture).toBe("NATURAL_PORES");
    expect(spec.stature).toBe("STANDARD_165");
    expect(dropped).toEqual(["makeup"]);
    expect(findModelSpecConflicts(spec)).toEqual([]);
  });

  it("补全后的完整规格若撞上用户显式选择，由修复顶到该维度第一个可选取值", () => {
    const completed: ModelSpec = { ...MODEL_SPEC_DEFAULTS, age: "CHILD_7" };
    const { spec, repaired } = repairModelSpec(completed, new Set(["age"] as const));
    expect(spec.age).toBe("CHILD_7");
    expect(spec.makeup).toBe("NONE");
    expect(repaired).toContain("makeup");
    expect(findModelSpecConflicts(spec)).toEqual([]);
  });
});
