import type { Model } from "@earendil-works/pi-ai";

export interface StructuredOutputSchema {
  name: string;
  schema: Record<string, unknown>;
}

const noAdditionalProperties = { additionalProperties: false } as const;

export const STORYBOARD_OUTPUT_SCHEMA: StructuredOutputSchema = {
  name: "ecomgen_storyboard",
  schema: {
    type: "object",
    ...noAdditionalProperties,
    properties: {
      campaignStyleLock: { type: "string" },
      items: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          ...noAdditionalProperties,
          properties: {
            assetType: { type: "string" },
            displayName: { type: "string" },
            shotRole: { type: "string", enum: ["HERO", "PAIN_POINT", "COMPARISON", "SCENE", "DETAIL", "TRUST", "VARIANT", "CTA"] },
            templateVariant: { anyOf: [{ type: "string" }, { type: "null" }] },
            candidateCount: { type: "integer", minimum: 1 },
            referencedAssets: { type: "array", items: { type: "string" } },
            mode: { type: "string", enum: ["CREATIVE", "PIXEL_PROTECTED"] },
            promptInstruction: { type: "string" },
            factClaims: { type: "array", items: { type: "string" } },
            riskFlags: { type: "array", items: { type: "string" } },
            sortOrder: { type: "integer", minimum: 0 },
          },
          required: ["assetType", "displayName", "shotRole", "templateVariant", "candidateCount", "referencedAssets", "mode", "promptInstruction", "factClaims", "riskFlags", "sortOrder"],
        },
      },
    },
    required: ["campaignStyleLock", "items"],
  },
};

export const COPYWRITING_DESCRIPTION_SCHEMA: StructuredOutputSchema = {
  name: "ecomgen_product_description",
  schema: {
    type: "object",
    ...noAdditionalProperties,
    properties: {
      productName: { type: "string" },
      coreSellingPoints: { type: "array", minItems: 1, items: { type: "string" } },
      suitableAudience: { type: "string" },
      expectedScenarios: { type: "string" },
    },
    required: ["productName", "coreSellingPoints", "suitableAudience", "expectedScenarios"],
  },
};

export const COPYWRITING_INSTRUCTION_SCHEMA: StructuredOutputSchema = {
  name: "ecomgen_planning_instruction",
  schema: {
    type: "object",
    ...noAdditionalProperties,
    properties: { content: { type: "string" } },
    required: ["content"],
  },
};

export const EDIT_PLAN_OUTPUT_SCHEMA: StructuredOutputSchema = {
  name: "ecomgen_edit_plan",
  schema: {
    type: "object",
    ...noAdditionalProperties,
    properties: {
      operation: { type: "string", enum: ["PRECISE_INPAINT", "PRODUCT_REPLACE", "SCENE_ADJUST", "OUTPAINT", "NATURAL_FUSION"] },
      executionMode: { type: "string", enum: ["MODEL_DIRECTED", "MASKED", "OUTPAINT", "NEED_INPUT"] },
      userSummary: { type: "string" },
      prompt: { type: "string" },
      targetAnnotationIds: { type: "array", items: { type: "string" } },
      targetDescription: { type: "string" },
      targetConfidence: { type: "number", minimum: 0, maximum: 1 },
      clarification: { anyOf: [{ type: "string" }, { type: "null" }] },
      requiresConfirmation: { type: "boolean" },
      compositePolicy: { type: "string", enum: ["MASK_LOCKED", "NATURAL_BLEND", "OUTPAINT", "PROVIDER_RESULT"] },
      memoryPatch: {
        type: "object",
        ...noAdditionalProperties,
        properties: { summary: { anyOf: [{ type: "string" }, { type: "null" }] }, constraints: { type: "array", items: { type: "string" } } },
        required: ["summary", "constraints"],
      },
    },
    required: ["operation", "executionMode", "userSummary", "prompt", "targetAnnotationIds", "targetDescription", "targetConfidence", "clarification", "requiresConfirmation", "compositePolicy", "memoryPatch"],
  },
};

export const PROMPT_REVISION_SCHEMA: StructuredOutputSchema = {
  name: "ecomgen_prompt_revision",
  schema: {
    type: "object",
    ...noAdditionalProperties,
    properties: { prompt: { type: "string" } },
    required: ["prompt"],
  },
};

/** Provider capability is carried on the model by the EcomGen reasoning adapter. */
export function modelSupportsStructuredOutput(model: Model<"openai-completions" | "openai-responses">): boolean {
  return (model as Model<"openai-completions" | "openai-responses"> & { ecomgenSupportsStructuredOutput?: boolean }).ecomgenSupportsStructuredOutput === true;
}

export function withStructuredOutput(
  payload: unknown,
  model: Model<"openai-completions" | "openai-responses">,
  output: StructuredOutputSchema,
): unknown {
  if (!modelSupportsStructuredOutput(model) || !payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (model.api === "openai-responses") {
    return { ...(payload as Record<string, unknown>), text: { format: { type: "json_schema", name: output.name, schema: output.schema, strict: true } } };
  }
  return { ...(payload as Record<string, unknown>), response_format: { type: "json_schema", json_schema: { name: output.name, schema: output.schema, strict: true } } };
}
