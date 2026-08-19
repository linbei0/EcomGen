import { describe, expect, it } from "vitest";

import { serializeAssetForm } from "./serializeAssetForm";

describe("serializeAssetForm", () => {
  it("写入 kind 与 file，不写 role 或 variantId", () => {
    const file = new File(["img"], "truth.png", { type: "image/png" });
    const form = serializeAssetForm({ file, kind: "PRODUCT" });
    expect(form.get("kind")).toBe("PRODUCT");
    expect(form.get("file")).toBe(file);
    expect(form.get("role")).toBeNull();
    expect(form.get("variantId")).toBeNull();
    expect(Array.from(form.keys())).toEqual(["kind", "file"]);
  });

  it("参考图写入 REFERENCE", () => {
    const file = new File(["img"], "ref.png", { type: "image/png" });
    const form = serializeAssetForm({ file, kind: "REFERENCE" });
    expect(form.get("kind")).toBe("REFERENCE");
  });
});
