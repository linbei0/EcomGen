import { describe, expect, it } from "vitest";
import { API_SCHEMA_REGISTRY, ImageResolution, resolveImageSize, schemaRef } from "./index.js";

describe("contracts", () => {
  it("maps project-level aspect ratios to the OpenAI-compatible size family", () => {
    expect(resolveImageSize("1K", "AUTO", "1024x1536")).toBe("1024x1536");
    expect(resolveImageSize("2K", "1:1", "1024x1536")).toBe("1024x1024");
    expect(resolveImageSize("4K", "3:4", "1024x1024")).toBe("1024x1536");
    expect(resolveImageSize("1K", "9:16", "1024x1024")).toBe("1024x1536");
    expect(resolveImageSize("1K", "21:9", "1024x1024")).toBe("1536x1024");
    expect(resolveImageSize("1K", "4:5", "1024x1024")).toBe("1024x1536");
    expect(resolveImageSize("1K", "5:4", "1024x1024")).toBe("1536x1024");
  });

  it("keeps every registered API schema serializable with a unique component id", () => {
    const ids = Object.values(API_SCHEMA_REGISTRY).map((schema) => schema.$id);
    expect(ids.every((id) => typeof id === "string" && id.startsWith("#/components/schemas/"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => JSON.stringify(API_SCHEMA_REGISTRY)).not.toThrow();
  });

  it("creates string-based refs without the deprecated schema overload", () => {
    expect(schemaRef(ImageResolution).$ref).toBe("#/components/schemas/ImageResolution");
  });
});
