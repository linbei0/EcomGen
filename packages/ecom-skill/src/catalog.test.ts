import { describe, expect, it } from "vitest";
import { compileUserTemplate, ECOM_TEMPLATES, isUserTemplateId, resolveTemplates, resolveTemplatesWithUser, templateGuidance } from "./catalog.js";
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

describe("user-defined templates", () => {
  const source = { id: "custom-ab12cd34", name: "我的白底主图", prompt: "Clean packshot of {product_description} on pure white background.", defaultSize: "1024x1024" as const, supportsImageReference: true };

  it("compiles a user template into the built-in template shape with neutral execution defaults", () => {
    const compiled = compileUserTemplate(source);
    expect(compiled.prompt_template).toEqual({ custom_prompt: source.prompt });
    expect(compiled.variants).toEqual({});
    expect(compiled.upstreamNumber).toBe(0);
    expect(compiled.defaultSize).toBe("1024x1024");
    expect(compiled.supports_image_reference).toBe(true);
    const guidance = templateGuidance(compiled, []);
    expect(guidance.visualFields.custom_prompt).toBe(source.prompt);
  });

  it("identifies user template IDs by the custom- prefix", () => {
    expect(isUserTemplateId("custom-ab12cd34")).toBe(true);
    expect(isUserTemplateId("hero-image")).toBe(false);
  });

  it("resolves mixed requests with exact id/name matching for user templates only", () => {
    const user = compileUserTemplate(source);
    expect(resolveTemplatesWithUser(["hero-image", "custom-ab12cd34"], [user]).map((template) => template.id)).toEqual(["hero-image", "custom-ab12cd34"]);
    expect(resolveTemplatesWithUser(["我的白底主图"], [user]).map((template) => template.id)).toEqual(["custom-ab12cd34"]);
    expect(resolveTemplatesWithUser(["custom-missing"], [user])).toEqual([]);
    expect(resolveTemplatesWithUser(undefined, [user])).toEqual([]);
  });
});
