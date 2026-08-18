import { describe, expect, it } from "vitest";

import { serializeAssetForm } from "./serializeAssetForm";

describe("serializeAssetForm", () => {
  it("写入 file 与 role，省略空 variantId", () => {
    const file = new File(["img"], "truth.png", { type: "image/png" });
    const form = serializeAssetForm({ file, role: "PRODUCT_TRUTH" });
    expect(form.get("role")).toBe("PRODUCT_TRUTH");
    expect(form.get("file")).toBe(file);
    expect(form.get("variantId")).toBeNull();
  });

  it("有归属时写入 variantId", () => {
    const file = new File(["img"], "pack.png", { type: "image/png" });
    const form = serializeAssetForm({
      file,
      role: "PACKAGING",
      variantId: "variant-1",
    });
    expect(form.get("role")).toBe("PACKAGING");
    expect(form.get("variantId")).toBe("variant-1");
  });
});
