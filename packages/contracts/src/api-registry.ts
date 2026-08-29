import {
  AssetRole, CopywritingTarget, EditExecutionMode, EditOperation, EditSessionStatus, EditTurnStatus,
  ErrorCode, ImageAspectRatio, ImageResolution, JobStatus, JobType, PlanningMode, PlatformTarget,
  ReasoningProtocolProfile, ReferencePurpose, ReferenceSource, SearchSourceKind, StoryboardMode,
  TargetMarket, UserAssetKind
} from "./enums.js";
import * as api from "./api-schemas.js";
import * as requests from "./api-requests.js";
import { EventEnvelope, ModelCapabilities, ModelDefinition } from "./legacy-schemas.js";

/** All schemas emitted into OpenAPI components.schemas. */
export const API_SCHEMA_REGISTRY = {
  PlatformTarget, TargetMarket, StoryboardMode, AssetRole, UserAssetKind, ImageResolution, ImageAspectRatio,
  PlanningMode, CopywritingTarget, JobType, JobStatus, ReasoningProtocolProfile, SearchSourceKind,
  EditOperation, EditExecutionMode, ReferenceSource, ReferencePurpose, EditTurnStatus, EditSessionStatus,
  ErrorCode, EventEnvelope, ModelCapabilities, ModelDefinition,
  ...api,
  ...requests,
} as const;

export type ApiSchemaName = keyof typeof API_SCHEMA_REGISTRY;
