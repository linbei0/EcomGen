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

export const LAYER_ELEMENTS_OUTPUT_SCHEMA: StructuredOutputSchema = {
  name: "ecomgen_layer_elements",
  schema: {
    type: "object",
    ...noAdditionalProperties,
    properties: {
      elements: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        items: {
          type: "object",
          ...noAdditionalProperties,
          properties: { name: { type: "string" }, promptEn: { type: "string" } },
          required: ["name", "promptEn"],
        },
      },
    },
    required: ["elements"],
  },
};

const SUITE_PALETTE_COLOR_SCHEMA = {
  type: "object",
  ...noAdditionalProperties,
  properties: { name: { type: "string" }, hex: { type: "string" } },
  required: ["name", "hex"],
} as const;

const SUITE_SHOT_SCHEMA = {
  type: "object",
  ...noAdditionalProperties,
  properties: {
    shotId: { type: "string" },
    order: { type: "integer", minimum: 1 },
    shotRole: { type: "string", enum: ["HERO", "PAIN_POINT", "COMPARISON", "SCENE", "DETAIL", "TRUST", "VARIANT", "CTA"] },
    displayName: { type: "string" },
    intent: { type: "string" },
    assetType: { type: "string" },
    mode: { type: "string", enum: ["CREATIVE", "PIXEL_PROTECTED"] },
    aspectRatio: { type: "string", enum: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] },
    resolution: { type: "string", enum: ["1K", "2K", "4K"] },
    camera: { type: "string" },
    lighting: { type: "string" },
    background: { type: "string" },
    props: { type: "string" },
    productOccupancy: { type: "string" },
    whitespace: { type: "string" },
    textZone: { type: "string" },
    promptTemplate: { type: "string" },
    supportsImageReference: { type: "boolean" },
  },
  required: ["shotId", "order", "shotRole", "displayName", "intent", "assetType", "mode", "aspectRatio", "resolution", "camera", "lighting", "background", "props", "productOccupancy", "whitespace", "textZone", "promptTemplate", "supportsImageReference"],
} as const;

// 套图反推的唯一产出契约：字段与 packages/contracts 的 EcomSuiteFile 对齐，
// strict 模式要求所有字段必填，因此提示词也要求模型逐字段填满。
export const SUITE_FORGE_OUTPUT_SCHEMA: StructuredOutputSchema = {
  name: "ecomgen_suite_forge",
  schema: {
    type: "object",
    ...noAdditionalProperties,
    properties: {
      schemaVersion: { type: "integer", minimum: 1 },
      kind: { type: "string", enum: ["ecomgen.suite"] },
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      category: {
        type: "object",
        ...noAdditionalProperties,
        properties: { l1: { type: "string" }, l2: { type: "string" }, leaf: { type: "string" }, leafKeywords: { type: "array", items: { type: "string" } } },
        required: ["l1", "l2", "leaf", "leafKeywords"],
      },
      productFamily: { type: "string", enum: ["fashion", "electronics", "beauty", "food", "home", "jewelry"] },
      styleLock: {
        type: "object",
        ...noAdditionalProperties,
        properties: {
          direction: { type: "string" },
          palette: { type: "array", items: SUITE_PALETTE_COLOR_SCHEMA },
          temperature: { type: "string" },
          backgroundSystem: { type: "string" },
          lightingSystem: { type: "string" },
          surfaceSystem: { type: "string" },
          typography: { type: "string" },
          iconSystem: { type: "string" },
          presentationRules: { type: "string" },
          noDrift: { type: "array", items: { type: "string" } },
          lockText: { type: "string" },
        },
        required: ["direction", "palette", "temperature", "backgroundSystem", "lightingSystem", "surfaceSystem", "typography", "iconSystem", "presentationRules", "noDrift", "lockText"],
      },
      shots: { type: "array", minItems: 5, maxItems: 12, items: SUITE_SHOT_SCHEMA },
      provenance: {
        type: "object",
        ...noAdditionalProperties,
        properties: { sourceKind: { type: "string" }, sourceImageCount: { type: "integer", minimum: 0 }, detached: { type: "boolean" }, notes: { type: "string" } },
        required: ["sourceKind", "sourceImageCount", "detached", "notes"],
      },
    },
    required: ["schemaVersion", "kind", "id", "name", "description", "category", "productFamily", "styleLock", "shots", "provenance"],
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
