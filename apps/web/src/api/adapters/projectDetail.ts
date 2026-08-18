import { assetPreviewUrl, outputPreviewUrl } from "../../lib/assetUrl";
import { API_BASE_URL } from "../../config/env";
import type { components } from "../schema.d.ts";

export type Project = components["schemas"]["Project"];
export type Variant = components["schemas"]["Variant"];
export type Asset = components["schemas"]["Asset"];
export type AssetRole = components["schemas"]["AssetRole"];
export type Storyboard = components["schemas"]["Storyboard"];
export type StoryboardItem = components["schemas"]["StoryboardItem"];
export type Output = components["schemas"]["Output"];
export type Job = components["schemas"]["Job"];
export type CreateProjectInput = components["schemas"]["CreateProjectInput"];
export type CreateVariantInput = components["schemas"]["CreateVariantInput"];

/**
 * 运行时项目详情（缺口 13.2）：GET /projects/{id} 实际返回
 * Project + variants/assets/storyboard/items/outputs/jobs。
 * storyboard 无内嵌 items，与 items 平级。
 */
export interface ProjectDetail extends Project {
  variants: Variant[];
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

export function adaptVariant(raw: unknown): Variant | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const projectId = asString(raw.projectId);
  const name = asString(raw.name);
  const createdAt = asString(raw.createdAt);
  if (!id || !projectId || !name || !createdAt) return null;
  const attributes = isRecord(raw.attributes)
    ? Object.fromEntries(
        Object.entries(raw.attributes).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : undefined;
  return { id, projectId, name, createdAt, attributes };
}

export function adaptAsset(raw: unknown): Asset | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const projectId = asString(raw.projectId);
  const role = asString(raw.role);
  const mimeType = asString(raw.mimeType) ?? "application/octet-stream";
  const createdAt = asString(raw.createdAt);
  if (!id || !projectId || !role || !ASSET_ROLES.has(role as AssetRole) || !createdAt) return null;
  const variantId = raw.variantId === null || raw.variantId === undefined ? null : asString(raw.variantId);
  return {
    id,
    projectId,
    role: role as AssetRole,
    mimeType,
    createdAt,
    variantId: variantId ?? null,
    width: asNumber(raw.width) ?? null,
    height: asNumber(raw.height) ?? null,
    url: assetPreviewUrl({ id, url: asString(raw.url) }),
  };
}

function adaptOutput(raw: unknown): Output | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const storyboardItemId = asString(raw.storyboardItemId);
  const createdAt = asString(raw.createdAt);
  const review = asString(raw.reviewDecision);
  if (!id || !storyboardItemId || !createdAt) return null;
  if (review !== "SELECTED" && review !== "REJECTED" && review !== "NEEDS_REVIEW") return null;
  return {
    id,
    storyboardItemId,
    createdAt,
    reviewDecision: review,
    url: outputPreviewUrl({ id, url: asString(raw.url) }),
  };
}

export { adaptOutput };

export type Export = components["schemas"]["Export"];

/** GET /exports/{id} 的下载地址：优先 downloadUrl，空则回退 /files/exports/{id}（缺口 13.6）。 */
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
    downloadUrl: typeof raw.downloadUrl === "string" ? raw.downloadUrl : null,
  };
}

/** POST /export-jobs 运行时实际返回 { job, export }，与 OpenAPI 裸 Job 不一致。 */
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
  if (type !== "PLAN" && type !== "GENERATE" && type !== "EXPORT") return null;
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
  const variantScope = asString(raw.variantScope);
  const mode = asString(raw.mode);
  const status = asString(raw.status);
  const promptInstruction = asString(raw.promptInstruction);
  if (!id || !assetType || !variantScope || !promptInstruction) return null;
  if (mode !== "CREATIVE" && mode !== "PIXEL_PROTECTED") return null;
  if (status !== "DRAFT" && status !== "CONFIRMED" && status !== "GENERATING" && status !== "GENERATED") {
    return null;
  }
  return {
    id,
    assetType,
    variantScope,
    mode,
    status,
    promptInstruction,
    factClaims: Array.isArray(raw.factClaims)
      ? raw.factClaims.filter(isRecord).map((item) => item as NonNullable<StoryboardItem["factClaims"]>[number])
      : [],
    riskFlags: asStringArray(raw.riskFlags),
  };
}

function adaptProjectCore(raw: Record<string, unknown>): Project | null {
  const id = asString(raw.id);
  const name = asString(raw.name);
  const reasoningProviderId = asString(raw.reasoningProviderId);
  const reasoningModelId = asString(raw.reasoningModelId);
  const imageProviderId = asString(raw.imageProviderId);
  const imageModelId = asString(raw.imageModelId);
  const defaultMode = asString(raw.defaultMode);
  const createdAt = asString(raw.createdAt);
  const updatedAt = asString(raw.updatedAt);
  const platforms = Array.isArray(raw.platformTargets)
    ? raw.platformTargets.filter((item): item is "DOMESTIC" | "AMAZON" => item === "DOMESTIC" || item === "AMAZON")
    : [];
  if (
    !id ||
    !name ||
    !reasoningProviderId ||
    !reasoningModelId ||
    !imageProviderId ||
    !imageModelId ||
    !createdAt ||
    !updatedAt ||
    platforms.length === 0
  ) {
    return null;
  }
  if (defaultMode !== "CREATIVE" && defaultMode !== "PIXEL_PROTECTED") return null;
  const brand = isRecord(raw.brandGuidelines)
    ? Object.fromEntries(
        Object.entries(raw.brandGuidelines).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    : undefined;
  return {
    id,
    name,
    platformTargets: platforms,
    reasoningProviderId,
    reasoningModelId,
    imageProviderId,
    imageModelId,
    defaultMode,
    createdAt,
    updatedAt,
    category: asString(raw.category) ?? null,
    productDescription: asString(raw.productDescription) ?? null,
    verifiedFacts: asStringArray(raw.verifiedFacts),
    prohibitedClaims: asStringArray(raw.prohibitedClaims),
    brandGuidelines: brand,
  };
}

export function adaptProject(raw: unknown): Project | null {
  return isRecord(raw) ? adaptProjectCore(raw) : null;
}

/** GET /storyboard 运行时是 { storyboard, items }，不是 OpenAPI 的内嵌 items。 */
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
    variants: Array.isArray(raw.variants)
      ? raw.variants.map(adaptVariant).filter((item): item is Variant => item !== null)
      : [],
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
