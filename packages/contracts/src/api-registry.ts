import {
  AssetRole, CompositePolicy, CopywritingTarget, EcomSuiteOrigin, EditExecutionMode, EditOperation, EditSessionStatus, EditTurnStatus,
  ErrorCode, ImageAspectRatio, ImageResolution, JobStatus, JobType, PlanningMode, PlatformTarget,
  ReasoningProtocolProfile, ReferencePurpose, ReferenceSource, SearchSourceKind, StoryboardMode,
  StoryboardShotRole, TargetMarket, UserAssetKind, LibraryItemSource, LibraryItemKind
} from "./enums.js";
import * as api from "./api-schemas.js";
import * as requests from "./api-requests.js";
// 模特契约文件同时导出取值元组常量（供编译器与前端做键）与 TypeBox schema；
// 注册表只收 schema，因此显式列出而不是 namespace 展开，避免裸元组混入 components。
import { ModelSpec, ModelGender, ModelAge, ModelHeritage, ModelStature, ModelBuild, ModelPortrait, EcomModel, ModelList, ModelPortraitList, CreateModelInput, UpdateModelInput, CreateModelCastJobInput } from "./model-schemas.js";
// 花型工坊契约同理：pod-print-specs 是纯数据目录不注册，pod-schemas 只显式列出 schema。
import {
  PatternSource, PodPrintCategory, PodPrintLayout, PodPrintSpec, PodPrintSpecList, Pattern, PatternList, UpdatePatternInput,
  PrintPackFile, PrintPackStatus, PrintPack, PrintPackList, CreatePrintPackJobResponse, ListingPlatform, ListingCopy, PatternListingResult,
  CreatePatternExtractJobInput, CreatePatternForgeJobInput, CreatePrintPackJobInput, CreatePatternListingJobInput,
  CreatePatternDeriveJobInput, TileableStatus, CreatePatternVariantJobInput, PatternVariantAxis, PatternVariantPreset, PatternBackgroundMode,
  PatternPipeline, PatternPipelineList, PatternPipelineStep, PatternPipelineStepName, PatternPipelineStepStatus,
  PatternPipelineStatus, PatternPipelineBlockReason, PatternPipelineResolution, PatternPipelineAnswers, CreatePatternPipelineInput, ContinuePatternPipelineInput,
} from "./pod-schemas.js";
import { PodRepeatLayout } from "./pod-repeat.js";
import { EventEnvelope, ModelCapabilities, ModelDefinition } from "./legacy-schemas.js";

/** All schemas emitted into OpenAPI components.schemas. */
export const API_SCHEMA_REGISTRY = {
  PlatformTarget, TargetMarket, StoryboardMode, StoryboardShotRole, AssetRole, UserAssetKind, LibraryItemSource, LibraryItemKind, ImageResolution, ImageAspectRatio,
  PlanningMode, CopywritingTarget, JobType, JobStatus, ReasoningProtocolProfile, SearchSourceKind,
  EcomSuiteOrigin,
  EditOperation, EditExecutionMode, CompositePolicy, ReferenceSource, ReferencePurpose, EditTurnStatus, EditSessionStatus,
  ErrorCode, EventEnvelope, ModelCapabilities, ModelDefinition,
  ...api,
  ...requests,
  ModelSpec, ModelGender, ModelAge, ModelHeritage, ModelStature, ModelBuild, ModelPortrait, EcomModel, ModelList, ModelPortraitList, CreateModelInput, UpdateModelInput, CreateModelCastJobInput,
  PatternSource, PodPrintCategory, PodPrintLayout, PodRepeatLayout, PodPrintSpec, PodPrintSpecList, Pattern, PatternList, UpdatePatternInput,
  PrintPackFile, PrintPackStatus, PrintPack, PrintPackList, CreatePrintPackJobResponse, ListingPlatform, ListingCopy, PatternListingResult,
  CreatePatternExtractJobInput, CreatePatternForgeJobInput, CreatePrintPackJobInput, CreatePatternListingJobInput,
  CreatePatternDeriveJobInput, TileableStatus, CreatePatternVariantJobInput, PatternVariantAxis, PatternVariantPreset, PatternBackgroundMode,
  PatternPipeline, PatternPipelineList, PatternPipelineStep, PatternPipelineStepName, PatternPipelineStepStatus,
  PatternPipelineStatus, PatternPipelineBlockReason, PatternPipelineResolution, PatternPipelineAnswers, CreatePatternPipelineInput, ContinuePatternPipelineInput,
} as const;

export type ApiSchemaName = keyof typeof API_SCHEMA_REGISTRY;
