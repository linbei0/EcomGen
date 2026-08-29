import { Type, type Static } from "@sinclair/typebox";
import { AssetRole, EditTurnStatus, ImageAspectRatio, ImageResolution, PlanningMode, PlatformTarget, ReferencePurpose, UserAssetKind } from "./enums.js";
import { EditReferenceAsset, EditTurn, Job, ModelRef, PlanningConfigSnapshot, Project, ReferenceSelection } from "./api-schemas.js";
import { schemaRef } from "./ref.js";

export const TestProviderInput = Type.Object({ modelId: Type.String({ minLength: 1 }), kind: Type.Optional(Type.Union([Type.Literal("reasoning"), Type.Literal("image")])) }, { $id: "#/components/schemas/TestProviderInput" });
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

export const ManualPlanningInput = Type.Object({ planningMode: Type.Literal("MANUAL"), requestedTypes: Type.Array(Type.String(), { minItems: 1 }), userInstruction: Type.Optional(Type.String({ maxLength: 4000 })), candidatesPerType: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })), imageResolution: Type.Optional(schemaRef(ImageResolution)), imageAspectRatio: Type.Optional(schemaRef(ImageAspectRatio)), regenerationKey: Type.Optional(Type.String({ minLength: 1 })) }, { $id: "#/components/schemas/ManualPlanningInput" });
export type ManualPlanningInput = Static<typeof ManualPlanningInput>;

export const AiPlanningInput = Type.Object({ planningMode: Type.Optional(schemaRef(PlanningMode)), requestedTypes: Type.Optional(Type.Array(Type.String())), imageTypes: Type.Optional(Type.Array(Type.String())), userInstruction: Type.Optional(Type.String({ maxLength: 4000 })), candidatesPerType: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })), targetImageCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })), imageResolution: Type.Optional(schemaRef(ImageResolution)), imageAspectRatio: Type.Optional(schemaRef(ImageAspectRatio)), regenerationKey: Type.Optional(Type.String({ minLength: 1 })) }, { $id: "#/components/schemas/AiPlanningInput" });
export type AiPlanningInput = Static<typeof AiPlanningInput>;

export const CreateExportJobRequest = Type.Object({ outputIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))), filenamePrefix: Type.Optional(Type.String()), platformTargets: Type.Optional(Type.Array(schemaRef(PlatformTarget))), includeDetailPageSlices: Type.Optional(Type.Boolean()) }, { $id: "#/components/schemas/CreateExportJobRequest" });
export type CreateExportJobRequest = Static<typeof CreateExportJobRequest>;

export const EditGenerationConfigInput = Type.Object({ reasoningProviderId: Type.String({ format: "uuid" }), reasoningModelId: Type.String({ minLength: 1 }), imageProviderId: Type.String({ format: "uuid" }), imageModelId: Type.String({ minLength: 1 }), imageResolution: Type.Optional(schemaRef(ImageResolution)), candidateCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })) }, { $id: "#/components/schemas/EditGenerationConfigInput" });
export type EditGenerationConfigInput = Static<typeof EditGenerationConfigInput>;

export const UploadAssetInput = Type.Object({ file: Type.String({ format: "binary" }), role: Type.Optional(schemaRef(AssetRole)), kind: Type.Optional(schemaRef(UserAssetKind)) }, { $id: "#/components/schemas/UploadAssetInput" });
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
