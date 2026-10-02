import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ModelPortraitRecord, ModelRecord } from "@ecomgen/core";
import { requestFingerprint } from "@ecomgen/core";
import { findModelSpecConflicts } from "@ecomgen/ecom-skill";
import { CreateModelCastJobInput, CreateModelInput, UpdateModelInput } from "@ecomgen/contracts";
import type { ModelSpec } from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import { ensureModel, missing, reusableFingerprintedJob, verifyModel } from "../helpers.js";
import { parseBody } from "../http-input.js";
import { parameter, readPatchText, readText } from "../input-normalizers.js";

/**
 * 模特规格的互斥组合在入参处就拦下。
 *
 * 判定单源在 ecom-skill：设计器用同一份规则禁用不可选项，正常路径下这里不会触发；
 * 这道闸是给脚本与第三方客户端留的，避免它们落库一份会编译出自相矛盾提示词的规格。
 */
export function assertModelSpecCoherent(spec: ModelSpec): void {
  const conflicts = findModelSpecConflicts(spec);
  if (conflicts.length === 0) return;
  throw new ApiError(
    400,
    "VALIDATION_ERROR",
    `模特规格存在互斥组合：${conflicts.map((conflict) => conflict.reason).join("；")}`,
    conflicts.map((conflict) => ({ path: `/spec/${conflict.field}`, reason: conflict.reason })),
  );
}

function publicModelPortrait(portrait: ModelPortraitRecord) {
  return {
    id: portrait.id,
    modelId: portrait.modelId,
    url: `/api/v1/files/model-portraits/${portrait.id}`,
    width: portrait.width,
    height: portrait.height,
    providerId: portrait.providerId,
    imageModelId: portrait.imageModelId,
    aspectRatio: portrait.aspectRatio,
    selected: portrait.selected,
    createdAt: portrait.createdAt,
  };
}

/** 候选由调用方提供：列表接口批量取回后传入，单条路径传自己的候选，响应组装本身不碰存储。 */
function publicModel(record: ModelRecord, portraits: ReadonlyArray<ModelPortraitRecord>) {
  const selected = portraits.find((portrait) => portrait.selected) ?? null;
  return {
    id: record.id,
    name: record.name,
    spec: record.spec,
    notes: record.notes,
    hasReferenceFace: record.referenceFacePath !== null,
    ...(record.referenceFacePath ? { referenceFaceUrl: `/api/v1/files/models/${record.id}/reference-face` } : {}),
    selectedPortrait: selected ? publicModelPortrait(selected) : null,
    portraitCount: portraits.length,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function registerModelRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, storage, enqueueOrMarkFailed } = ctx;
  // ---- 全局模特库：spec 即合约，API 只做校验、持久化与入队；定妆照 prompt 由 worker 按 spec 确定性编译。 ----
  app.get("/api/v1/models", async () => {
    // 候选一次批量取回按模特分组：列表长度决定查询次数会随库增长放大。
    const portraitsByModel = new Map<string, ModelPortraitRecord[]>();
    for (const portrait of repository.listAllModelPortraits()) {
      const bucket = portraitsByModel.get(portrait.modelId);
      if (bucket) bucket.push(portrait);
      else portraitsByModel.set(portrait.modelId, [portrait]);
    }
    return { items: repository.listModels().map((record) => publicModel(record, portraitsByModel.get(record.id) ?? [])), nextCursor: null };
  });
  app.post("/api/v1/models", async (request, reply) => {
    const body = parseBody(CreateModelInput, request.body);
    assertModelSpecCoherent(body.spec);
    const record = repository.createModel({ name: readText(body.name, "name"), spec: body.spec, notes: body.notes ?? "" });
    // 新建模特必然没有候选，省掉一次查询。
    return reply.code(201).send(publicModel(record, []));
  });
  app.get("/api/v1/models/:modelId", async (request) => {
    const record = ensureModel(repository, parameter(request, "modelId"));
    return publicModel(record, repository.listModelPortraits(record.id));
  });
  app.patch("/api/v1/models/:modelId", async (request) => {
    const current = ensureModel(repository, parameter(request, "modelId"));
    const body = parseBody(UpdateModelInput, request.body);
    if (body.spec) assertModelSpecCoherent(body.spec);
    // 只带显式传入的字段：patch 里值为 undefined 的键会覆盖当前值，并在写库时绑成 NULL。
    const patch: { name?: string; spec?: ModelSpec; notes?: string } = {};
    if (body.name !== undefined) patch.name = readText(body.name, "name");
    if (body.spec !== undefined) patch.spec = body.spec;
    if (body.notes !== undefined) patch.notes = readPatchText(body.notes, "notes");
    const record = repository.updateModel(current.id, patch) ?? current;
    return publicModel(record, repository.listModelPortraits(record.id));
  });
  app.delete("/api/v1/models/:modelId", async (request, reply) => {
    const model = ensureModel(repository, parameter(request, "modelId"));
    // 先清文件再删行：模特行级联清定妆照记录，models/<id>/ 目录由 deleteModel 一并删除；
    // 文件清理失败时保留模特记录，前端可准确重试。
    await storage.deleteModel(model.id);
    repository.deleteModel(model.id);
    return reply.code(204).send();
  });
  // 参考脸是模特的唯一身份基准：multipart 单图上传，覆盖旧图（存储路径随 hash 变化，旧文件成为可容忍的孤儿）。
  app.post("/api/v1/models/:modelId/reference-face", async (request, reply) => {
    const model = ensureModel(repository, parameter(request, "modelId"));
    let upload: { filename: string; buffer: Buffer } | null = null;
    for await (const part of request.parts()) {
      if (part.type !== "file") continue;
      if (!part.mimetype.startsWith("image/")) throw new ApiError(400, "VALIDATION_ERROR", "Only image files are supported");
      upload = { filename: part.filename || "reference-face", buffer: await part.toBuffer() };
      break;
    }
    if (!upload) throw new ApiError(400, "VALIDATION_ERROR", "A reference face image is required");
    const stored = await storage.putModelReferenceFace(model.id, upload.filename, upload.buffer);
    const record = repository.setModelReferenceFace(model.id, stored.path, stored.hash) ?? model;
    return reply.code(201).send(publicModel(record, repository.listModelPortraits(record.id)));
  });
  app.delete("/api/v1/models/:modelId/reference-face", async (request, reply) => {
    const model = ensureModel(repository, parameter(request, "modelId"));
    // 先删文件再清字段：字段置空后 storagePath 无处可查（与资产删除同理）。
    if (model.referenceFacePath) await storage.delete(model.referenceFacePath);
    repository.setModelReferenceFace(model.id, null, null);
    return reply.code(204).send();
  });
  // 选角生成：付费生图任务，不绑定项目。指纹含 spec、notes、参考脸 hash 与生成参数，
  // 同 spec 重复提交复用既有 QUEUED/RUNNING/SUCCEEDED 任务；定妆照被删光后同指纹重提必须新建。
  app.post("/api/v1/models/:modelId/cast-jobs", async (request, reply) => {
    const model = ensureModel(repository, parameter(request, "modelId"));
    const body = parseBody(CreateModelCastJobInput, request.body);
    verifyModel(repository, body.providerId, body.imageModelId, "image");
    const candidateCount = body.candidateCount ?? 1;
    const idempotencyKey = (request.headers["idempotency-key"] as string | undefined) ?? null;
    const fingerprint = requestFingerprint({ type: "MODEL_CAST", modelId: model.id, spec: model.spec, notes: model.notes, referenceFaceHash: model.referenceFaceHash, providerId: body.providerId, imageModelId: body.imageModelId, aspectRatio: body.aspectRatio, candidateCount, idempotencyKey });
    const existing = repository.findJobByFingerprint(null, fingerprint);
    if (existing && reusableFingerprintedJob(existing, repository.listModelPortraitsByJobId(existing.id).length > 0)) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: "MODEL_CAST", input: { modelId: model.id, aspectRatio: body.aspectRatio, candidateCount, spec: model.spec, notes: model.notes, referenceFacePath: model.referenceFacePath }, requestFingerprint: fingerprint, providerId: body.providerId, modelId: body.imageModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueueOrMarkFailed(job, "model_cast");
    return reply.code(202).send(job);
  });
  app.get("/api/v1/models/:modelId/portraits", async (request) => {
    const model = ensureModel(repository, parameter(request, "modelId"));
    return { items: repository.listModelPortraits(model.id).map(publicModelPortrait) };
  });
  app.delete("/api/v1/model-portraits/:portraitId", async (request, reply) => {
    const id = parameter(request, "portraitId");
    const portrait = repository.getModelPortrait(id);
    if (!portrait) missing("model portrait", id);
    // 先删文件再删行：行删了就找不到 storagePath。
    await storage.delete(portrait.storagePath);
    repository.deleteModelPortrait(id);
    return reply.code(204).send();
  });
  app.post("/api/v1/model-portraits/:portraitId/select", async (request) => {
    const id = parameter(request, "portraitId");
    const portrait = repository.getModelPortrait(id); if (!portrait) missing("model portrait", id);
    repository.selectModelPortrait(portrait.modelId, id);
    const model = ensureModel(repository, portrait.modelId);
    return publicModel(model, repository.listModelPortraits(model.id));
  });
}
