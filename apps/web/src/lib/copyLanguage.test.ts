import { describe, expect, it } from "vitest";

import { copyLanguageLabel, copyLanguageOptionMatches, resolveCopyLanguage } from "./copyLanguage";

describe("文案语种显示映射", () => {
  it("把已保存的语言代码显示成中文名", () => {
    expect(copyLanguageLabel("zh-Hans")).toBe("简体中文");
    expect(copyLanguageLabel("zh-CN")).toBe("简体中文");
    expect(copyLanguageLabel("en-US")).toBe("英语（美国）");
    expect(copyLanguageLabel("pt-BR")).toBe("pt-BR");
    expect(copyLanguageLabel("")).toBe("");
  });

  it("把中文名、别名和代码统一成可保存的语言代码", () => {
    expect(resolveCopyLanguage("简体中文")).toBe("zh-Hans");
    expect(resolveCopyLanguage("简体")).toBe("zh-Hans");
    expect(resolveCopyLanguage("zh-Hans")).toBe("zh-Hans");
    expect(resolveCopyLanguage("繁体中文")).toBe("zh-Hant");
    expect(resolveCopyLanguage("英语（美国）")).toBe("en-US");
    expect(resolveCopyLanguage("日语")).toBe("ja-JP");
    expect(resolveCopyLanguage("pt-BR")).toBe("pt-BR");
    expect(resolveCopyLanguage("  ")).toBe("");
  });

  it("搜索时同时匹配中文名和语言代码", () => {
    expect(copyLanguageOptionMatches("zh-Hans", "简体中文")).toBe(true);
    expect(copyLanguageOptionMatches("简", "简体中文")).toBe(true);
    expect(copyLanguageOptionMatches("de", "德语")).toBe(true);
    expect(copyLanguageOptionMatches("简体中文", "英语（美国）")).toBe(true);
    expect(copyLanguageOptionMatches("pt", "简体中文")).toBe(false);
  });
});
