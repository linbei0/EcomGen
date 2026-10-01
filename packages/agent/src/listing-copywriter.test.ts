import { describe, expect, it } from "vitest";
import type { ListingPlatform } from "@ecomgen/contracts";
import { validateListingCopy } from "./listing-copywriter.js";

/**
 * Listing 平台硬校验是文案链路的最后护栏：平台字数上限来自 contracts 的
 * LISTING_PLATFORM_LIMITS 单源，违规返回 undefined（触发一次有界重试）而非截断放行。
 */
describe("validateListingCopy", () => {
  const base = { description: "A watercolor wildflower bouquet for everyday wear and gifts.", bullets: [] as string[] };

  it("Etsy：140 字符标题与 13×20 tags 恰好放行，返回规整后的 copy", () => {
    const copy = validateListingCopy("ETSY", {
      ...base,
      title: `Watercolor Wildflower Bouquet ${"k".repeat(110)}`, // 前缀 30 + 110 = 恰好 140
      tags: Array.from({ length: 13 }, (_, index) => `tag${index}${"y".repeat(15)}`),
    });
    expect(copy?.platform).toBe("ETSY");
    expect(copy?.tags).toHaveLength(13);
  });

  it.each([
    ["Etsy 标题超 140", "ETSY", { ...base, title: "t".repeat(141), tags: [] }],
    ["Etsy tags 超过 13 个", "ETSY", { ...base, title: "ok", tags: Array.from({ length: 14 }, () => "tag") }],
    ["Etsy 单个 tag 超 20 字符", "ETSY", { ...base, title: "ok", tags: ["t".repeat(21)] }],
    ["Amazon 标题超 75", "AMAZON", { ...base, title: "t".repeat(76), tags: [] }],
    ["Amazon 不允许 tags", "AMAZON", { ...base, title: "ok", tags: ["tag"] }],
    ["Amazon bullets 超过 5 条", "AMAZON", { ...base, title: "ok", tags: [], bullets: ["b", "b", "b", "b", "b", "b"] }],
    ["Amazon 单条 bullet 超 256", "AMAZON", { ...base, title: "ok", tags: [], bullets: ["b".repeat(257)] }],
    ["TikTok 标题不足 25", "TIKTOK_SHOP", { ...base, title: "t".repeat(24), tags: [] }],
    ["TikTok 标题超 200", "TIKTOK_SHOP", { ...base, title: "t".repeat(201), tags: [] }],
  ])("%s 时返回 undefined（触发重试而非放行）", (_name, platform, value) => {
    expect(validateListingCopy(platform as ListingPlatform, value)).toBeUndefined();
  });

  it("Amazon 三点式要点与 75 字符标题恰好放行", () => {
    const copy = validateListingCopy("AMAZON", {
      ...base,
      title: "t".repeat(75),
      tags: [],
      bullets: ["bullet one", "bullet two", "bullet three"],
    });
    expect(copy?.bullets).toHaveLength(3);
  });

  it("TikTok 标题在 25–200 区间内放行", () => {
    expect(validateListingCopy("TIKTOK_SHOP", { ...base, title: "t".repeat(25), tags: [] })?.title).toHaveLength(25);
    expect(validateListingCopy("TIKTOK_SHOP", { ...base, title: "t".repeat(200), tags: [] })?.title).toHaveLength(200);
  });

  it("字段值做 trim 规整；空白字段按违规抛错处理", () => {
    const copy = validateListingCopy("ETSY", { ...base, title: "  Cozy Cat Tee  ", tags: [" cat "] });
    expect(copy?.title).toBe("Cozy Cat Tee");
    expect(copy?.tags).toEqual(["cat"]);
    expect(() => validateListingCopy("ETSY", { ...base, title: "   " })).toThrow("invalid title");
    expect(() => validateListingCopy("ETSY", { ...base, title: "ok", tags: ["ok", " "] })).toThrow("invalid tag");
  });

  it("非对象或缺失 title 的返回值直接抛错，不进入重试", () => {
    expect(() => validateListingCopy("ETSY", null)).toThrow("invalid result");
    expect(() => validateListingCopy("ETSY", "text")).toThrow("invalid result");
    expect(() => validateListingCopy("ETSY", { description: "d" })).toThrow("invalid title");
  });
});
