import { assetPreviewUrl, outputPreviewUrl } from "../../lib/assetUrl";
import { API_BASE_URL } from "../../config/env";
import type { components } from "../schema.d.ts";

export type Project = components["schemas"]["Project"];
export type TargetMarket = Project["targetMarket"];
export type ProjectCover = components["schemas"]["ProjectCover"];
export type Asset = components["schemas"]["Asset"];
export type AssetRole = components["schemas"]["AssetRole"];
export type UserAssetKind = components["schemas"]["UserAssetKind"];
export type ImageResolution = components["schemas"]["ImageResolution"];
export type ImageAspectRatio = components["schemas"]["ImageAspectRatio"];
export type PlanningMode = components["schemas"]["PlanningMode"];
export type Storyboard = components["schemas"]["Storyboard"];
export type StoryboardItem = components["schemas"]["StoryboardItem"];
export type Output = components["schemas"]["Output"];
export type Job = components["schemas"]["Job"];
export type CreateProjectInput = components["schemas"]["CreateProjectInput"];
export type UpdateProjectInput = components["schemas"]["UpdateProjectInput"];
export interface PlanningConfigSnapshot {
  id: string;
  projectId: string;
  sourceJobId: string;
  payload: {
    project: Pick<Project, "name" | "category" | "productDescription" | "verifiedFacts" | "prohibitedClaims" | "brandGuidelines" | "platformTargets" | "targetMarket" | "copyLanguage" | "reasoningProviderId" | "reasoningModelId" | "imageProviderId" | "imageModelId" | "defaultMode" | "imageResolution" | "imageAspectRatio" | "candidatesPerType" | "webResearchEnabled">;
    planning: { planningMode: PlanningMode; requestedTypes: string[]; targetImageCount: number | null; userInstruction: string | null };
  };
  createdAt: string;
}

export interface ProjectDetail extends Project {
  assets: Asset[];
  storyboard: Storyboard | null;
  items: StoryboardItem[];
  outputs: Output[];
  jobs: Job[];
}

const ASSET_ROLES = new Set<AssetRole>([
  "PRODUCT_TRUTH",
  "PACKAGING",
  "STYLE_REFERENCE",
  "LAYOUT_REFERENCE",
]);

const RESOLUTIONS = new Set<ImageResolution>(["1K", "2K", "4K"]);
const TARGET_MARKETS = new Set<Exclude<TargetMarket, null>>([
  "CHINA_MAINLAND", "HONG_KONG", "MACAU", "TAIWAN", "UNITED_STATES", "UNITED_KINGDOM",
  "GERMANY", "FRANCE", "ITALY", "SPAIN", "JAPAN", "SOUTH_KOREA",
]);
const ASPECTS = new Set<ImageAspectRatio>(["AUTO", "1:1", "3:4", "4:3", "16:9"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function emptyCover(): ProjectCover {
  return { productAssetId: null, coverOutputId: null, previewOutputIds: [], outputCount: 0 };
}

function adaptCover(raw: unknown): ProjectCover {
  if (!isRecord(raw)) return emptyCover();
  const productAssetId = asString(raw.productAssetId) ?? null;
  const coverOutputId = asString(raw.coverOutputId) ?? null;
  const outputCount = asNumber(raw.outputCount) ?? 0;
  return {
    productAssetId,
    coverOutputId,
    previewOutputIds: asStringArray(raw.previewOutputIds).filter((id) => id !== coverOutputId).slice(0, 2),
    outputCount: Math.max(0, Math.trunc(outputCount)),
  };
}

function kindFromRole(role: AssetRole): UserAssetKind {
  return role === "PRODUCT_TRUTH" ? "PRODUCT" : "REFERENCE";
}

export function adaptAsset(raw: unknown): Asset | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const projectId = asString(raw.projectId);
  const role = asString(raw.role);
  const mimeType = asString(raw.mimeType) ?? "application/octet-stream";
  const createdAt = asString(raw.createdAt);
  if (!id || !projectId || !role || !ASSET_ROLES.has(role as AssetRole) || !createdAt) return null;
  const typedRole = role as AssetRole;
  const kind = asString(raw.kind) === "PRODUCT" || asString(raw.kind) === "REFERENCE"
    ? (raw.kind as UserAssetKind)
    : kindFromRole(typedRole);
  return {
    id,
    projectId,
    role: typedRole,
    kind,
    mimeType,
    originalName: asString(raw.originalName),
    hash: asString(raw.hash),
    createdAt,
    width: asNumber(raw.width) ?? null,
    height: asNumber(raw.height) ?? null,
    storagePath: asString(raw.storagePath),
    url: assetPreviewUrl({ id, url: asString(raw.url) }),
  };
}

function adaptOutput(raw: unknown): Output | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const storyboardItemId = asString(raw.storyboardItemId);
  const jobId = asString(raw.jobId);
  const createdAt = asString(raw.createdAt);
  if (!id || !storyboardItemId || !jobId || !createdAt) return null;
  const snapshot = isRecord(raw.generationSnapshot)
    ? {
        resolution: RESOLUTIONS.has(raw.generationSnapshot.resolution as ImageResolution)
          ? (raw.generationSnapshot.resolution as ImageResolution)
          : undefined,
        aspectRatio: ASPECTS.has(raw.generationSnapshot.aspectRatio as ImageAspectRatio)
          ? (raw.generationSnapshot.aspectRatio as ImageAspectRatio)
          : undefined,
        size: asString(raw.generationSnapshot.size),
        candidateIndex: asNumber(raw.generationSnapshot.candidateIndex),
        revision: asString(raw.generationSnapshot.revision),
      }
    : null;
  return {
    id,
    storyboardItemId,
    jobId,
    createdAt,
    candidateIndex: asNumber(raw.candidateIndex),
    generationBatchId: asString(raw.generationBatchId) ?? null,
    generationSnapshot: snapshot,
    storagePath: asString(raw.storagePath),
    parentOutputId: asString(raw.parentOutputId) ?? null,
    rootOutputId: asString(raw.rootOutputId) ?? null,
    editSessionId: asString(raw.editSessionId) ?? null,
    editTurnId: asString(raw.editTurnId) ?? null,
    url: outputPreviewUrl({ id, url: asString(raw.url) }),
  };
}

export { adaptOutput };

export type Export = components["schemas"]["Export"];

export function exportDownloadUrl(record: Pick<Export, "id" | "downloadUrl">): string {
  if (typeof record.downloadUrl === "string" && record.downloadUrl.length > 0) {
    return record.downloadUrl;
  }
  return `${API_BASE_URL}/files/exports/${record.id}`;
}

export function adaptExport(raw: unknown): Export | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const projectId = asString(raw.projectId);
  const status = asString(raw.status);
  const createdAt = asString(raw.createdAt);
  if (!id || !projectId || !createdAt) return null;
  if (status !== "QUEUED" && status !== "RUNNING" && status !== "SUCCEEDED" && status !== "FAILED") {
    return null;
  }
  return {
    id,
    projectId,
    status,
    createdAt,
    jobId: asString(raw.jobId),
    storagePath: asString(raw.storagePath) ?? null,
    downloadUrl: typeof raw.downloadUrl === "string" ? raw.downloadUrl : null,
  };
}

export interface ExportJobBundle {
  job: Job | null;
  export: Export | null;
}

export function adaptExportJobBundle(raw: unknown): ExportJobBundle {
  if (!isRecord(raw)) {
    const single = adaptJob(raw);
    return { job: single, export: null };
  }
  if ("job" in raw || "export" in raw) {
    return { job: adaptJob(raw.job), export: adaptExport(raw.export) };
  }
  return { job: adaptJob(raw), export: null };
}

export function adaptJob(raw: unknown): Job | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const type = asString(raw.type);
  const status = asString(raw.status);
  const createdAt = asString(raw.createdAt);
  const progress = asNumber(raw.progress);
  if (!id || !createdAt || progress === undefined) return null;
  if (type !== "PLAN" && type !== "COPYWRITE" && type !== "GENERATE" && type !== "EXPORT") return null;
  if (
    status !== "QUEUED" &&
    status !== "RUNNING" &&
    status !== "SUCCEEDED" &&
    status !== "FAILED" &&
    status !== "CANCELLED"
  ) {
    return null;
  }
  return {
    id,
    type,
    status,
    progress,
    retryable: raw.retryable === true,
    createdAt,
    updatedAt: asString(raw.updatedAt),
    requestFingerprint: asString(raw.requestFingerprint) ?? null,
    providerId: asString(raw.providerId) ?? null,
    modelId: asString(raw.modelId) ?? null,
    estimatedCost: isRecord(raw.estimatedCost) ? (raw.estimatedCost as Job["estimatedCost"]) : null,
    actualCost: isRecord(raw.actualCost) ? (raw.actualCost as Job["actualCost"]) : null,
    cancelRequested: raw.cancelRequested === true,
    error: isRecord(raw.error) ? (raw.error as Job["error"]) : null,
  };
}

export function adaptStoryboard(raw: unknown): Storyboard | null {
  if (!isRecord(raw)) return null;
  const projectId = asString(raw.projectId);
  const version = asNumber(raw.version);
  const status = asString(raw.status);
  const campaignStyleLock = asString(raw.campaignStyleLock) ?? "";
  if (!projectId || version === undefined) return null;
  if (status !== "DRAFT" && status !== "CONFIRMED") return null;
  return { projectId, version, status, campaignStyleLock, items: [] };
}

export function adaptStoryboardItem(raw: unknown): StoryboardItem | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const assetType = asString(raw.assetType);
  const mode = asString(raw.mode);
  const status = asString(raw.status);
  const promptInstruction = asString(raw.promptInstruction);
  if (!id || !assetType || !promptInstruction) return null;
  if (mode !== "CREATIVE" && mode !== "PIXEL_PROTECTED") return null;
  if (status !== "DRAFT" && status !== "CONFIRMED" && status !== "GENERATING" && status !== "GENERATED") {
    return null;
  }
  const candidateCount = asNumber(raw.candidateCount) ?? 1;
  return {
    id,
    assetType,
    displayName: asString(raw.displayName) ?? assetType,
    templateVariant: asString(raw.templateVariant) ?? null,
    candidateCount: Math.min(4, Math.max(1, candidateCount)),
    imageProviderId: asString(raw.imageProviderId),
    imageModelId: asString(raw.imageModelId),
    imageResolution: RESOLUTIONS.has(raw.imageResolution as ImageResolution)
      ? raw.imageResolution as ImageResolution
      : undefined,
    imageAspectRatio: ASPECTS.has(raw.imageAspectRatio as ImageAspectRatio)
      ? raw.imageAspectRatio as ImageAspectRatio
      : undefined,
    referencedAssets: asStringArray(raw.referencedAssets),
    mode,
    status,
    promptInstruction,
    factClaims: asStringArray(raw.factClaims),
    riskFlags: asStringArray(raw.riskFlags),
  };
}

function adaptProjectCore(raw: Record<string, unknown>): Project | null {
  const id = asString(raw.id);
  const name = asString(raw.name);
  const reasoningProviderId = asString(raw.reasoningProviderId) ?? null;
  const reasoningModelId = asString(raw.reasoningModelId) ?? null;
  const imageProviderId = asString(raw.imageProviderId) ?? null;
  const imageModelId = asString(raw.imageModelId) ?? null;
  const defaultMode = asString(raw.defaultMode);
  const createdAt = asString(raw.createdAt);
  const updatedAt = asString(raw.updatedAt);
  const platforms = Array.isArray(raw.platformTargets)
    ? raw.platformTargets.filter((item): item is Project["platformTargets"][number] => item === "TAOBAO" || item === "JD" || item === "PDD" || item === "DOUYIN" || item === "AMAZON" || item === "SHOPIFY")
    : [];
  // Provider 可被删除并置空引用：模型四元组为 null 不应导致整个项目解析失败，
  // 页面据此展示"待重新选择模型"并在生成入口拦截
  if (!id || !name || !createdAt || !updatedAt) {
    return null;
  }
  if (defaultMode !== "CREATIVE" && defaultMode !== "PIXEL_PROTECTED") return null;
  const brand = isRecord(raw.brandGuidelines)
    ? Object.fromEntries(
        Object.entries(raw.brandGuidelines).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : undefined;
  const resolution = asString(raw.imageResolution);
  const aspect = asString(raw.imageAspectRatio);
  const candidates = asNumber(raw.candidatesPerType) ?? 1;
  const webResearchEnabled = raw.webResearchEnabled === true;
  return {
    id,
    name,
    platformTargets: platforms,
    targetMarket: TARGET_MARKETS.has(raw.targetMarket as Exclude<TargetMarket, null>) ? raw.targetMarket as Exclude<TargetMarket, null> : null,
    copyLanguage: asString(raw.copyLanguage) ?? null,
    reasoningProviderId,
    reasoningModelId,
    imageProviderId,
    imageModelId,
    defaultMode,
    imageResolution: RESOLUTIONS.has(resolution as ImageResolution) ? (resolution as ImageResolution) : "1K",
    imageAspectRatio: ASPECTS.has(aspect as ImageAspectRatio) ? (aspect as ImageAspectRatio) : "AUTO",
    candidatesPerType: Math.min(4, Math.max(1, candidates)),
    webResearchEnabled,
    archivedAt: asString(raw.archivedAt) ?? null,
    createdAt,
    updatedAt,
    category: asString(raw.category) ?? null,
    productDescription: asString(raw.productDescription) ?? null,
    verifiedFacts: asStringArray(raw.verifiedFacts),
    prohibitedClaims: asStringArray(raw.prohibitedClaims),
    brandGuidelines: brand,
    cover: adaptCover(raw.cover),
  };
}

export function adaptProject(raw: unknown): Project | null {
  return isRecord(raw) ? adaptProjectCore(raw) : null;
}

export interface StoryboardBundle {
  storyboard: Storyboard | null;
  items: StoryboardItem[];
}

export function adaptStoryboardBundle(raw: unknown): StoryboardBundle {
  if (!isRecord(raw)) return { storyboard: null, items: [] };
  const items = Array.isArray(raw.items)
    ? raw.items.map(adaptStoryboardItem).filter((item): item is StoryboardItem => item !== null)
    : [];
  const storyboard = adaptStoryboard(raw.storyboard);
  if (storyboard) storyboard.items = items;
  return { storyboard, items };
}

export function adaptProjectDetail(raw: unknown): ProjectDetail {
  if (!isRecord(raw)) {
    throw new Error("项目详情响应不是对象");
  }
  const project = adaptProjectCore(raw);
  if (!project) {
    throw new Error("项目详情缺少必填字段");
  }
  return {
    ...project,
    assets: Array.isArray(raw.assets)
      ? raw.assets.map(adaptAsset).filter((item): item is Asset => item !== null)
      : [],
    storyboard: adaptStoryboard(raw.storyboard),
    items: Array.isArray(raw.items)
      ? raw.items.map(adaptStoryboardItem).filter((item): item is StoryboardItem => item !== null)
      : [],
    outputs: Array.isArray(raw.outputs)
      ? raw.outputs.map(adaptOutput).filter((item): item is Output => item !== null)
      : [],
    jobs: Array.isArray(raw.jobs) ? raw.jobs.map(adaptJob).filter((item): item is Job => item !== null) : [],
  };
}
