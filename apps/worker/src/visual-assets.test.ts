import { describe, expect, it } from "vitest";
import { selectGenerationAssets, selectVisionAssets } from "./visual-assets.js";

function asset(id: string, role: string, createdAt: string) {
  return { id, role, mimeType: "image/png", createdAt };
}

describe("visual asset selection", () => {
  it("selects at most six product and six reference images in stable order", () => {
    const assets = [
      ...Array.from({ length: 7 }, (_, index) => asset(`product-${index + 1}`, "PRODUCT_TRUTH", `2026-01-01T00:00:0${index}Z`)),
      ...Array.from({ length: 7 }, (_, index) => asset(`reference-${index + 1}`, "STYLE_REFERENCE", `2026-01-02T00:00:0${index}Z`)),
    ];
    expect(selectVisionAssets(assets).map((item) => item.id)).toEqual([
      "product-1", "product-2", "product-3", "product-4", "product-5", "product-6",
      "reference-1", "reference-2", "reference-3", "reference-4", "reference-5", "reference-6",
    ]);
  });

  it("uses only storyboard references for creative generation and caps non-product references", () => {
    const assets = [asset("product-1", "PRODUCT_TRUTH", "2026-01-01"), ...Array.from({ length: 5 }, (_, index) => asset(`reference-${index + 1}`, "STYLE_REFERENCE", `2026-01-0${index + 2}`))];
    expect(selectGenerationAssets(assets, { mode: "CREATIVE", referencedAssets: ["product-1", "reference-1", "reference-2", "reference-3", "reference-4", "reference-5"] }).map((item) => item.id)).toEqual([
      "product-1", "reference-1", "reference-2", "reference-3", "reference-4",
    ]);
  });

  it("keeps all product truth images for pixel-protected generation", () => {
    const assets = [asset("product-1", "PRODUCT_TRUTH", "2026-01-01"), asset("product-2", "PRODUCT_TRUTH", "2026-01-02"), asset("style", "STYLE_REFERENCE", "2026-01-03")];
    expect(selectGenerationAssets(assets, { mode: "PIXEL_PROTECTED", referencedAssets: ["style"] }).map((item) => item.id)).toEqual(["product-1", "product-2", "style"]);
  });
});
