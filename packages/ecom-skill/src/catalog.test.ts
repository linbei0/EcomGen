import { describe, expect, it } from "vitest";
import { ECOM_TEMPLATES, resolveTemplates, templateGuidance } from "./catalog.js";
import { resolveProductFamily } from "./product-family.js";

describe("ecom-details-image catalog adaptation", () => {
  it("keeps all 25 upstream templates addressable by stable IDs", () => {
    expect(ECOM_TEMPLATES).toHaveLength(25);
    expect(resolveTemplates(["主图", "detail-macro", "直播"]).map((template) => template.id)).toEqual(["hero-image", "detail-macro", "livestream"]);
  });

  it("maps free-text categories onto template families without inventing a match", () => {
    expect(resolveProductFamily("消费电子")).toBe("electronics");
    expect(resolveProductFamily("女装")).toBe("fashion");
    expect(resolveProductFamily("unknown-widget")).toBeNull();
  });

  it("scopes packshot reservations by platform and hands the full category tips to the planning agent", () => {
    const hero = ECOM_TEMPLATES[0];
    expect(templateGuidance(hero, ["TAOBAO"]).platformReservations.join(" ")).toContain("70-85%");
    expect(templateGuidance(hero, ["AMAZON"]).platformReservations.join(" ")).toContain("85%");
    const guidance = templateGuidance(hero, ["TAOBAO"]);
    expect(Object.keys(guidance.categoryTips)).toContain("fashion");
    expect(guidance.categoryTips.fashion).toMatch(/fabric|drape|stitching/i);
  });
});
