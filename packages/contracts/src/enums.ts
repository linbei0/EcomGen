import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";

export const PLATFORM_TARGETS = ["TAOBAO", "JD", "PDD", "DOUYIN", "AMAZON", "SHOPIFY"] as const;
export const PlatformTarget = Type.Enum({ TAOBAO: "TAOBAO", JD: "JD", PDD: "PDD", DOUYIN: "DOUYIN", AMAZON: "AMAZON", SHOPIFY: "SHOPIFY" }, { $id: "#/components/schemas/PlatformTarget" });
export const TargetMarket = Type.Enum({ CHINA_MAINLAND: "CHINA_MAINLAND", HONG_KONG: "HONG_KONG", MACAU: "MACAU", TAIWAN: "TAIWAN", UNITED_STATES: "UNITED_STATES", UNITED_KINGDOM: "UNITED_KINGDOM", GERMANY: "GERMANY", FRANCE: "FRANCE", ITALY: "ITALY", SPAIN: "SPAIN", JAPAN: "JAPAN", SOUTH_KOREA: "SOUTH_KOREA" }, { $id: "#/components/schemas/TargetMarket" });
export const StoryboardMode = Type.Enum({ CREATIVE: "CREATIVE", PIXEL_PROTECTED: "PIXEL_PROTECTED" }, { $id: "#/components/schemas/StoryboardMode" });
export const AssetRole = Type.Enum({ PRODUCT_TRUTH: "PRODUCT_TRUTH", PACKAGING: "PACKAGING", STYLE_REFERENCE: "STYLE_REFERENCE", LAYOUT_REFERENCE: "LAYOUT_REFERENCE" }, { $id: "#/components/schemas/AssetRole" });
/** 用户可见入口：产品图。内部仍写入 PRODUCT_TRUTH。 */
export const USER_ASSET_KIND_PRODUCT = "PRODUCT" as const;
/** 用户可见入口：参考图。内部默认写入 STYLE_REFERENCE。 */
export const USER_ASSET_KIND_REFERENCE = "REFERENCE" as const;
export const UserAssetKind = Type.Enum({ PRODUCT: "PRODUCT", REFERENCE: "REFERENCE" }, { $id: "#/components/schemas/UserAssetKind" });
export const ImageResolution = Type.Enum({ K1: "1K", K2: "2K", K4: "4K" }, { $id: "#/components/schemas/ImageResolution" });
export const ImageAspectRatio = Type.Enum({ AUTO: "AUTO", SQUARE: "1:1", PORTRAIT: "3:4", LANDSCAPE: "4:3", WIDE: "16:9" }, { $id: "#/components/schemas/ImageAspectRatio" });
export const PlanningMode = Type.Enum({ AI: "AI", MANUAL: "MANUAL" }, { $id: "#/components/schemas/PlanningMode" });
export const CopywritingTarget = Type.Enum({ PRODUCT_DESCRIPTION: "PRODUCT_DESCRIPTION", PLANNING_INSTRUCTION: "PLANNING_INSTRUCTION" }, { $id: "#/components/schemas/CopywritingTarget" });
export const JobType = Type.Enum({ PLAN: "PLAN", COPYWRITE: "COPYWRITE", GENERATE: "GENERATE", EXPORT: "EXPORT", EDIT_PLAN: "EDIT_PLAN", EDIT_GENERATE: "EDIT_GENERATE" }, { $id: "#/components/schemas/JobType" });
export const JobStatus = Type.Enum({ QUEUED: "QUEUED", RUNNING: "RUNNING", SUCCEEDED: "SUCCEEDED", FAILED: "FAILED", CANCELLED: "CANCELLED" }, { $id: "#/components/schemas/JobStatus" });
export const ReasoningProtocolProfile = Type.Enum({ OPENAI: "openai", DASHSCOPE_QWEN: "dashscope_qwen", OPENAI_RESPONSES: "openai_responses" }, { $id: "#/components/schemas/ReasoningProtocolProfile" });
export const SearchSourceKind = Type.Enum({ BRAVE: "brave", TAVILY: "tavily", SEARXNG: "searxng" }, { $id: "#/components/schemas/SearchSourceKind" });
export const EditOperation = Type.Enum({ PRECISE_INPAINT: "PRECISE_INPAINT", PRODUCT_REPLACE: "PRODUCT_REPLACE", SCENE_ADJUST: "SCENE_ADJUST", OUTPAINT: "OUTPAINT", NATURAL_FUSION: "NATURAL_FUSION" }, { $id: "#/components/schemas/EditOperation" });
export const EditExecutionMode = Type.Enum({ MODEL_DIRECTED: "MODEL_DIRECTED", MASKED: "MASKED", OUTPAINT: "OUTPAINT", NEED_INPUT: "NEED_INPUT" }, { $id: "#/components/schemas/EditExecutionMode" });
export const ReferenceSource = Type.Enum({ PROJECT: "PROJECT", TEMPORARY: "TEMPORARY" }, { $id: "#/components/schemas/ReferenceSource" });
export const ReferencePurpose = Type.Enum({ PRODUCT_APPEARANCE: "PRODUCT_APPEARANCE", PACKAGING: "PACKAGING", LABEL: "LABEL", STYLE: "STYLE", LAYOUT: "LAYOUT" }, { $id: "#/components/schemas/ReferencePurpose" });
export const EditTurnStatus = Type.Enum({ DRAFT: "DRAFT", PLANNING: "PLANNING", PLAN_READY: "PLAN_READY", NEED_INPUT: "NEED_INPUT", AWAITING_CONFIRMATION: "AWAITING_CONFIRMATION", GENERATING: "GENERATING", SUCCEEDED: "SUCCEEDED", FAILED: "FAILED", CANCELLED: "CANCELLED" }, { $id: "#/components/schemas/EditTurnStatus" });
export const EditSessionStatus = Type.Enum({ ACTIVE: "ACTIVE", ARCHIVED: "ARCHIVED" }, { $id: "#/components/schemas/EditSessionStatus" });
export const ErrorCode = Type.Enum({ VALIDATION_ERROR: "VALIDATION_ERROR", NOT_FOUND: "NOT_FOUND", CONFLICT: "CONFLICT", CAPABILITY_UNSUPPORTED: "CAPABILITY_UNSUPPORTED", PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED", RATE_LIMITED: "RATE_LIMITED", INTERNAL_ERROR: "INTERNAL_ERROR", PROVIDER_ERROR: "PROVIDER_ERROR" }, { $id: "#/components/schemas/ErrorCode" });

export type PlatformTarget = Static<typeof PlatformTarget>;
export type TargetMarket = Static<typeof TargetMarket>;
export type StoryboardMode = Static<typeof StoryboardMode>;
export type AssetRole = Static<typeof AssetRole>;
export type UserAssetKind = Static<typeof UserAssetKind>;
export type ImageResolution = Static<typeof ImageResolution>;
export type ImageAspectRatio = Static<typeof ImageAspectRatio>;
export type PlanningMode = Static<typeof PlanningMode>;
export type CopywritingTarget = Static<typeof CopywritingTarget>;
export type JobType = Static<typeof JobType>;
export type JobStatus = Static<typeof JobStatus>;
export type ReasoningProtocolProfile = Static<typeof ReasoningProtocolProfile>;
export type SearchSourceKind = Static<typeof SearchSourceKind>;
export type EditOperation = Static<typeof EditOperation>;
export type EditExecutionMode = Static<typeof EditExecutionMode>;
export type ReferenceSource = Static<typeof ReferenceSource>;
export type ReferencePurpose = Static<typeof ReferencePurpose>;
export type EditTurnStatus = Static<typeof EditTurnStatus>;
export type EditSessionStatus = Static<typeof EditSessionStatus>;
export type ErrorCode = Static<typeof ErrorCode>;
