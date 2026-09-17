import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";

/**
 * 由字面量元组派生字符串枚举 schema，枚举值只在元组里维护一份。
 * 生成的 anyOf-of-consts 与 Type.Enum 等价，经 generate-openapi 的 stableSchema
 * 折叠后同样输出 `type: string, enum: [...]`，因此不改变已发布的契约形态。
 */
export function stringEnumSchema<T extends string>(values: readonly T[], id: string) {
  return Type.Union(values.map((value) => Type.Literal(value)), { $id: id });
}

export const PLATFORM_TARGETS = ["TAOBAO", "JD", "PDD", "DOUYIN", "AMAZON", "SHOPIFY"] as const;
export const PlatformTarget = Type.Enum({ TAOBAO: "TAOBAO", JD: "JD", PDD: "PDD", DOUYIN: "DOUYIN", AMAZON: "AMAZON", SHOPIFY: "SHOPIFY" }, { $id: "#/components/schemas/PlatformTarget" });
export const TargetMarket = Type.Enum({ CHINA_MAINLAND: "CHINA_MAINLAND", HONG_KONG: "HONG_KONG", MACAU: "MACAU", TAIWAN: "TAIWAN", UNITED_STATES: "UNITED_STATES", UNITED_KINGDOM: "UNITED_KINGDOM", GERMANY: "GERMANY", FRANCE: "FRANCE", ITALY: "ITALY", SPAIN: "SPAIN", JAPAN: "JAPAN", SOUTH_KOREA: "SOUTH_KOREA" }, { $id: "#/components/schemas/TargetMarket" });
export const StoryboardMode = Type.Enum({ CREATIVE: "CREATIVE", PIXEL_PROTECTED: "PIXEL_PROTECTED" }, { $id: "#/components/schemas/StoryboardMode" });
/** 分镜的视觉任务语义；同一角色在套图中重复时必须使用不同模板，防止信息重复。 */
export const StoryboardShotRole = Type.Enum({ HERO: "HERO", PAIN_POINT: "PAIN_POINT", COMPARISON: "COMPARISON", SCENE: "SCENE", DETAIL: "DETAIL", TRUST: "TRUST", VARIANT: "VARIANT", CTA: "CTA" }, { $id: "#/components/schemas/StoryboardShotRole" });
export const AssetRole = Type.Enum({ PRODUCT_TRUTH: "PRODUCT_TRUTH", PACKAGING: "PACKAGING", STYLE_REFERENCE: "STYLE_REFERENCE", LAYOUT_REFERENCE: "LAYOUT_REFERENCE" }, { $id: "#/components/schemas/AssetRole" });
/** 用户可见入口：产品图。内部仍写入 PRODUCT_TRUTH。 */
export const USER_ASSET_KIND_PRODUCT = "PRODUCT" as const;
/** 用户可见入口：参考图。内部默认写入 STYLE_REFERENCE。 */
export const USER_ASSET_KIND_REFERENCE = "REFERENCE" as const;
export const UserAssetKind = Type.Enum({ PRODUCT: "PRODUCT", REFERENCE: "REFERENCE" }, { $id: "#/components/schemas/UserAssetKind" });
/** 资产库条目的物理来源：项目上传或生成结果。 */
export const LibraryItemSource = Type.Enum({ UPLOADED: "UPLOADED", GENERATED: "GENERATED" }, { $id: "#/components/schemas/LibraryItemSource" });
/** 资产库筛选类别：上传素材按用途分为商品/参考，生成结果单列。 */
export const LibraryItemKind = Type.Enum({ PRODUCT: "PRODUCT", REFERENCE: "REFERENCE", GENERATED: "GENERATED", LAYER: "LAYER" }, { $id: "#/components/schemas/LibraryItemKind" });
export const ImageResolution = Type.Enum({ K1: "1K", K2: "2K", K4: "4K" }, { $id: "#/components/schemas/ImageResolution" });
export const ImageAspectRatio = Type.Enum({ AUTO: "AUTO", SQUARE: "1:1", PORTRAIT_2_3: "2:3", LANDSCAPE_3_2: "3:2", PORTRAIT: "3:4", LANDSCAPE: "4:3", PORTRAIT_4_5: "4:5", LANDSCAPE_5_4: "5:4", PORTRAIT_9_16: "9:16", WIDE: "16:9", ULTRA_WIDE: "21:9" }, { $id: "#/components/schemas/ImageAspectRatio" });
export const PlanningMode = Type.Enum({ AI: "AI", MANUAL: "MANUAL" }, { $id: "#/components/schemas/PlanningMode" });
/** 套图来源：随仓库内置或由用户导入/目录投放。 */
export const EcomSuiteOrigin = Type.Enum({ BUILTIN: "builtin", USER: "user" }, { $id: "#/components/schemas/EcomSuiteOrigin" });
export const CopywritingTarget = Type.Enum({ PRODUCT_DESCRIPTION: "PRODUCT_DESCRIPTION", PLANNING_INSTRUCTION: "PLANNING_INSTRUCTION" }, { $id: "#/components/schemas/CopywritingTarget" });
export const JobType = Type.Enum({ PLAN: "PLAN", COPYWRITE: "COPYWRITE", GENERATE: "GENERATE", EXPORT: "EXPORT", EDIT_PLAN: "EDIT_PLAN", EDIT_GENERATE: "EDIT_GENERATE", LAYER_PLAN: "LAYER_PLAN", LAYER_EXPORT: "LAYER_EXPORT", SUITE_FORGE: "SUITE_FORGE" }, { $id: "#/components/schemas/JobType" });
export const JobStatus = Type.Enum({ QUEUED: "QUEUED", RUNNING: "RUNNING", SUCCEEDED: "SUCCEEDED", FAILED: "FAILED", CANCELLED: "CANCELLED" }, { $id: "#/components/schemas/JobStatus" });
export const ReasoningProtocolProfile = Type.Enum({ OPENAI: "openai", DASHSCOPE_QWEN: "dashscope_qwen", OPENAI_RESPONSES: "openai_responses" }, { $id: "#/components/schemas/ReasoningProtocolProfile" });
export const SearchSourceKind = Type.Enum({ BRAVE: "brave", TAVILY: "tavily", SEARXNG: "searxng" }, { $id: "#/components/schemas/SearchSourceKind" });
/** 编辑操作的合法取值；能力元信息见 edit-operations.ts 的注册表。 */
export const EDIT_OPERATIONS = ["PRECISE_INPAINT", "PRODUCT_REPLACE", "SCENE_ADJUST", "OUTPAINT", "NATURAL_FUSION"] as const;
export const EditOperation = stringEnumSchema(EDIT_OPERATIONS, "#/components/schemas/EditOperation");
/** 编辑执行方式的合法取值；决定合成策略与是否需要人工确认。 */
export const EDIT_EXECUTION_MODES = ["MODEL_DIRECTED", "MASKED", "OUTPAINT", "NEED_INPUT"] as const;
export const EditExecutionMode = stringEnumSchema(EDIT_EXECUTION_MODES, "#/components/schemas/EditExecutionMode");
/** 生成结果的合成策略，由执行方式派生（见 edit-operations.ts）。 */
export const COMPOSITE_POLICIES = ["MASK_LOCKED", "NATURAL_BLEND", "OUTPAINT", "PROVIDER_RESULT"] as const;
export const CompositePolicy = stringEnumSchema(COMPOSITE_POLICIES, "#/components/schemas/CompositePolicy");
export const ReferenceSource = Type.Enum({ PROJECT: "PROJECT", TEMPORARY: "TEMPORARY" }, { $id: "#/components/schemas/ReferenceSource" });
export const ReferencePurpose = Type.Enum({ PRODUCT_APPEARANCE: "PRODUCT_APPEARANCE", PACKAGING: "PACKAGING", LABEL: "LABEL", STYLE: "STYLE", LAYOUT: "LAYOUT" }, { $id: "#/components/schemas/ReferencePurpose" });
export const EditTurnStatus = Type.Enum({ DRAFT: "DRAFT", PLANNING: "PLANNING", PLAN_READY: "PLAN_READY", NEED_INPUT: "NEED_INPUT", AWAITING_CONFIRMATION: "AWAITING_CONFIRMATION", GENERATING: "GENERATING", SUCCEEDED: "SUCCEEDED", FAILED: "FAILED", CANCELLED: "CANCELLED" }, { $id: "#/components/schemas/EditTurnStatus" });
export const EditSessionStatus = Type.Enum({ ACTIVE: "ACTIVE", ARCHIVED: "ARCHIVED" }, { $id: "#/components/schemas/EditSessionStatus" });
export const ErrorCode = Type.Enum({ VALIDATION_ERROR: "VALIDATION_ERROR", NOT_FOUND: "NOT_FOUND", CONFLICT: "CONFLICT", CAPABILITY_UNSUPPORTED: "CAPABILITY_UNSUPPORTED", PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED", RATE_LIMITED: "RATE_LIMITED", INTERNAL_ERROR: "INTERNAL_ERROR", PROVIDER_ERROR: "PROVIDER_ERROR" }, { $id: "#/components/schemas/ErrorCode" });

export type PlatformTarget = Static<typeof PlatformTarget>;
export type TargetMarket = Static<typeof TargetMarket>;
export type StoryboardMode = Static<typeof StoryboardMode>;
export type StoryboardShotRole = Static<typeof StoryboardShotRole>;
export type AssetRole = Static<typeof AssetRole>;
export type UserAssetKind = Static<typeof UserAssetKind>;
export type LibraryItemSource = Static<typeof LibraryItemSource>;
export type LibraryItemKind = Static<typeof LibraryItemKind>;
export type ImageResolution = Static<typeof ImageResolution>;
export type ImageAspectRatio = Static<typeof ImageAspectRatio>;
export type PlanningMode = Static<typeof PlanningMode>;
export type EcomSuiteOrigin = Static<typeof EcomSuiteOrigin>;
export type CopywritingTarget = Static<typeof CopywritingTarget>;
export type JobType = Static<typeof JobType>;
export type JobStatus = Static<typeof JobStatus>;
export type ReasoningProtocolProfile = Static<typeof ReasoningProtocolProfile>;
export type SearchSourceKind = Static<typeof SearchSourceKind>;
export type EditOperation = Static<typeof EditOperation>;
export type EditExecutionMode = Static<typeof EditExecutionMode>;
export type CompositePolicy = Static<typeof CompositePolicy>;
export type ReferenceSource = Static<typeof ReferenceSource>;
export type ReferencePurpose = Static<typeof ReferencePurpose>;
export type EditTurnStatus = Static<typeof EditTurnStatus>;
export type EditSessionStatus = Static<typeof EditSessionStatus>;
export type ErrorCode = Static<typeof ErrorCode>;
