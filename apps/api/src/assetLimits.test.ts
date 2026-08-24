import { describe, expect, it } from "vitest";
import { assertProjectAssetCapacity, assertProjectAssetHashUnique } from "./app.js";

function repository(roles: string[], hashes: string[] = []) {
  return {
    listAssets: () => roles.map((role, index) => ({ id: `${index}`, role, mimeType: "image/png", hash: hashes[index] ?? `${index}` })),
  };
}

describe("project asset limits", () => {
  it("rejects a seventh product or reference image", () => {
    expect(() => assertProjectAssetCapacity(repository(Array(6).fill("PRODUCT_TRUTH")) as never, "project", "PRODUCT_TRUTH")).toThrow("最多上传 6 张商品图");
    expect(() => assertProjectAssetCapacity(repository(Array(6).fill("STYLE_REFERENCE")) as never, "project", "STYLE_REFERENCE")).toThrow("最多上传 6 张参考图");
  });

  it("keeps the two image categories independently bounded", () => {
    expect(() => assertProjectAssetCapacity(repository([...Array(6).fill("PRODUCT_TRUTH"), ...Array(5).fill("STYLE_REFERENCE")]) as never, "project", "STYLE_REFERENCE")).not.toThrow();
  });

  it("rejects identical asset content regardless of its upload name or role", () => {
    expect(() => assertProjectAssetHashUnique(repository(["PRODUCT_TRUTH"], ["same-content"]) as never, "project", "same-content")).toThrow("相同图片已上传到项目");
    expect(() => assertProjectAssetHashUnique(repository(["PRODUCT_TRUTH"], ["other-content"]) as never, "project", "same-content")).not.toThrow();
  });
});
