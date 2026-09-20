import { describe, expect, it } from "vitest";
import { getBuiltinSuite, getBuiltinSuitesHash, listBuiltinSuiteIndex, normalizeSuiteDocument, parseSuiteAssetType, suiteSummary, type SuiteDocumentInput } from "./suite-catalog.js";

const validDocument: SuiteDocumentInput = {
  name: "测试套图",
  category: { l1: "护肤个护", l2: "面部护理", leaf: "测试洁面乳" },
  styleLock: { lockText: "柔光白底，暖米色台面，左上主光" },
  shots: [
    { order: 2, shotRole: "SCENE", displayName: "场景图", promptTemplate: "shot two {product}" },
    { order: 1, shotRole: "HERO", displayName: "主图", promptTemplate: "shot one {product}" }
  ]
};

describe("suite catalog", () => {
  it("loads the built-in suite library from SQLite and derives asset types", () => {
    const index = listBuiltinSuiteIndex();
    // 内置库随品类持续扩充，不锁定总数；只保护“非空且 id 唯一”这一目录不变量。
    expect(index.length).toBeGreaterThan(0);
    expect(new Set(index.map((entry) => entry.id)).size).toBe(index.length);
    const suite = getBuiltinSuite("suite-hufugehu-jiemianru");
    expect(suite).toBeDefined();
    expect(suite?.origin).toBe("builtin");
    expect(suite?.shots[0]?.assetType).toBe("suite-hufugehu-jiemianru::shot-01");
    expect(getBuiltinSuite("suite-does-not-exist")).toBeUndefined();
  });

  it("keeps index summary columns consistent with the full definition", () => {
    const index = listBuiltinSuiteIndex().find((entry) => entry.id === "suite-hufugehu-jiemianru");
    const suite = getBuiltinSuite("suite-hufugehu-jiemianru");
    expect(index).toBeDefined();
    expect(index?.name).toBe(suite?.name);
    expect(index?.l1).toBe(suite?.category.l1);
    expect(index?.l2).toBe(suite?.category.l2);
    expect(index?.leaf).toBe(suite?.category.leaf);
  });

  it("exposes the content hash from the meta table", () => {
    expect(getBuiltinSuitesHash()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parses suite asset types", () => {
    expect(parseSuiteAssetType("suite-a::shot-1")).toEqual({ suiteId: "suite-a", shotId: "shot-1" });
    expect(parseSuiteAssetType("hero-image")).toBeUndefined();
    expect(parseSuiteAssetType("::shot-1")).toBeUndefined();
  });

  it("normalizes documents, defaults shot ids, sorts by order and derives asset types", () => {
    const suite = normalizeSuiteDocument(validDocument, "user", { id: "custom-suite-abc" });
    expect(suite.id).toBe("custom-suite-abc");
    expect(suite.shots.map((shot) => shot.order)).toEqual([1, 2]);
    expect(suite.shots[0]?.shotId).toBe("shot-1");
    expect(suite.shots[0]?.assetType).toBe("custom-suite-abc::shot-1");
    expect(suite.shots[0]?.mode).toBe("CREATIVE");
    expect(suite.shots[0]?.supportsImageReference).toBe(true);
    expect(suite.shots[1]?.assetType).toBe("custom-suite-abc::shot-2");
  });

  it("rejects documents with invalid shot roles or missing required fields", () => {
    expect(() => normalizeSuiteDocument({ ...validDocument, shots: [{ shotRole: "BOGUS" as never, displayName: "x", promptTemplate: "p" }] }, "user", { id: "custom-suite-1" })).toThrow(/invalid shotRole/);
    expect(() => normalizeSuiteDocument({ ...validDocument, name: "" }, "user", { id: "custom-suite-1" })).toThrow(/missing a name/);
    expect(() => normalizeSuiteDocument(validDocument, "user")).toThrow(/missing an id/);
  });

  it("summarizes suites with shot metadata", () => {
    const suite = normalizeSuiteDocument(validDocument, "user", { id: "custom-suite-abc" });
    const summary = suiteSummary(suite);
    expect(summary.shotCount).toBe(2);
    expect(summary.shots).toEqual([
      { shotId: "shot-1", order: 1, shotRole: "HERO", displayName: "主图" },
      { shotId: "shot-2", order: 2, shotRole: "SCENE", displayName: "场景图" }
    ]);
    expect(summary.category.leaf).toBe("测试洁面乳");
  });
});
