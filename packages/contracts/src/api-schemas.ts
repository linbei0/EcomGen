import { Type, type Static } from "@sinclair/typebox";
import { AssetRole, CopywritingTarget, EditExecutionMode, EditOperation, EditSessionStatus, EditTurnStatus, ImageAspectRatio, ImageResolution, PlanningMode, ReferencePurpose, ReferenceSource, SearchSourceKind, UserAssetKind } from "./enums.js";
import { schemaRef } from "./ref.js";

// API wire schemas: the single hand-written contract source for OpenAPI generation.

export const Asset = Type.Object({ id: Type.String({ format: "uuid" }), projectId: Type.String({ format: "uuid" }), role: schemaRef(AssetRole), kind: Type.Optional(schemaRef(UserAssetKind)), url: Type.Optional(Type.String()), storagePath: Type.Optional(Type.String()), mimeType: Type.String(), originalName: Type.Optional(Type.String()), hash: Type.Optional(Type.String()), width: Type.Optional(Type.Union([Type.Integer(), Type.Null()])), height: Type.Optional(Type.Union([Type.Integer(), Type.Null()])), createdAt: Type.String({ format: "date-time" }) }, { $id: "#/components/schemas/Asset" });
export type Asset = Static<typeof Asset>;

export const CopywritingResult = Type.Object({ jobId: Type.String({ format: "uuid" }), projectId: Type.String({ format: "uuid" }), target: schemaRef(CopywritingTarget), content: Type.String(), createdAt: Type.String({ format: "date-time" }) }, { $id: "#/components/schemas/CopywritingResult" });
export type CopywritingResult = Static<typeof CopywritingResult>;

export const CreateCopywritingJobInput = Type.Object({ target: schemaRef(CopywritingTarget), regenerationKey: Type.String({ description: "Unique key for an intentional copywriting run.", minLength: 1 }) }, { $id: "#/components/schemas/CreateCopywritingJobInput" });
export type CreateCopywritingJobInput = Static<typeof CreateCopywritingJobInput>;

export const CreateExportJobInput = Type.Object({ outputIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))), filenamePrefix: Type.Optional(Type.String()), platformTargets: Type.Optional(Type.Array(Type.Union([Type.Literal("TAOBAO"), Type.Literal("JD"), Type.Literal("PDD"), Type.Literal("DOUYIN"), Type.Literal("AMAZON"), Type.Literal("SHOPIFY")]))), includeDetailPageSlices: Type.Optional(Type.Boolean({ default: false })) }, { $id: "#/components/schemas/CreateExportJobInput" });
export type CreateExportJobInput = Static<typeof CreateExportJobInput>;

export const CreatePlanningJobInput = Type.Object({ planningMode: Type.Optional(schemaRef(PlanningMode)), requestedTypes: Type.Optional(Type.Array(Type.String())), imageTypes: Type.Optional(Type.Array(Type.String())), userInstruction: Type.Optional(Type.String({ maxLength: 4000 })), candidatesPerType: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })), targetImageCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })), imageResolution: Type.Optional(schemaRef(ImageResolution)), imageAspectRatio: Type.Optional(schemaRef(ImageAspectRatio)), regenerationKey: Type.Optional(Type.String({ description: "Unique key for an intentional re-planning run.", minLength: 1 })) }, { $id: "#/components/schemas/CreatePlanningJobInput" });
export type CreatePlanningJobInput = Static<typeof CreatePlanningJobInput>;

export const CreateProjectInput = Type.Object({ name: Type.String({ minLength: 1 }), category: Type.Optional(Type.Union([Type.String(), Type.Null()])), productDescription: Type.Optional(Type.Union([Type.String(), Type.Null()])), verifiedFacts: Type.Optional(Type.Array(Type.String())), prohibitedClaims: Type.Optional(Type.Array(Type.String())), brandGuidelines: Type.Optional(Type.Record(Type.String(), Type.Unknown())), platformTargets: Type.Optional(Type.Array(Type.Union([Type.Literal("TAOBAO"), Type.Literal("JD"), Type.Literal("PDD"), Type.Literal("DOUYIN"), Type.Literal("AMAZON"), Type.Literal("SHOPIFY")]), { maxItems: 1 })), targetMarket: Type.Optional(Type.Union([Type.Literal("CHINA_MAINLAND"), Type.Literal("HONG_KONG"), Type.Literal("MACAU"), Type.Literal("TAIWAN"), Type.Literal("UNITED_STATES"), Type.Literal("UNITED_KINGDOM"), Type.Literal("GERMANY"), Type.Literal("FRANCE"), Type.Literal("ITALY"), Type.Literal("SPAIN"), Type.Literal("JAPAN"), Type.Literal("SOUTH_KOREA"), Type.Null()])), copyLanguage: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()])), reasoningProviderId: Type.String({ format: "uuid" }), reasoningModelId: Type.String(), imageProviderId: Type.String({ format: "uuid" }), imageModelId: Type.String(), defaultMode: Type.Union([Type.Literal("CREATIVE"), Type.Literal("PIXEL_PROTECTED")]), imageResolution: Type.Optional(schemaRef(ImageResolution)), imageAspectRatio: Type.Optional(schemaRef(ImageAspectRatio)), candidatesPerType: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })), webResearchEnabled: Type.Optional(Type.Boolean({ description: "Enable restricted visual-direction web research during Agent planning." })) }, { $id: "#/components/schemas/CreateProjectInput" });
export type CreateProjectInput = Static<typeof CreateProjectInput>;

export const CreateSearchSourceInput = Type.Object({ name: Type.String({ minLength: 1 }), kind: schemaRef(SearchSourceKind), baseUrl: Type.Optional(Type.String({ format: "uri" })), apiKey: Type.Optional(Type.String({ minLength: 1 })), priority: Type.Integer({ minimum: 0, maximum: 100000 }), enabled: Type.Optional(Type.Boolean({ default: true })) }, { $id: "#/components/schemas/CreateSearchSourceInput" });
export type CreateSearchSourceInput = Static<typeof CreateSearchSourceInput>;

export const EditReferenceAsset = Type.Object({ id: Type.String({ format: "uuid" }), source: schemaRef(ReferenceSource), purpose: schemaRef(ReferencePurpose), role: Type.Optional(Type.Union([schemaRef(AssetRole), Type.Null()])), originalName: Type.String(), mimeType: Type.String(), hash: Type.String(), createdAt: Type.String({ format: "date-time" }), expiresAt: Type.Optional(Type.Union([Type.String({ format: "date-time" }), Type.Null()])), url: Type.String() }, { $id: "#/components/schemas/EditReferenceAsset" });
export type EditReferenceAsset = Static<typeof EditReferenceAsset>;

export const EditSession = Type.Object({ id: Type.String({ format: "uuid" }), projectId: Type.String({ format: "uuid" }), currentOutputId: Type.String({ format: "uuid" }), status: Type.Union([Type.Literal("ACTIVE"), Type.Literal("ARCHIVED")]), memorySummary: Type.Object({ summary: Type.Optional(Type.String()), constraints: Type.Optional(Type.Array(Type.String())), sourceOutputId: Type.Optional(Type.String({ description: "Output node that owns the effective branch memory.", format: "uuid" })) }), createdAt: Type.String({ format: "date-time" }), updatedAt: Type.String({ format: "date-time" }) }, { $id: "#/components/schemas/EditSession" });
export type EditSession = Static<typeof EditSession>;

export const ErrorResponse = Type.Object({ error: Type.Object({ code: Type.String(), message: Type.String(), details: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Unknown()))), requestId: Type.String({ format: "uuid" }) }) }, { $id: "#/components/schemas/ErrorResponse" });
export type ErrorResponse = Static<typeof ErrorResponse>;

export const Export = Type.Object({ id: Type.String({ format: "uuid" }), projectId: Type.String({ format: "uuid" }), jobId: Type.Optional(Type.String({ format: "uuid" })), status: Type.Union([Type.Literal("QUEUED"), Type.Literal("RUNNING"), Type.Literal("SUCCEEDED"), Type.Literal("FAILED")]), storagePath: Type.Optional(Type.Union([Type.String(), Type.Null()])), downloadUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])), createdAt: Type.String({ format: "date-time" }) }, { $id: "#/components/schemas/Export" });
export type Export = Static<typeof Export>;

export const Health = Type.Object({ status: Type.String(), webResearchAvailable: Type.Boolean({ description: "Whether the server has a configured restricted visual-research search key." }) }, { $id: "#/components/schemas/Health" });
export type Health = Static<typeof Health>;

export const Job = Type.Object({ id: Type.String({ format: "uuid" }), type: Type.Union([Type.Literal("PLAN"), Type.Literal("COPYWRITE"), Type.Literal("GENERATE"), Type.Literal("EXPORT"), Type.Literal("EDIT_PLAN"), Type.Literal("EDIT_GENERATE")]), status: Type.Union([Type.Literal("QUEUED"), Type.Literal("RUNNING"), Type.Literal("SUCCEEDED"), Type.Literal("FAILED"), Type.Literal("CANCELLED")]), progress: Type.Integer({ minimum: 0, maximum: 100 }), retryable: Type.Boolean(), requestFingerprint: Type.Optional(Type.Union([Type.String(), Type.Null()])), providerId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()])), modelId: Type.Optional(Type.Union([Type.String(), Type.Null()])), estimatedCost: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])), actualCost: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])), cancelRequested: Type.Optional(Type.Boolean()), error: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])), createdAt: Type.String({ format: "date-time" }), updatedAt: Type.Optional(Type.String({ format: "date-time" })) }, { $id: "#/components/schemas/Job" });
export type Job = Static<typeof Job>;

export const ModelCapability = Type.Object({ id: Type.String(), supportsVision: Type.Boolean(), supportsThinking: Type.Boolean(), supportsTools: Type.Boolean(), supportsStructuredOutput: Type.Boolean(), imageApiKind: Type.Optional(Type.Union([Type.Literal("openai_images"), Type.Literal("gemini"), Type.Literal("custom"), Type.Null()])) }, { $id: "#/components/schemas/ModelCapability" });
export type ModelCapability = Static<typeof ModelCapability>;

export const ModelRef = Type.Object({ providerId: Type.String({ format: "uuid" }), modelId: Type.String() }, { $id: "#/components/schemas/ModelRef" });
export type ModelRef = Static<typeof ModelRef>;

export const Output = Type.Object({ id: Type.String({ format: "uuid" }), storyboardItemId: Type.String({ format: "uuid" }), jobId: Type.String({ format: "uuid" }), candidateIndex: Type.Optional(Type.Integer({ minimum: 1 })), generationSnapshot: Type.Optional(Type.Union([Type.Object({ providerId: Type.Optional(Type.String({ format: "uuid" })), modelId: Type.Optional(Type.String()), resolution: Type.Optional(schemaRef(ImageResolution)), aspectRatio: Type.Optional(schemaRef(ImageAspectRatio)), size: Type.Optional(Type.String()), candidateIndex: Type.Optional(Type.Integer({ minimum: 1 })), revision: Type.Optional(Type.String()) }), Type.Null()])), url: Type.Optional(Type.String()), storagePath: Type.Optional(Type.String()), parentOutputId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()])), rootOutputId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()])), editSessionId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()])), editTurnId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()])), generationBatchId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()])), createdAt: Type.String({ format: "date-time" }) }, { $id: "#/components/schemas/Output" });
export type Output = Static<typeof Output>;

export const PlanningConfigSnapshot = Type.Object({ id: Type.String({ format: "uuid" }), projectId: Type.String({ format: "uuid" }), sourceJobId: Type.String({ format: "uuid" }), payload: Type.Record(Type.String(), Type.Unknown()), createdAt: Type.String({ format: "date-time" }) }, { $id: "#/components/schemas/PlanningConfigSnapshot" });
export type PlanningConfigSnapshot = Static<typeof PlanningConfigSnapshot>;

export const ProjectCover = Type.Object({ productAssetId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]), coverOutputId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]), previewOutputIds: Type.Array(Type.String({ format: "uuid" })), outputCount: Type.Integer({ minimum: 0 }) }, { $id: "#/components/schemas/ProjectCover" });
export type ProjectCover = Static<typeof ProjectCover>;

export const ReferenceSelection = Type.Object({ id: Type.String({ format: "uuid" }), source: schemaRef(ReferenceSource), purpose: schemaRef(ReferencePurpose), order: Type.Integer({ minimum: 0 }) }, { $id: "#/components/schemas/ReferenceSelection" });
export type ReferenceSelection = Static<typeof ReferenceSelection>;

export const SearchSourceConfig = Type.Object({ id: Type.String({ format: "uuid" }), name: Type.String(), kind: schemaRef(SearchSourceKind), baseUrl: Type.String({ format: "uri" }), priority: Type.Integer({ description: "Lower values are searched first.", minimum: 0, maximum: 100000 }), enabled: Type.Boolean(), hasApiKey: Type.Boolean(), createdAt: Type.String({ format: "date-time" }), updatedAt: Type.String({ format: "date-time" }) }, { $id: "#/components/schemas/SearchSourceConfig" });
export type SearchSourceConfig = Static<typeof SearchSourceConfig>;

export const StoryboardItem = Type.Object({ id: Type.String({ format: "uuid" }), assetType: Type.String({ description: "Immutable ecom-details-image template ID; it cannot be changed after planning." }), displayName: Type.String(), templateVariant: Type.Optional(Type.Union([Type.String(), Type.Null()])), candidateCount: Type.Integer({ minimum: 1, maximum: 4 }), imageProviderId: Type.Optional(Type.String({ format: "uuid" })), imageModelId: Type.Optional(Type.String()), imageResolution: Type.Optional(schemaRef(ImageResolution)), imageAspectRatio: Type.Optional(schemaRef(ImageAspectRatio)), referencedAssets: Type.Optional(Type.Array(Type.String({ format: "uuid" }))), mode: Type.Union([Type.Literal("CREATIVE"), Type.Literal("PIXEL_PROTECTED")]), status: Type.Union([Type.Literal("DRAFT"), Type.Literal("CONFIRMED"), Type.Literal("GENERATING"), Type.Literal("GENERATED")]), promptInstruction: Type.String({ description: "Final image-generation prompt produced by Pi Agent. Worker prefixes selected image roles in their actual request order before sending it to the image model." }), factClaims: Type.Optional(Type.Array(Type.String())), riskFlags: Type.Array(Type.String()) }, { $id: "#/components/schemas/StoryboardItem" });
export type StoryboardItem = Static<typeof StoryboardItem>;

export const UpdateSearchSourceInput = Type.Object({ name: Type.Optional(Type.String({ minLength: 1 })), kind: Type.Optional(schemaRef(SearchSourceKind)), baseUrl: Type.Optional(Type.String({ format: "uri" })), apiKey: Type.Optional(Type.String({ minLength: 1 })), priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })), enabled: Type.Optional(Type.Boolean()) }, { $id: "#/components/schemas/UpdateSearchSourceInput" });
export type UpdateSearchSourceInput = Static<typeof UpdateSearchSourceInput>;

export const AssetList = Type.Object({ items: Type.Array(schemaRef(Asset)), nextCursor: Type.Union([Type.String(), Type.Null()]) }, { $id: "#/components/schemas/AssetList" });
export type AssetList = Static<typeof AssetList>;

export const CreateProviderInput = Type.Object({ name: Type.String({ minLength: 1 }), baseUrl: Type.String({ format: "uri" }), reasoningProtocol: Type.Union([Type.Literal("openai"), Type.Literal("dashscope_qwen")]), apiKey: Type.String({ minLength: 1 }), models: Type.Array(schemaRef(ModelCapability), { minItems: 1 }) }, { $id: "#/components/schemas/CreateProviderInput" });
export type CreateProviderInput = Static<typeof CreateProviderInput>;

export const EditTurn = Type.Object({ id: Type.String({ format: "uuid" }), sessionId: Type.String({ format: "uuid" }), projectId: Type.String({ format: "uuid" }), baseOutputId: Type.String({ format: "uuid" }), status: schemaRef(EditTurnStatus), message: Type.String(), annotations: Type.Record(Type.String(), Type.Unknown()), editMaskPath: Type.Optional(Type.Union([Type.String(), Type.Null()])), protectMaskPath: Type.Optional(Type.Union([Type.String(), Type.Null()])), referenceAssetIds: Type.Array(Type.String({ format: "uuid" })), referenceSelections: Type.Array(schemaRef(ReferenceSelection)), plan: Type.Optional(Type.Union([Type.Object({ operation: Type.Optional(Type.Union([Type.Literal("PRECISE_INPAINT"), Type.Literal("PRODUCT_REPLACE"), Type.Literal("SCENE_ADJUST"), Type.Literal("OUTPAINT"), Type.Literal("NATURAL_FUSION")])), executionMode: Type.Optional(schemaRef(EditExecutionMode)), userSummary: Type.Optional(Type.String()), prompt: Type.Optional(Type.String()), targetAnnotationIds: Type.Optional(Type.Array(Type.String())), targetDescription: Type.Optional(Type.String()), targetConfidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })), clarification: Type.Optional(Type.Union([Type.String(), Type.Null()])), requiresConfirmation: Type.Optional(Type.Boolean()), compositePolicy: Type.Optional(Type.Union([Type.Literal("MASK_LOCKED"), Type.Literal("NATURAL_BLEND"), Type.Literal("OUTPAINT"), Type.Literal("PROVIDER_RESULT")])), memoryPatch: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }), Type.Null()])), error: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])), createdAt: Type.String({ format: "date-time" }), updatedAt: Type.String({ format: "date-time" }) }, { $id: "#/components/schemas/EditTurn" });
export type EditTurn = Static<typeof EditTurn>;

export const ExportJobBundle = Type.Object({ job: schemaRef(Job), export: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]) }, { $id: "#/components/schemas/ExportJobBundle" });
export type ExportJobBundle = Static<typeof ExportJobBundle>;

// Provider 可随时删除（生成时才真正使用）：引用它的项目置为 null，进入"待重新选择模型"状态；
// 创建项目时仍必须提供有效的模型对（见 CreateProjectInput）。
export const Project = Type.Object({ id: Type.String({ format: "uuid" }), name: Type.String(), category: Type.Optional(Type.Union([Type.String(), Type.Null()])), productDescription: Type.Optional(Type.Union([Type.String(), Type.Null()])), verifiedFacts: Type.Optional(Type.Array(Type.String())), prohibitedClaims: Type.Optional(Type.Array(Type.String())), brandGuidelines: Type.Optional(Type.Record(Type.String(), Type.Unknown())), platformTargets: Type.Array(Type.Union([Type.Literal("TAOBAO"), Type.Literal("JD"), Type.Literal("PDD"), Type.Literal("DOUYIN"), Type.Literal("AMAZON"), Type.Literal("SHOPIFY")]), { maxItems: 1 }), targetMarket: Type.Union([Type.Literal("CHINA_MAINLAND"), Type.Literal("HONG_KONG"), Type.Literal("MACAU"), Type.Literal("TAIWAN"), Type.Literal("UNITED_STATES"), Type.Literal("UNITED_KINGDOM"), Type.Literal("GERMANY"), Type.Literal("FRANCE"), Type.Literal("ITALY"), Type.Literal("SPAIN"), Type.Literal("JAPAN"), Type.Literal("SOUTH_KOREA"), Type.Null()]), copyLanguage: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]), reasoningProviderId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]), reasoningModelId: Type.Union([Type.String(), Type.Null()]), imageProviderId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]), imageModelId: Type.Union([Type.String(), Type.Null()]), defaultMode: Type.Union([Type.Literal("CREATIVE"), Type.Literal("PIXEL_PROTECTED")]), imageResolution: schemaRef(ImageResolution), imageAspectRatio: schemaRef(ImageAspectRatio), candidatesPerType: Type.Integer({ minimum: 1, maximum: 4 }), webResearchEnabled: Type.Boolean({ description: "Enable restricted visual-direction web research during Agent planning." }), archivedAt: Type.Optional(Type.Union([Type.String({ format: "date-time" }), Type.Null()])), createdAt: Type.String({ format: "date-time" }), updatedAt: Type.String({ format: "date-time" }), cover: Type.Optional(schemaRef(ProjectCover)) }, { $id: "#/components/schemas/Project" });
export type Project = Static<typeof Project>;

export const ProviderConfig = Type.Object({ id: Type.String({ format: "uuid" }), name: Type.String(), baseUrl: Type.String({ format: "uri" }), reasoningProtocol: Type.Union([Type.Literal("openai"), Type.Literal("dashscope_qwen")]), hasApiKey: Type.Boolean(), models: Type.Array(schemaRef(ModelCapability)), createdAt: Type.String({ format: "date-time" }), updatedAt: Type.String({ format: "date-time" }) }, { $id: "#/components/schemas/ProviderConfig" });
export type ProviderConfig = Static<typeof ProviderConfig>;

export const SearchSourceList = Type.Object({ items: Type.Array(schemaRef(SearchSourceConfig)), nextCursor: Type.Union([Type.String(), Type.Null()]) }, { $id: "#/components/schemas/SearchSourceList" });
export type SearchSourceList = Static<typeof SearchSourceList>;

export const Storyboard = Type.Object({ projectId: Type.String({ format: "uuid" }), version: Type.Integer({ minimum: 1 }), status: Type.Union([Type.Literal("DRAFT"), Type.Literal("CONFIRMED")]), campaignStyleLock: Type.String(), items: Type.Optional(Type.Array(schemaRef(StoryboardItem))) }, { $id: "#/components/schemas/Storyboard" });
export type Storyboard = Static<typeof Storyboard>;

export const StoryboardBundle = Type.Object({ storyboard: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]), items: Type.Array(schemaRef(StoryboardItem)) }, { $id: "#/components/schemas/StoryboardBundle" });
export type StoryboardBundle = Static<typeof StoryboardBundle>;

export const UpdateProjectInput = Type.Object({ name: Type.Optional(Type.String({ minLength: 1 })), category: Type.Optional(Type.Union([Type.String(), Type.Null()])), productDescription: Type.Optional(Type.Union([Type.String(), Type.Null()])), verifiedFacts: Type.Optional(Type.Array(Type.String())), prohibitedClaims: Type.Optional(Type.Array(Type.String())), brandGuidelines: Type.Optional(Type.Record(Type.String(), Type.Unknown())), platformTargets: Type.Optional(Type.Array(Type.Union([Type.Literal("TAOBAO"), Type.Literal("JD"), Type.Literal("PDD"), Type.Literal("DOUYIN"), Type.Literal("AMAZON"), Type.Literal("SHOPIFY")]), { maxItems: 1 })), targetMarket: Type.Optional(Type.Union([Type.Literal("CHINA_MAINLAND"), Type.Literal("HONG_KONG"), Type.Literal("MACAU"), Type.Literal("TAIWAN"), Type.Literal("UNITED_STATES"), Type.Literal("UNITED_KINGDOM"), Type.Literal("GERMANY"), Type.Literal("FRANCE"), Type.Literal("ITALY"), Type.Literal("SPAIN"), Type.Literal("JAPAN"), Type.Literal("SOUTH_KOREA"), Type.Null()])), copyLanguage: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()])), reasoningModel: Type.Optional(schemaRef(ModelRef)), imageModel: Type.Optional(schemaRef(ModelRef)), defaultMode: Type.Optional(Type.Union([Type.Literal("CREATIVE"), Type.Literal("PIXEL_PROTECTED")])), imageResolution: Type.Optional(schemaRef(ImageResolution)), imageAspectRatio: Type.Optional(schemaRef(ImageAspectRatio)), candidatesPerType: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })), webResearchEnabled: Type.Optional(Type.Boolean({ description: "Enable restricted visual-direction web research during Agent planning." })), archived: Type.Optional(Type.Boolean({ description: "Archive or restore the project." })) }, { $id: "#/components/schemas/UpdateProjectInput" });
export type UpdateProjectInput = Static<typeof UpdateProjectInput>;

export const UpdateStoryboardItemInput = Type.Object({ assetType: Type.Optional(Type.String({ description: "Immutable ecom-details-image template ID; it cannot be changed after planning." })), displayName: Type.Optional(Type.String()), templateVariant: Type.Optional(Type.Union([Type.String(), Type.Null()])), candidateCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })), imageModel: Type.Optional(schemaRef(ModelRef)), imageResolution: Type.Optional(schemaRef(ImageResolution)), imageAspectRatio: Type.Optional(schemaRef(ImageAspectRatio)), referencedAssets: Type.Optional(Type.Array(Type.String({ format: "uuid" }))), mode: Type.Optional(Type.Union([Type.Literal("CREATIVE"), Type.Literal("PIXEL_PROTECTED")])), promptInstruction: Type.Optional(Type.String({ description: "Editable final image-generation prompt. Worker prefixes selected image roles in their actual request order before sending it to the image model.", maxLength: 4000 })) }, { $id: "#/components/schemas/UpdateStoryboardItemInput" });
export type UpdateStoryboardItemInput = Static<typeof UpdateStoryboardItemInput>;

export const ProjectDetail = Type.Intersect([schemaRef(Project), Type.Object({ assets: Type.Array(schemaRef(Asset)), storyboard: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]), items: Type.Array(schemaRef(StoryboardItem)), outputs: Type.Array(schemaRef(Output)), jobs: Type.Array(schemaRef(Job)) })], { $id: "#/components/schemas/ProjectDetail" });
export type ProjectDetail = Static<typeof ProjectDetail>;

export const ProjectList = Type.Object({ items: Type.Array(Type.Intersect([schemaRef(Project), Type.Record(Type.String(), Type.Unknown())])), nextCursor: Type.Union([Type.String(), Type.Null()]) }, { $id: "#/components/schemas/ProjectList" });
export type ProjectList = Static<typeof ProjectList>;

export const ProviderList = Type.Object({ items: Type.Array(schemaRef(ProviderConfig)), nextCursor: Type.Union([Type.String(), Type.Null()]) }, { $id: "#/components/schemas/ProviderList" });
export type ProviderList = Static<typeof ProviderList>;

// 更新为部分语义：省略的字段保留原值；apiKey 留空（省略）表示不更换密钥，避免仅改配置也必须重输密钥。
export const UpdateProviderInput = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1 })),
    baseUrl: Type.Optional(Type.String({ format: "uri" })),
    reasoningProtocol: Type.Optional(
      Type.Union([Type.Literal("openai"), Type.Literal("dashscope_qwen")]),
    ),
    apiKey: Type.Optional(Type.String({ minLength: 1 })),
    models: Type.Optional(
      Type.Array(schemaRef(ModelCapability), { minItems: 1 }),
    ),
  },
  { $id: "#/components/schemas/UpdateProviderInput" },
);
export type UpdateProviderInput = Static<typeof UpdateProviderInput>;
