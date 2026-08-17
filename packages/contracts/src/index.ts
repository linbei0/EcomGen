import { Static, Type } from "@sinclair/typebox";

export const PlatformTarget = Type.Enum({ DOMESTIC: "DOMESTIC", AMAZON: "AMAZON" });
export const StoryboardMode = Type.Enum({ CREATIVE: "CREATIVE", PIXEL_PROTECTED: "PIXEL_PROTECTED" });
export const AssetRole = Type.Enum({
  PRODUCT_TRUTH: "PRODUCT_TRUTH",
  PACKAGING: "PACKAGING",
  STYLE_REFERENCE: "STYLE_REFERENCE",
  LAYOUT_REFERENCE: "LAYOUT_REFERENCE"
});
export const JobType = Type.Enum({ PLAN: "PLAN", GENERATE: "GENERATE", EXPORT: "EXPORT" });
export const JobStatus = Type.Enum({
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED"
});
export const OutputReviewDecision = Type.Enum({
  SELECTED: "SELECTED",
  REJECTED: "REJECTED",
  NEEDS_REVIEW: "NEEDS_REVIEW"
});
export const ErrorCode = Type.Enum({
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  CAPABILITY_UNSUPPORTED: "CAPABILITY_UNSUPPORTED",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  PROVIDER_ERROR: "PROVIDER_ERROR"
});

export const ModelCapabilities = Type.Object({
  supportsVision: Type.Boolean(),
  supportsTools: Type.Boolean(),
  supportsStructuredOutput: Type.Boolean(),
  imageApiKind: Type.Union([Type.Literal("openai_images"), Type.Literal("custom"), Type.Null()])
});

export const ModelDefinition = Type.Intersect([
  Type.Object({ id: Type.String({ minLength: 1 }) }),
  ModelCapabilities
]);

export const ModelRef = Type.Object({
  providerId: Type.String({ format: "uuid" }),
  modelId: Type.String({ minLength: 1 })
});

export const ErrorResponse = Type.Object({
  error: Type.Object({
    code: ErrorCode,
    message: Type.String(),
    details: Type.Array(Type.Object({ path: Type.String(), reason: Type.String() })),
    requestId: Type.String({ format: "uuid" })
  })
});

export const EventEnvelope = Type.Object({
  id: Type.String({ format: "uuid" }),
  type: Type.Union([
    Type.Literal("job.updated"),
    Type.Literal("storyboard.updated"),
    Type.Literal("output.created"),
    Type.Literal("export.updated"),
    Type.Literal("provider.updated")
  ]),
  projectId: Type.String({ format: "uuid" }),
  occurredAt: Type.String({ format: "date-time" }),
  data: Type.Unknown()
});

export type PlatformTarget = Static<typeof PlatformTarget>;
export type StoryboardMode = Static<typeof StoryboardMode>;
export type AssetRole = Static<typeof AssetRole>;
export type JobType = Static<typeof JobType>;
export type JobStatus = Static<typeof JobStatus>;
export type OutputReviewDecision = Static<typeof OutputReviewDecision>;
export type ModelCapabilities = Static<typeof ModelCapabilities>;
export type ModelDefinition = Static<typeof ModelDefinition>;
export type ModelRef = Static<typeof ModelRef>;
export type EventEnvelope = Static<typeof EventEnvelope>;
