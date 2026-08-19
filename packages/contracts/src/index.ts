import { Static, Type } from "@sinclair/typebox";

export const PlatformTarget = Type.Enum({ DOMESTIC: "DOMESTIC", AMAZON: "AMAZON" });
export const StoryboardMode = Type.Enum({ CREATIVE: "CREATIVE", PIXEL_PROTECTED: "PIXEL_PROTECTED" });
export const AssetRole = Type.Enum({
  PRODUCT_TRUTH: "PRODUCT_TRUTH",
  PACKAGING: "PACKAGING",
  STYLE_REFERENCE: "STYLE_REFERENCE",
  LAYOUT_REFERENCE: "LAYOUT_REFERENCE"
});
/** 用户可见入口：产品图。内部仍写入 PRODUCT_TRUTH。 */
export const USER_ASSET_KIND_PRODUCT = "PRODUCT" as const;
/** 用户可见入口：参考图。内部默认写入 STYLE_REFERENCE。 */
export const USER_ASSET_KIND_REFERENCE = "REFERENCE" as const;
export const UserAssetKind = Type.Enum({ PRODUCT: "PRODUCT", REFERENCE: "REFERENCE" });
export const ImageResolution = Type.Enum({ K1: "1K", K2: "2K", K4: "4K" });
export const ImageAspectRatio = Type.Enum({
  AUTO: "AUTO",
  SQUARE: "1:1",
  PORTRAIT: "3:4",
  LANDSCAPE: "4:3",
  WIDE: "16:9"
});
export const PlanningMode = Type.Enum({ AI: "AI", MANUAL: "MANUAL" });
export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export const IMAGE_ASPECT_RATIOS = ["AUTO", "1:1", "3:4", "4:3", "16:9"] as const;
export const MAX_CANDIDATES_PER_TYPE = 4;
export const DEFAULT_IMAGE_RESOLUTION = "1K" as const;
export const DEFAULT_IMAGE_ASPECT_RATIO = "AUTO" as const;
export const DEFAULT_CANDIDATES_PER_TYPE = 1;

/**
 * 项目级允许值映射到当前 OpenAI-compatible Images 尺寸。
 * 2K/4K 仍走 1024 家族，避免按模型名猜测更大尺寸。
 */
export function resolveImageSize(
  resolution: Static<typeof ImageResolution>,
  aspectRatio: Static<typeof ImageAspectRatio>,
  templateDefault: string
): string {
  void resolution;
  if (aspectRatio === "1:1") return "1024x1024";
  if (aspectRatio === "3:4") return "1024x1536";
  if (aspectRatio === "4:3" || aspectRatio === "16:9") return "1536x1024";
  return templateDefault;
}

export function userAssetKindForRole(role: Static<typeof AssetRole>): Static<typeof UserAssetKind> {
  return role === "PRODUCT_TRUTH" ? "PRODUCT" : "REFERENCE";
}

export function roleForUserAssetKind(kind: Static<typeof UserAssetKind>): Static<typeof AssetRole> {
  return kind === "PRODUCT" ? "PRODUCT_TRUTH" : "STYLE_REFERENCE";
}

export const JobType = Type.Enum({ PLAN: "PLAN", GENERATE: "GENERATE", EXPORT: "EXPORT" });
export const JobStatus = Type.Enum({
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED"
});
export const ReasoningProtocolProfile = Type.Enum({ OPENAI: "openai", DASHSCOPE_QWEN: "dashscope_qwen" });
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
  supportsThinking: Type.Boolean(),
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
export type UserAssetKind = Static<typeof UserAssetKind>;
export type ImageResolution = Static<typeof ImageResolution>;
export type ImageAspectRatio = Static<typeof ImageAspectRatio>;
export type PlanningMode = Static<typeof PlanningMode>;
export type JobType = Static<typeof JobType>;
export type JobStatus = Static<typeof JobStatus>;
export type ReasoningProtocolProfile = Static<typeof ReasoningProtocolProfile>;
export type OutputReviewDecision = Static<typeof OutputReviewDecision>;
export type ModelCapabilities = Static<typeof ModelCapabilities>;
export type ModelDefinition = Static<typeof ModelDefinition>;
export type ModelRef = Static<typeof ModelRef>;
export type EventEnvelope = Static<typeof EventEnvelope>;
