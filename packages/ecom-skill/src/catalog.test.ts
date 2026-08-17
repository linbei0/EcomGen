import { describe, expect, it } from "vitest";
import { ECOM_TEMPLATES, resolveTemplates, templatePromptContract } from "./catalog.js";

describe("ecom-details-image catalog adaptation", () => {
  it("keeps all 25 upstream templates addressable by stable IDs", () => {
    expect(ECOM_TEMPLATES).toHaveLength(25);
    expect(resolveTemplates(["主图", "detail-macro", "直播"]).map((template) => template.id)).toEqual(["hero-image", "detail-macro", "livestream"]);
  });

  it("compiles domestic marketplace reservations into the template contract", () => {
    const hero = ECOM_TEMPLATES[0];
    expect(templatePromptContract(hero, ["DOMESTIC"])).toContain("200x100 price-overlay zone");
    expect(templatePromptContract(hero, ["AMAZON"])).not.toContain("price-overlay zone");
  });
});
