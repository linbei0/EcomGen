import { describe, expect, it } from "vitest";
import { CreateGenerationJobInput } from "@ecomgen/contracts";
import { ApiError } from "./errors.js";
import { parseBody } from "./http-input.js";

describe("parseBody", () => {
  it("reports nested and array paths in the public validation shape", () => {
    try {
      parseBody(CreateGenerationJobInput, { storyboardItemIds: ["not-a-uuid"], generationConfig: { imageModel: { providerId: "bad", modelId: "" } } });
      throw new Error("expected validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const validation = error as ApiError;
      expect(validation.code).toBe("VALIDATION_ERROR");
      expect(validation.details.map((detail) => detail.path)).toEqual([
        "body.storyboardItemIds[0]",
        "body.generationConfig.imageModel.providerId",
      ]);
    }
  });

  it("returns the validated static shape for compatible string values", () => {
    const input = parseBody(CreateGenerationJobInput, { storyboardItemIds: ["00000000-0000-4000-8000-000000000000"], generationBatchId: "00000000-0000-4000-8000-000000000001" });
    expect(input.storyboardItemIds).toHaveLength(1);
    expect(input.generationBatchId).toBe("00000000-0000-4000-8000-000000000001");
  });
});
