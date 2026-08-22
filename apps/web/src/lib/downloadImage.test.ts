import { describe, expect, it } from "vitest";

import { outputFileName } from "./downloadImage";

describe("outputFileName", () => {
  it("使用分镜展示名和 storagePath 扩展名", () => {
    expect(outputFileName({ id: "o1", storagePath: "projects/p/outputs/img.webp" }, "白底主图")).toBe("白底主图.webp");
  });

  it("storagePath 缺失或缺扩展名时回退 .png，非法字符替换为空格", () => {
    expect(outputFileName({ id: "o1" }, "场景图")).toBe("场景图.png");
    expect(outputFileName({ id: "o1", storagePath: "outputs/o1" }, "主/图")).toBe("主 图.png");
    expect(outputFileName({ id: "fallback-id", storagePath: null }, "  ")).toBe("fallback-id.png");
  });
});
