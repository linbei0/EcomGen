import { describe, expect, it } from "vitest";

import { ApiError } from "./errors.js";
import { applyModelFields, parseModelRef } from "./projectPatch.js";

describe("parseModelRef", () => {
  it("解析并 trim 合法 ModelRef", () => {
    expect(parseModelRef({ providerId: " p1 ", modelId: " m1 " }, "reasoningModel")).toEqual({
      providerId: "p1",
      modelId: "m1",
    });
  });

  it("拒绝非对象与空字符串", () => {
    expect(() => parseModelRef("x", "reasoningModel")).toThrow(ApiError);
    expect(() => parseModelRef({ providerId: "", modelId: "m" }, "reasoningModel")).toThrow(ApiError);
    expect(() => parseModelRef({ providerId: "p", modelId: 1 }, "imageModel")).toThrow(ApiError);
  });
});

describe("applyModelFields", () => {
  it("写入四个模型字段并按 kind 调 verify", () => {
    const calls: Array<[string, string, "reasoning" | "image"]> = [];
    const update: Record<string, unknown> = {};
    applyModelFields(
      {
        reasoningModel: { providerId: "p1", modelId: "r1" },
        imageModel: { providerId: "p2", modelId: "i1" },
      },
      update,
      (providerId, modelId, kind) => calls.push([providerId, modelId, kind]),
    );
    expect(update).toEqual({
      reasoningProviderId: "p1",
      reasoningModelId: "r1",
      imageProviderId: "p2",
      imageModelId: "i1",
    });
    expect(calls).toEqual([
      ["p1", "r1", "reasoning"],
      ["p2", "i1", "image"],
    ]);
  });

  it("body 未提供模型字段时不动 update", () => {
    const update: Record<string, unknown> = {};
    applyModelFields({ name: "x" }, update, () => undefined);
    expect(update).toEqual({});
  });

  it("verify 抛出的 ApiError 原样传播（如 422 生图能力缺失）", () => {
    const update: Record<string, unknown> = {};
    const failing = () => {
      throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected image model has no image API configured");
    };
    expect(() => applyModelFields({ imageModel: { providerId: "p", modelId: "m" } }, update, failing)).toThrow(
      ApiError,
    );
    expect(update).toEqual({});
  });
});
