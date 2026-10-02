import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { EcomRepository, SuiteForgeResultRecord } from "@ecomgen/core";
import { requestFingerprint } from "@ecomgen/core";
import type { SuiteDocumentInput } from "@ecomgen/ecom-suite";
import {
  EcomSuiteFile,
  MAX_SUITE_FORGE_INSTRUCTION_LENGTH,
  MAX_SUITE_FORGE_NAME_LENGTH,
  MAX_SUITE_FORGE_SHOTS,
  MAX_SUITE_FORGE_SOURCES,
  MIN_SUITE_FORGE_SHOTS,
} from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import { contentHash, imageDimensions, missing } from "../helpers.js";
import { parseBody } from "../http-input.js";
import { parameter, readOptionalText, readText } from "../input-normalizers.js";
import { suiteIdForImport } from "./suites.js";

/** 「最近反推」列表规模：默认 20 条，上限 50 条，与 paths.yaml 的 limit 声明保持一致。 */
const SUITE_FORGE_LIST_DEFAULT = 20;
const SUITE_FORGE_LIST_MAX = 50;

function publicSuiteForgeResult(record: SuiteForgeResultRecord): object { return { jobId: record.jobId, status: record.status, suite: record.payload, suiteId: record.suiteId ?? null, createdAt: record.createdAt, updatedAt: record.updatedAt }; }

function suiteForgeListLimit(query: unknown): number {
  const raw = (query as Record<string, unknown> | null | undefined)?.limit;
  const text = typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
  if (text === undefined) return SUITE_FORGE_LIST_DEFAULT;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed)) throw new ApiError(400, "VALIDATION_ERROR", "limit must be an integer");
  return Math.min(Math.max(parsed, 1), SUITE_FORGE_LIST_MAX);
}

/** multipart 字段全部是字符串，这里按反推约束逐项解析；长度与取值范围必须与 CreateSuiteForgeJobInput 一致。 */
function suiteForgeHints(fields: Record<string, string>): Record<string, unknown> {
  const hints: Record<string, unknown> = {};
  const name = readOptionalText(fields.name); if (name) hints.name = boundedText(name, MAX_SUITE_FORGE_NAME_LENGTH, "name");
  const l1 = readOptionalText(fields.l1); if (l1) hints.l1 = l1;
  const l2 = readOptionalText(fields.l2); if (l2) hints.l2 = l2;
  const leaf = readOptionalText(fields.leaf); if (leaf) hints.leaf = leaf;
  const productFamily = readOptionalText(fields.productFamily); if (productFamily) hints.productFamily = productFamily;
  const targetShotCount = readOptionalText(fields.targetShotCount);
  if (targetShotCount) {
    const count = Number(targetShotCount);
    if (!Number.isInteger(count) || count < MIN_SUITE_FORGE_SHOTS || count > MAX_SUITE_FORGE_SHOTS) throw new ApiError(400, "VALIDATION_ERROR", `targetShotCount must be an integer between ${MIN_SUITE_FORGE_SHOTS} and ${MAX_SUITE_FORGE_SHOTS}`);
    hints.targetShotCount = count;
  }
  const userInstruction = readOptionalText(fields.userInstruction); if (userInstruction) hints.userInstruction = boundedText(userInstruction, MAX_SUITE_FORGE_INSTRUCTION_LENGTH, "userInstruction");
  return hints;
}

function boundedText(value: string, maxLength: number, field: string): string {
  if (value.length > maxLength) throw new ApiError(400, "VALIDATION_ERROR", `${field} must be at most ${maxLength} characters`);
  return value;
}

function verifyVisionModel(repository: EcomRepository, providerId: string, modelId: string): void {
  const provider = repository.getProvider(providerId); if (!provider) missing("provider", providerId);
  const model = provider.models.find((candidate) => candidate.id === modelId);
  if (!model) throw new ApiError(400, "VALIDATION_ERROR", "Selected reasoning model is not declared by its provider");
  if (!model.supportsVision) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected reasoning model must support Vision for suite forging");
}

export function registerSuiteForgeRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, storage, suiteCatalog, enqueueOrMarkFailed } = ctx;
  // 套图工坊：把一组爆款整图反推为可复用套图模板。任务不绑定项目，源图以 multipart 随请求上传，
  // 推理模型由前端自选并要求支持视觉；产出先落草稿，用户在页面确认后才写入 user_suites。
  app.post("/api/v1/suite-forge-jobs", async (request, reply) => {
    const fields: Record<string, string> = {};
    const uploads: Array<{ filename: string; mimeType: string; buffer: Buffer; hash: string }> = [];
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (!part.mimetype.startsWith("image/")) throw new ApiError(400, "VALIDATION_ERROR", "Only image files are supported");
        const buffer = await part.toBuffer();
        uploads.push({ filename: part.filename || "source", mimeType: part.mimetype, buffer, hash: contentHash(buffer) });
        continue;
      }
      fields[part.fieldname] = typeof part.value === "string" ? part.value : String(part.value ?? "");
    }
    if (uploads.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "At least one source image is required");
    if (uploads.length > MAX_SUITE_FORGE_SOURCES) throw new ApiError(400, "VALIDATION_ERROR", `A suite forge run supports at most ${MAX_SUITE_FORGE_SOURCES} source images`);
    const providerId = readText(fields.providerId, "providerId");
    const modelId = readText(fields.modelId, "modelId");
    const hints = suiteForgeHints(fields);
    const idempotencyKey = readOptionalText(fields.idempotencyKey) ?? (request.headers["idempotency-key"] as string | undefined) ?? null;
    const fingerprint = requestFingerprint({ type: "SUITE_FORGE", providerId, modelId, sourceHashes: uploads.map((upload) => upload.hash), hints, idempotencyKey });
    const existing = repository.findJobByFingerprint(null, fingerprint); if (existing) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    verifyVisionModel(repository, providerId, modelId);
    const jobId = randomUUID();
    const sources: Array<{ storagePath: string; hash: string; originalName: string; mimeType: string; width: number | null; height: number | null }> = [];
    for (const upload of uploads) {
      const stored = await storage.putSuiteForgeSource(jobId, upload.filename, upload.buffer);
      const dimensions = await imageDimensions(upload.buffer);
      sources.push({ storagePath: stored.path, hash: stored.hash, originalName: upload.filename, mimeType: upload.mimeType, width: dimensions.width, height: dimensions.height });
    }
    const job = repository.createJob({ id: jobId, projectId: null, storyboardItemId: null, type: "SUITE_FORGE", input: { providerId, modelId, sources, hints }, requestFingerprint: fingerprint, providerId, modelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueueOrMarkFailed(job, "suite_forge");
    return reply.code(202).send(job);
  });
  // 最近反推：草稿只落在 suite_forge_results，没有这个列表前端就无法回到历史反推结果 ——
  // 刷新页面即等于丢失 jobId，而已入库或待入库的产出其实一直都在。列表含运行中与失败的任务，
  // 因此以 jobs 为主体、草稿摘要为附属，而非直接查草稿表。
  app.get("/api/v1/suite-forge-jobs", async (request) => {
    const items = repository.listJobsByType("SUITE_FORGE", suiteForgeListLimit(request.query)).map((job) => {
      const draft = repository.getSuiteForgeResult(job.id);
      return {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        cancelRequested: job.cancelRequested,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        draft: draft
          ? { name: draft.payload.name, l1: draft.payload.category.l1, l2: draft.payload.category.l2, leaf: draft.payload.category.leaf, shotCount: draft.payload.shots.length, suiteId: draft.suiteId }
          : null
      };
    });
    return { items };
  });
  app.get("/api/v1/suite-forge-jobs/:jobId/result", async (request) => {
    const jobId = parameter(request, "jobId");
    const record = repository.getSuiteForgeResult(jobId); if (!record) missing("suite forge result", jobId);
    return publicSuiteForgeResult(record);
  });
  // 请求体是预览面板里编辑后的整份套图；校验通过后既覆盖草稿也写入 user_suites。
  // 有编辑入口后，用户不必为了改一处文案而整体重跑（重跑要重新消耗模型额度）。
  app.post("/api/v1/suite-forge-jobs/:jobId/commit", async (request) => {
    const jobId = parameter(request, "jobId");
    const record = repository.getSuiteForgeResult(jobId); if (!record) missing("suite forge result", jobId);
    if (record.status === "COMMITTED" && record.suiteId) return publicSuiteForgeResult(record);
    const body = parseBody(EcomSuiteFile, request.body ?? {});
    // id 由服务端裁决：沿用 worker 预分配的 custom-suite- 前缀，仅在已被占用时重新分配。
    const requested = typeof body.id === "string" && body.id ? body.id : record.payload.id;
    const id = requested && requested.startsWith("custom-suite-") && !suiteCatalog.getSuite(requested) ? requested : suiteIdForImport(undefined, suiteCatalog);
    // 草稿已由 worker 归一化，这里只做契约校验后原样落库，不再重复派生 assetType。
    const edited = { ...body, id } as unknown as SuiteDocumentInput;
    repository.saveSuiteForgeResult({ jobId, payload: edited });
    const saved = repository.saveUserSuite({ id, name: edited.name, l1: edited.category.l1, l2: edited.category.l2, leaf: edited.category.leaf, productFamily: edited.productFamily ?? null, payload: edited });
    suiteCatalog.upsertUserSuite(saved);
    const committed = repository.commitSuiteForgeResult(jobId, id) ?? record;
    return publicSuiteForgeResult(committed);
  });
}
