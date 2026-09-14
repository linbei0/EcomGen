import { Type, type Static } from "@sinclair/typebox";
import { AssetRole, EditTurnStatus, ImageAspectRatio, ImageResolution, PlanningMode, PlatformTarget, ReferencePurpose, UserAssetKind } from "./enums.js";
import { EcomSuiteFile, EditReferenceAsset, EditTurn, Job, LayerBbox, ModelRef, PlanningConfigSnapshot, Project, ReferenceSelection } from "./api-schemas.js";
import { schemaRef } from "./ref.js";

export const TestProviderInput = Type.Object({ modelId: Type.String({ minLength: 1 }), kind: Type.Optional(Type.Union([Type.Literal("reasoning"), Type.Literal("image"), Type.Literal("segmentation")], { description: "segmentation probes the declared segmentation API with zero cost." })) }, { $id: "#/components/schemas/TestProviderInput" });
export type TestProviderInput = Static<typeof TestProviderInput>;

export const CreateGenerationJobInput = Type.Object({
  storyboardItemIds: Type.Array(Type.String({ format: "uuid" }), { minItems: 1 }),
  generationBatchId: Type.Optional(Type.String({ format: "uuid" })),
  revision: Type.Optional(Type.String()),
  generationConfig: Type.Optional(Type.Object({
    imageResolution: Type.Optional(schemaRef(ImageResolution)),
    imageAspectRatio: Type.Optional(schemaRef(ImageAspectRatio)),
    candidateCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })),
    imageModel: Type.Optional(schemaRef(ModelRef)),
  })),
}, { $id: "#/components/schemas/CreateGenerationJobInput" });
export type CreateGenerationJobInput = Static<typeof CreateGenerationJobInput>;

export const UpdateEditSessionMemoryInput = Type.Object({ outputId: Type.Optional(Type.String({ format: "uuid" })), summary: Type.String(), constraints: Type.Array(Type.String()) }, { $id: "#/components/schemas/UpdateEditSessionMemoryInput" });
export type UpdateEditSessionMemoryInput = Static<typeof UpdateEditSessionMemoryInput>;

export const SelectEditSessionOutputInput = Type.Object({ outputId: Type.String({ format: "uuid" }) }, { $id: "#/components/schemas/SelectEditSessionOutputInput" });
export type SelectEditSessionOutputInput = Static<typeof SelectEditSessionOutputInput>;

export const ManualPlanningInput = Type.Object({ planningMode: Type.Literal("MANUAL"), requestedTypes: Type.Optional(Type.Array(Type.String(), { minItems: 1 })), requestedSuiteShots: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 12, description: "手动规划必须提供 requestedTypes 与 requestedSuiteShots 中至少一项。" })), userInstruction: Type.Optional(Type.String({ maxLength: 4000 })), candidatesPerType: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })), imageResolution: Type.Optional(schemaRef(ImageResolution)), imageAspectRatio: Type.Optional(schemaRef(ImageAspectRatio)), regenerationKey: Type.Optional(Type.String({ minLength: 1 })) }, { $id: "#/components/schemas/ManualPlanningInput" });
export type ManualPlanningInput = Static<typeof ManualPlanningInput>;

export const AiPlanningInput = Type.Object({ planningMode: Type.Optional(schemaRef(PlanningMode)), requestedTypes: Type.Optional(Type.Array(Type.String())), requestedSuiteShots: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 12 })), imageTypes: Type.Optional(Type.Array(Type.String())), userInstruction: Type.Optional(Type.String({ maxLength: 4000 })), candidatesPerType: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })), targetImageCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })), imageResolution: Type.Optional(schemaRef(ImageResolution)), imageAspectRatio: Type.Optional(schemaRef(ImageAspectRatio)), regenerationKey: Type.Optional(Type.String({ minLength: 1 })) }, { $id: "#/components/schemas/AiPlanningInput" });
export type AiPlanningInput = Static<typeof AiPlanningInput>;

export const CreateExportJobRequest = Type.Object({ outputIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))), filenamePrefix: Type.Optional(Type.String()), platformTargets: Type.Optional(Type.Array(schemaRef(PlatformTarget))), includeDetailPageSlices: Type.Optional(Type.Boolean()) }, { $id: "#/components/schemas/CreateExportJobRequest" });
export type CreateExportJobRequest = Static<typeof CreateExportJobRequest>;

export const EditGenerationConfigInput = Type.Object({ reasoningProviderId: Type.String({ format: "uuid" }), reasoningModelId: Type.String({ minLength: 1 }), imageProviderId: Type.String({ format: "uuid" }), imageModelId: Type.String({ minLength: 1 }), imageResolution: Type.Optional(schemaRef(ImageResolution)), candidateCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })) }, { $id: "#/components/schemas/EditGenerationConfigInput" });
export type EditGenerationConfigInput = Static<typeof EditGenerationConfigInput>;

export const UploadAssetInput = Type.Object({ file: Type.String({ format: "binary" }), role: Type.Optional(schemaRef(AssetRole)), kind: Type.Optional(schemaRef(UserAssetKind)) }, { $id: "#/components/schemas/UploadAssetInput" });
export const CopyLibraryAssetToProjectInput = Type.Object({ itemId: Type.String({ description: "Library item ID: 'asset:<uuid>' or 'output:<uuid>'." }), role: Type.Optional(schemaRef(AssetRole)), kind: Type.Optional(schemaRef(UserAssetKind)) }, { $id: "#/components/schemas/CopyLibraryAssetToProjectInput" });
export type CopyLibraryAssetToProjectInput = Static<typeof CopyLibraryAssetToProjectInput>;
export const UpdateAssetInput = Type.Object({ role: Type.Optional(schemaRef(AssetRole)), kind: Type.Optional(schemaRef(UserAssetKind)) }, { $id: "#/components/schemas/UpdateAssetInput" });
export const ConfirmStoryboardInput = Type.Object({ version: Type.Optional(Type.Integer({ minimum: 1 })) }, { $id: "#/components/schemas/ConfirmStoryboardInput" });
export const GenerationJobsResponse = Type.Object({ jobs: Type.Array(schemaRef(Job)) }, { $id: "#/components/schemas/GenerationJobsResponse" });
export const EcomTemplateItem = Type.Object({
  id: Type.String(), upstreamNumber: Type.Integer(), name: Type.String(), keywords: Type.Array(Type.String()), trigger_phrases: Type.Array(Type.String()),
  prompt_template: Type.Record(Type.String(), Type.String()), defaults: Type.Record(Type.String(), Type.String()), category_tips: Type.Record(Type.String(), Type.String()),
  defaultSize: Type.Union([Type.Literal("1024x1024"), Type.Literal("1024x1536")]),
  variants: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { $id: "#/components/schemas/EcomTemplateItem" });
export const EcomTemplatesResponse = Type.Object({ source: Type.Object({ repository: Type.String({ format: "uri" }), commit: Type.String(), sourcePath: Type.String() }), items: Type.Array(schemaRef(EcomTemplateItem)) }, { $id: "#/components/schemas/EcomTemplatesResponse" });
export const TestProviderConnectionResult = Type.Object({ ok: Type.Boolean(), providerId: Type.String({ format: "uuid" }), modelId: Type.String(), kind: Type.String(), latencyMs: Type.Number(), models: Type.Union([Type.Array(Type.String()), Type.Null()]), modelAvailable: Type.Union([Type.Boolean(), Type.Null()]) }, { $id: "#/components/schemas/TestProviderConnectionResult" });
export const PlanningConfigSnapshotList = Type.Array(schemaRef(PlanningConfigSnapshot), { $id: "#/components/schemas/PlanningConfigSnapshotList" });
export const ApplyPlanningConfigSnapshotResult = Type.Object({ project: schemaRef(Project), snapshot: schemaRef(PlanningConfigSnapshot) }, { $id: "#/components/schemas/ApplyPlanningConfigSnapshotResult" });
export const EditReferenceAssetList = Type.Object({ items: Type.Array(schemaRef(EditReferenceAsset)), suggestedSelections: Type.Array(schemaRef(ReferenceSelection)) }, { $id: "#/components/schemas/EditReferenceAssetList" });
export const UploadEditReferenceAssetInput = Type.Object({ file: Type.String({ format: "binary" }), purpose: schemaRef(ReferencePurpose) }, { $id: "#/components/schemas/UploadEditReferenceAssetInput" });
export const CreateEditTurnInput = Type.Object({ baseOutputId: Type.Optional(Type.String({ format: "uuid" })), message: Type.String({ maxLength: 4000 }), annotations: Type.Optional(Type.String()), editMask: Type.Optional(Type.String({ format: "binary" })), protectMask: Type.Optional(Type.String({ format: "binary" })), referenceSelections: Type.Optional(Type.String()) }, { $id: "#/components/schemas/CreateEditTurnInput" });
export const EditTurnQueuedResponse = Type.Object({ turnId: Type.String({ format: "uuid" }), planJobId: Type.String({ format: "uuid" }), status: schemaRef(EditTurnStatus) }, { $id: "#/components/schemas/EditTurnQueuedResponse" });
export const ApproveEditTurnResponse = Type.Object({ job: schemaRef(Job), turn: schemaRef(EditTurn) }, { $id: "#/components/schemas/ApproveEditTurnResponse" });

// AI 分层导出：plan 请求为空体（识别结果按 output 内容 hash 缓存）；
// export 请求携带用户勾选的元素与手动框选，元素顺序即图层顺序。
export const CreateLayerPlanInput = Type.Object({ regenerationKey: Type.Optional(Type.String({ minLength: 1, description: "Unique key for an intentional re-recognition run." })) }, { $id: "#/components/schemas/CreateLayerPlanInput" });
export type CreateLayerPlanInput = Static<typeof CreateLayerPlanInput>;

// prompt 元素来自用户输入的元素名称（无需画框与视觉识别）；manual 必须带画框；auto 必须来自已成功的识别方案。
export const CreateLayerExportElement = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }), name: Type.String({ minLength: 1, maxLength: 60 }), source: Type.Union([Type.Literal("auto"), Type.Literal("manual"), Type.Literal("prompt")]), promptEn: Type.Optional(Type.String({ minLength: 1, maxLength: 80, description: "English segmentation prompt for auto elements; the API copies it from the referenced plan, so clients usually omit it." })), bbox: Type.Optional(schemaRef(LayerBbox)) }, { $id: "#/components/schemas/CreateLayerExportElement", description: "Manual elements must carry the normalized bbox drawn on the canvas; prompt elements come from user-typed element names and need no bbox or recognition plan." });
export type CreateLayerExportElement = Static<typeof CreateLayerExportElement>;

export const CreateLayerExportInput = Type.Object({ elements: Type.Array(schemaRef(CreateLayerExportElement), { minItems: 1, maxItems: 32 }), includeBackground: Type.Optional(Type.Boolean({ default: true, description: "Generate a holed background layer under the element layers." })), planId: Type.Optional(Type.String({ format: "uuid", description: "The recognition plan the auto elements were selected from; rejected if the plan has since changed." })) }, { $id: "#/components/schemas/CreateLayerExportInput" });
export type CreateLayerExportInput = Static<typeof CreateLayerExportInput>;

// 套图工坊（suite forge）：一次运行把用户上传的爆款套图反推为可复用的套图模板。
// 该任务不绑定项目，源图以 multipart 文件随请求上传；provider/model 由用户在页面自选，服务端校验视觉能力。
export const CreateSuiteForgeJobInput = Type.Object({
  providerId: Type.String({ format: "uuid" }),
  modelId: Type.String({ minLength: 1 }),
  files: Type.Array(Type.String({ format: "binary" }), { minItems: 1, maxItems: 12, description: "爆款套图源图，5–12 张为佳。" }),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
  l1: Type.Optional(Type.String({ minLength: 1 })),
  l2: Type.Optional(Type.String({ minLength: 1 })),
  leaf: Type.Optional(Type.String({ minLength: 1 })),
  productFamily: Type.Optional(Type.String()),
  targetShotCount: Type.Optional(Type.Integer({ minimum: 5, maximum: 12 })),
  userInstruction: Type.Optional(Type.String({ maxLength: 4000, description: "额外反推要求，例如只保留某个卖点结构。" })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
}, { $id: "#/components/schemas/CreateSuiteForgeJobInput" });
export type CreateSuiteForgeJobInput = Static<typeof CreateSuiteForgeJobInput>;

// 反推结果草稿：worker 产出后先落草稿，用户在前端预览确认后才写入 user_suites。
export const SuiteForgeResult = Type.Object({
  jobId: Type.String({ format: "uuid" }),
  status: Type.Union([Type.Literal("DRAFT"), Type.Literal("COMMITTED")]),
  suite: schemaRef(EcomSuiteFile),
  suiteId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.Optional(Type.String({ format: "date-time" })),
}, { $id: "#/components/schemas/SuiteForgeResult" });
export type SuiteForgeResult = Static<typeof SuiteForgeResult>;
