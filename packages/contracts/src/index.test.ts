import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { AssetRole, ErrorCode, JobStatus, PlatformTarget, StoryboardMode } from "./index.js";

describe("contracts", () => {
  it("keeps the API's closed enum vocabulary stable", () => {
    expect(Value.Check(PlatformTarget, "DOMESTIC")).toBe(true);
    expect(Value.Check(PlatformTarget, "TIKTOK")).toBe(false);
    expect(Value.Check(StoryboardMode, "PIXEL_PROTECTED")).toBe(true);
    expect(Value.Check(JobStatus, "UNKNOWN")).toBe(false);
    expect(Value.Check(AssetRole, "PRODUCT_TRUTH")).toBe(true);
    expect(Value.Check(ErrorCode, "PROVIDER_ERROR")).toBe(true);
  });
});
