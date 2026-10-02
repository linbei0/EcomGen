import { createHash } from "node:crypto";
import sharp from "sharp";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  EcomRepository,
  LocalAssetStore,
  type JobRecord,
  type LibraryItemRecord,
  type ModelRecord,
  type PatternPipelineWithSteps,
  type PatternRecord,
} from "@ecomgen/core";
import {
  ASSET_ROLES,
  MAX_CANDIDATES_PER_TYPE,
  MAX_PRODUCT_IMAGE_ASSETS,
  MAX_REFERENCE_IMAGE_ASSETS,
  MAX_TARGET_IMAGE_COUNT,
  MIN_TARGET_IMAGE_COUNT,
  SEGMENTATION_PROTOCOLS,
  roleForUserAssetKind,
} from "@ecomgen/contracts";
import type { AssetRole, JobType, SegmentationProtocol, UserAssetKind } from "@ecomgen/contracts";
import { ApiError } from "./errors.js";
import { parseModelRef } from "./projectPatch.js";
import { enumValue } from "./input-normalizers.js";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function missing(resource: string, id: string): never { throw new ApiError(404, "NOT_FOUND", `${resource} not found: ${id}`); }

export function ensureProject(repository: EcomRepository, id: string): void { if (!repository.getProject(id)) missing("project", id); }
export function ensureModel(repository: EcomRepository, id: string): ModelRecord { const model = repository.getModel(id); if (!model) missing("model", id); return model; }
export function ensurePattern(repository: EcomRepository, id: string): PatternRecord { const pattern = repository.getPattern(id); if (!pattern) missing("pattern", id); return pattern; }
export function ensurePatternPipeline(repository: EcomRepository, id: string): PatternPipelineWithSteps { const pipeline = repository.getPatternPipeline(id); if (!pipeline) missing("pattern pipeline", id); return pipeline; }

// ProviderId/modelId 为 null 表示项目尚未选择模型（Provider 被删除后置空），在入口拦截而不是打出一个注定失败的任务
export function verifyModel(repository: EcomRepository, providerId: string | null, modelId: string | null, kind: "reasoning" | "image"): void { if (!providerId || !modelId) throw new ApiError(422, "PROVIDER_NOT_CONFIGURED", "请先在项目设置中选择推理与图片模型"); const provider = repository.getProvider(providerId); if (!provider) missing("provider", providerId); const model = provider.models.find((candidate) => candidate.id === modelId); if (!model) throw new ApiError(400, "VALIDATION_ERROR", `${kind} model is not declared by the selected provider`); if (kind === "image" && !model.imageApiKind) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected image model has no image API configured"); }

export function verifyCopywritingModel(repository: EcomRepository, providerId: string | null, modelId: string | null): void {
  if (!providerId || !modelId) throw new ApiError(422, "PROVIDER_NOT_CONFIGURED", "请先在项目设置中选择推理与图片模型");
  const provider = repository.getProvider(providerId);
  if (!provider) missing("provider", providerId);
  const model = provider.models.find((candidate) => candidate.id === modelId);
  if (!model) throw new ApiError(400, "VALIDATION_ERROR", "Configured reasoning model is not declared by its provider");
  if (!model.supportsVision) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected reasoning model must support Vision for AI copywriting");
}

/**
 * 指纹复用的前提是产物仍在：在途任务照常复用——forge/cast 的产物随候选完成才逐张落库，
 * 在途阶段以"产物存在"为复用条件会让重复提交重复计费；SUCCEEDED 任务的产物被删除后
 * 指纹成为孤儿，复用它只会返回一个不再产出任何东西的旧任务（花型墙/定妆照区永远空着），
 * 必须放行走新建流程。同一指纹新建任务安全：findJobByFingerprint 取最新一条且无唯一约束。
 */
export function reusableFingerprintedJob(existing: JobRecord, hasProducts: boolean): boolean {
  return existing.status !== "SUCCEEDED" || hasProducts;
}

/** 入队失败时同步把任务的领域伴随记录推进到终态，避免前端看到永远 QUEUED 的记录。 */
export function markDomainRecordFailed(repository: EcomRepository, type: JobType, jobId: string): void {
  const error = { code: "QUEUE_UNAVAILABLE", message: "任务已创建但队列暂不可用，请稍后重试" };
  if (type === "LAYER_PLAN") {
    const plan = repository.getLayerPlanByJobId(jobId);
    if (plan) repository.updateLayerPlan(plan.id, { status: "FAILED", error });
  }
  if (type === "LAYER_EXPORT") {
    const layerExport = repository.getLayerExportByJobId(jobId);
    if (layerExport) repository.updateLayerExport(layerExport.id, { status: "FAILED", error });
  }
  if (type === "PRINT_PACK") {
    const pack = repository.getPrintPackByJobId(jobId);
    if (pack) repository.updatePrintPack(pack.id, { status: "FAILED", error });
  }
}

export function contentHash(content: Buffer): string { return createHash("sha256").update(content).digest("hex"); }

export async function imageDimensions(content: Buffer): Promise<{ width: number | null; height: number | null }> {
  try {
    const metadata = await sharp(content).metadata();
    return { width: metadata.width ?? null, height: metadata.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

/** 缩略图只承载网格预览：限制在 512px 内并按 EXIF 方向校正，统一转 webp 控制体积。 */
export async function renderThumbnail(content: Buffer): Promise<Buffer> {
  return sharp(content).rotate().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
}

export async function writeThumbnail(storage: LocalAssetStore, hash: string, content: Buffer): Promise<void> {
  try {
    await storage.putThumbnail(hash, await renderThumbnail(content));
  } catch {
    // 缩略图是派生缓存，入库失败不阻断上传；/files/thumbnails 会在首次访问时重试
  }
}

// requestedId 用于 404 文案带上真实请求标识：sendStored 不知道路由参数名，由各端点自行传入。
export async function sendStored(request: FastifyRequest, reply: FastifyReply, storage: LocalAssetStore, record: { storagePath: string | null; mimeType?: string; hash?: string } | undefined, name: string, requestedId: string): Promise<unknown> {
  if (!record || !record.storagePath) missing(name, requestedId);
  const etag = record.hash ? `"${record.hash}"` : undefined;
  if (etag && request.headers["if-none-match"] === etag) return reply.code(304).send();
  const size = await storage.size(record.storagePath);
  reply
    .type(record.mimeType ?? mimeForPath(record.storagePath))
    .header("cache-control", "public, max-age=31536000, immutable")
    .header("accept-ranges", "bytes")
    .header("content-length", size)
    .header("etag", etag ?? `W/"${size}"`)
    .send(storage.stream(record.storagePath));
  return reply;
}

export function mimeForPath(path: string): string { if (path.endsWith(".png")) return "image/png"; if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"; if (path.endsWith(".webp")) return "image/webp"; if (path.endsWith(".zip")) return "application/zip"; if (path.endsWith(".psd")) return "image/vnd.adobe.photoshop"; return "application/octet-stream"; }

export function parseAssetRole(value: unknown): AssetRole {
  if (value === "PRODUCT" || value === "REFERENCE") return roleForUserAssetKind(value as UserAssetKind);
  return enumValue<AssetRole>(value, ASSET_ROLES, "role");
}

export function candidatesPerType(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_CANDIDATES_PER_TYPE) throw new ApiError(400, "VALIDATION_ERROR", `candidatesPerType must be an integer between 1 and ${MAX_CANDIDATES_PER_TYPE}`);
  return count;
}

export function planningImageCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(count) || count < MIN_TARGET_IMAGE_COUNT || count > MAX_TARGET_IMAGE_COUNT) throw new ApiError(400, "VALIDATION_ERROR", `targetImageCount must be an integer between ${MIN_TARGET_IMAGE_COUNT} and ${MAX_TARGET_IMAGE_COUNT}`);
  return count;
}

export function clampCandidates(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CANDIDATES_PER_TYPE, Math.max(1, Math.round(value)));
}

/** 分割模型引用必须指向声明了 segmentationProtocol 的模型；存储的 protocol 从模型声明派生，请求里显式给出的协议仅用于一致性校验。 */
export function readSegmentationModel(repository: EcomRepository, value: unknown): { providerId: string; modelId: string; protocol: SegmentationProtocol } {
  const ref = parseModelRef(value, "segmentationModel");
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const requested = raw.protocol === undefined || raw.protocol === null ? undefined : enumValue(raw.protocol, [...SEGMENTATION_PROTOCOLS], "segmentationModel.protocol");
  const provider = repository.getProvider(ref.providerId);
  if (!provider) missing("provider", ref.providerId);
  const model = provider.models.find((candidate) => candidate.id === ref.modelId);
  if (!model) throw new ApiError(400, "VALIDATION_ERROR", "segmentation model is not declared by the selected provider");
  if (!model.segmentationProtocol) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected segmentation model has no segmentation API configured");
  if (requested && requested !== model.segmentationProtocol) throw new ApiError(400, "VALIDATION_ERROR", `segmentationModel.protocol must match the model's declared protocol (${model.segmentationProtocol})`);
  return { providerId: ref.providerId, modelId: ref.modelId, protocol: model.segmentationProtocol };
}

export function assertProjectAssetCapacity(repository: Pick<EcomRepository, "listAssets">, projectId: string, role: AssetRole): void {
  const assets = repository.listAssets(projectId).filter((asset) => asset.mimeType.startsWith("image/"));
  const limit = role === "PRODUCT_TRUTH" ? MAX_PRODUCT_IMAGE_ASSETS : MAX_REFERENCE_IMAGE_ASSETS;
  const count = assets.filter((asset) => asset.role === role || (role !== "PRODUCT_TRUTH" && asset.role !== "PRODUCT_TRUTH")).length;
  if (count >= limit) {
    const label = role === "PRODUCT_TRUTH" ? "商品图" : "参考图";
    throw new ApiError(400, "VALIDATION_ERROR", `项目最多上传 ${limit} 张${label}`);
  }
}

export function assertProjectAssetHashUnique(repository: Pick<EcomRepository, "listAssets">, projectId: string, hash: string): void {
  if (repository.listAssets(projectId).some((asset) => asset.hash === hash)) {
    throw new ApiError(400, "VALIDATION_ERROR", "相同图片已上传到项目");
  }
}
