import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { AssetRole, ErrorCode, JobStatus, PlatformTarget, resolveImageSize, StoryboardMode, UserAssetKind } from "./index.js";

describe("contracts", () => {
  it("keeps the API's closed enum vocabulary stable", () => {
    expect(Value.Check(PlatformTarget, "TAOBAO")).toBe(true);
    expect(Value.Check(PlatformTarget, "DOUYIN")).toBe(true);
    expect(Value.Check(PlatformTarget, "DOMESTIC")).toBe(false);
    expect(Value.Check(PlatformTarget, "TIKTOK")).toBe(false);
    expect(Value.Check(StoryboardMode, "PIXEL_PROTECTED")).toBe(true);
    expect(Value.Check(JobStatus, "UNKNOWN")).toBe(false);
    expect(Value.Check(AssetRole, "PRODUCT_TRUTH")).toBe(true);
    expect(Value.Check(UserAssetKind, "REFERENCE")).toBe(true);
    expect(Value.Check(ErrorCode, "PROVIDER_ERROR")).toBe(true);
  });

  it("maps project-level aspect ratios to the OpenAI-compatible size family", () => {
    expect(resolveImageSize("1K", "AUTO", "1024x1536")).toBe("1024x1536");
    expect(resolveImageSize("2K", "1:1", "1024x1536")).toBe("1024x1024");
    expect(resolveImageSize("4K", "3:4", "1024x1024")).toBe("1024x1536");
  });
});
