import { randomUUID } from "node:crypto";
import { join } from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { fastifySSE } from "@fastify/sse";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { EcomRepository, LocalAssetStore, SecretBox, openDatabase, requestFingerprint, type ProviderRecord } from "@ecomgen/core";
import { ECOM_DETAILS_IMAGE_SOURCE, ECOM_TEMPLATES, getTemplate, resolveTemplates } from "@ecomgen/ecom-skill";
import { createJobQueue, createRedisConnection, enqueue, RedisProjectEventBus } from "@ecomgen/jobs";
import type { AssetRole, ModelDefinition, OutputReviewDecision, PlatformTarget, StoryboardMode } from "@ecomgen/contracts";
import { OpenAiCompatibleImageProvider, ProviderError } from "@ecomgen/providers";

import { ApiError } from "./errors.js";
import { applyModelFields } from "./projectPatch.js";

export interface ApiOptions { dataDir: string; redisUrl: string; masterKey: string; }

export async function buildApi(options: ApiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, genReqId: () => randomUUID() });
  const database = openDatabase(join(options.dataDir, "ecomgen.sqlite"));
  const repository = new EcomRepository(database);
  const storage = new LocalAssetStore(options.dataDir); await storage.initialize();
  const secrets = new SecretBox(options.masterKey);
  const redis = createRedisConnection(options.redisUrl);
  const queue = createJobQueue(redis);
  const events = new RedisProjectEventBus(redis.duplicate(), redis.duplicate());
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024, files: 12 } });
  await app.register(fastifySSE, { heartbeatInterval: 20_000 });
  app.addHook("onClose", async () => { await events.close(); await queue.close(); database.close(); });
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof ApiError;
    const status = known ? error.statusCode : 500;
    request.log.error(error);
    return reply.status(status).send({ error: { code: known ? error.code : "INTERNAL_ERROR", message: known ? error.message : "Unexpected server error", details: known ? error.details : [], requestId: request.id } });
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/v1/ecom-templates", async () => ({ source: ECOM_DETAILS_IMAGE_SOURCE, items: ECOM_TEMPLATES }));
  app.get("/api/v1/providers", async () => ({ items: repository.listProviders().map(publicProvider), nextCursor: null }));
  app.post("/api/v1/providers", async (request, reply) => {
    const body = object(request.body, "body");
    const models = requireModels(body.models);
    const apiKey = string(body.apiKey, "apiKey");
    const record = repository.saveProvider({ name: string(body.name, "name"), baseUrl: string(body.baseUrl, "baseUrl"), encryptedApiKey: secrets.encrypt(apiKey), models });
    await events.publish("system", "provider.updated", publicProvider(record)); return reply.code(201).send(publicProvider(record));
  });
  app.patch("/api/v1/providers/:providerId", async (request) => {
    const id = parameter(request, "providerId"); const current = repository.getProvider(id); if (!current) missing("provider", id);
    const body = object(request.body, "body");
    const record = repository.saveProvider({ id, name: optionalString(body.name) ?? current.name, baseUrl: optionalString(body.baseUrl) ?? current.baseUrl, encryptedApiKey: body.apiKey ? secrets.encrypt(string(body.apiKey, "apiKey")) : current.encryptedApiKey, models: body.models ? requireModels(body.models) : current.models });
    await events.publish("system", "provider.updated", publicProvider(record)); return publicProvider(record);
  });
  app.post("/api/v1/providers/:providerId/test", async (request) => {
    const providerId = parameter(request, "providerId"); const provider = repository.getProvider(providerId); if (!provider) missing("provider", providerId);
    const body = object(request.body, "body"); const modelId = string(body.modelId, "modelId"); const kind = enumValue<"reasoning" | "image">(body.kind ?? "image", ["reasoning", "image"], "kind");
    const model = provider.models.find((candidate) => candidate.id === modelId); if (!model) throw new ApiError(400, "VALIDATION_ERROR", "modelId is not declared by the selected provider");
    if (kind === "image" && !model.imageApiKind) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected image model has no image API configured");
    try { const probe = await new OpenAiCompatibleImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) }).probe(); return { ok: true, providerId, modelId, kind, ...probe, modelAvailable: probe.models === null ? null : probe.models.includes(modelId) }; }
    catch (error) { if (error instanceof ProviderError) throw new ApiError(502, "PROVIDER_ERROR", error.message); throw error; }
  });
  app.delete("/api/v1/providers/:providerId", async (request, reply) => { const id = parameter(request, "providerId"); const result = repository.deleteProvider(id); if (result === "missing") missing("provider", id); if (result === "in_use") throw new ApiError(409, "CONFLICT", "Provider is used by a project and cannot be deleted"); return reply.code(204).send(); });

  app.get("/api/v1/projects", async () => ({ items: repository.listProjects(), nextCursor: null }));
  app.post("/api/v1/projects", async (request, reply) => {
    const body = object(request.body, "body"); const platformTargets = enumArray<PlatformTarget>(body.platformTargets, ["DOMESTIC", "AMAZON"], "platformTargets");
    const reasoningProviderId = string(body.reasoningProviderId, "reasoningProviderId"); const imageProviderId = string(body.imageProviderId, "imageProviderId");
    verifyModel(repository, reasoningProviderId, string(body.reasoningModelId, "reasoningModelId"), "reasoning"); verifyModel(repository, imageProviderId, string(body.imageModelId, "imageModelId"), "image");
    return reply.code(201).send(repository.createProject({ name: string(body.name, "name"), category: optionalString(body.category) ?? null, productDescription: optionalString(body.productDescription) ?? null, verifiedFacts: optionalStringArray(body.verifiedFacts) ?? [], prohibitedClaims: optionalStringArray(body.prohibitedClaims) ?? [], brandGuidelines: body.brandGuidelines === undefined ? {} : objectOfStrings(body.brandGuidelines, "brandGuidelines"), platformTargets, reasoningProviderId, reasoningModelId: string(body.reasoningModelId, "reasoningModelId"), imageProviderId, imageModelId: string(body.imageModelId, "imageModelId"), defaultMode: enumValue<StoryboardMode>(body.defaultMode, ["CREATIVE", "PIXEL_PROTECTED"], "defaultMode") }));
  });
  app.get("/api/v1/projects/:projectId", async (request) => projectDetail(repository, parameter(request, "projectId")));
  app.patch("/api/v1/projects/:projectId", async (request) => {
    const id = parameter(request, "projectId"); const body = object(request.body, "body"); const current = repository.getProject(id); if (!current) missing("project", id);
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = string(body.name, "name");
    if (body.category !== undefined) update.category = optionalString(body.category) ?? null;
    if (body.productDescription !== undefined) update.productDescription = optionalString(body.productDescription) ?? null;
    if (body.verifiedFacts !== undefined) update.verifiedFacts = stringArray(body.verifiedFacts, "verifiedFacts");
    if (body.prohibitedClaims !== undefined) update.prohibitedClaims = stringArray(body.prohibitedClaims, "prohibitedClaims");
    if (body.brandGuidelines !== undefined) update.brandGuidelines = objectOfStrings(body.brandGuidelines, "brandGuidelines");
    if (body.platformTargets !== undefined) update.platformTargets = enumArray<PlatformTarget>(body.platformTargets, ["DOMESTIC", "AMAZON"], "platformTargets");
    if (body.defaultMode !== undefined) update.defaultMode = enumValue<StoryboardMode>(body.defaultMode, ["CREATIVE", "PIXEL_PROTECTED"], "defaultMode");
    applyModelFields(body, update, (providerId, modelId, kind) => verifyModel(repository, providerId, modelId, kind));
    return repository.updateProject(id, update) as object;
  });
  app.post("/api/v1/projects/:projectId/variants", async (request) => {
    const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); const body = object(request.body, "body");
    return repository.createVariant(projectId, string(body.name, "name"), objectOfStrings(body.attributes ?? {}, "attributes"));
  });
  app.post("/api/v1/projects/:projectId/assets", async (request) => {
    const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); const data = await request.file(); if (!data) throw new ApiError(400, "VALIDATION_ERROR", "A file is required");
    if (!data.mimetype.startsWith("image/")) throw new ApiError(400, "VALIDATION_ERROR", "Only image files are supported");
    const fields = data.fields as Record<string, { value?: unknown }>;
    const role = enumValue<AssetRole>(fields.role?.value, ["PRODUCT_TRUTH", "PACKAGING", "STYLE_REFERENCE", "LAYOUT_REFERENCE"], "role");
    const variantId = optionalString(fields.variantId?.value) ?? null; if (variantId && (!repository.getVariant(variantId) || repository.getVariant(variantId)?.projectId !== projectId)) throw new ApiError(400, "VALIDATION_ERROR", "variantId does not belong to this project");
    const stored = await storage.putAsset(projectId, data.filename, await data.toBuffer());
    return repository.createAsset({ projectId, variantId, role, storagePath: stored.path, hash: stored.hash, originalName: data.filename, mimeType: data.mimetype, width: null, height: null });
  });
  // 先删文件再删行：行删了就找不到 storagePath；不级联分镜/输出/任务（契约 deleteAsset）
  app.delete("/api/v1/assets/:assetId", async (request, reply) => { const id = parameter(request, "assetId"); const asset = repository.getAsset(id); if (!asset) missing("asset", id); await storage.delete(asset.storagePath); repository.deleteAsset(id); return reply.code(204).send(); });
  app.post("/api/v1/projects/:projectId/planning-jobs", async (request, reply) => {
    const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); const body = object(request.body ?? {}, "body");
    const requestedTypes = optionalStringArray(body.requestedTypes); if (requestedTypes?.length && resolveTemplates(requestedTypes).length !== requestedTypes.length) throw new ApiError(400, "VALIDATION_ERROR", "requestedTypes contains an unknown ecom-details-image template ID or alias");
    const input = { requestedTypes, requestedCount: optionalNumber(body.requestedCount) }; const fingerprint = requestFingerprint({ type: "PLAN", projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null }); const existing = repository.findJobByFingerprint(projectId, fingerprint); if (existing) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    const project = repository.getProject(projectId); const job = repository.createJob({ id: randomUUID(), projectId, storyboardItemId: null, type: "PLAN", input, requestFingerprint: fingerprint, providerId: project?.reasoningProviderId ?? null, modelId: project?.reasoningModelId ?? null, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueue(queue, { jobId: job.id, kind: "plan" }); return reply.code(202).send(job);
  });
  app.get("/api/v1/projects/:projectId/storyboard", async (request) => {
    const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); return { storyboard: repository.getStoryboard(projectId) ?? null, items: repository.listStoryboardItems(projectId) };
  });
  app.patch("/api/v1/storyboard-items/:itemId", async (request) => {
    const itemId = parameter(request, "itemId"); const current = repository.getStoryboardItem(itemId); if (!current) missing("storyboard item", itemId); const body = object(request.body, "body");
    const patch: Record<string, unknown> = {};
    if (body.assetType !== undefined) { const templateId = string(body.assetType, "assetType"); if (!getTemplate(templateId)) throw new ApiError(400, "VALIDATION_ERROR", "assetType must be an ecom-details-image template ID"); patch.assetType = templateId; }
    if (body.templateVariant !== undefined) { const template = getTemplate(String(patch.assetType ?? current.assetType)); const variant = optionalString(body.templateVariant) ?? null; if (variant && !template?.variants[variant]) throw new ApiError(400, "VALIDATION_ERROR", "templateVariant is not declared by the selected ecom-details-image template"); patch.templateVariant = variant; }
    if (body.variantScope !== undefined) { const valid = new Set(["COMMON", ...repository.listVariants(current.projectId).map((variant) => variant.id)]); const value = string(body.variantScope, "variantScope"); if (!valid.has(value)) throw new ApiError(400, "VALIDATION_ERROR", "variantScope must be COMMON or a project variant ID"); patch.variantScope = value; }
    if (body.mode !== undefined) patch.mode = enumValue<StoryboardMode>(body.mode, ["CREATIVE", "PIXEL_PROTECTED"], "mode");
    if (body.promptInstruction !== undefined) patch.promptInstruction = string(body.promptInstruction, "promptInstruction");
    return repository.updateStoryboardItem(itemId, patch) as object;
  });
  app.post("/api/v1/projects/:projectId/storyboard/confirm", async (request) => { const projectId = parameter(request, "projectId"); const result = repository.confirmStoryboard(projectId); if (!result) throw new ApiError(409, "CONFLICT", "A draft storyboard must exist before confirmation"); return result; });
  app.post("/api/v1/projects/:projectId/generation-jobs", async (request, reply) => {
    const projectId = parameter(request, "projectId"); const storyboard = repository.getStoryboard(projectId); if (!storyboard || storyboard.status !== "CONFIRMED") throw new ApiError(409, "CONFLICT", "Confirm the storyboard before generation");
    const body = object(request.body, "body"); const itemIds = stringArray(body.storyboardItemIds, "storyboardItemIds"); if (itemIds.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "At least one storyboardItemId is required");
    const project = repository.getProject(projectId); const jobs = itemIds.map((itemId) => { const item = repository.getStoryboardItem(itemId); if (!item || item.projectId !== projectId) throw new ApiError(400, "VALIDATION_ERROR", "Storyboard item does not belong to this project"); const input = { revision: optionalString(body.revision) }; const fingerprint = requestFingerprint({ type: "GENERATE", projectId, itemId, storyboardVersion: storyboard.version, itemUpdatedAt: item.updatedAt, input, idempotencyKey: request.headers["idempotency-key"] ?? null }); const existing = repository.findJobByFingerprint(projectId, fingerprint); if (existing) return existing; return repository.createJob({ id: randomUUID(), projectId, storyboardItemId: itemId, type: "GENERATE", input, requestFingerprint: fingerprint, providerId: project?.imageProviderId ?? null, modelId: project?.imageModelId ?? null, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } }); });
    await Promise.all(jobs.map((job) => enqueue(queue, { jobId: job.id, kind: "generate" }))); return reply.code(202).send({ jobs });
  });
  app.get("/api/v1/jobs/:jobId", async (request) => { const job = repository.getJob(parameter(request, "jobId")); if (!job) missing("job", parameter(request, "jobId")); return job; });
  app.post("/api/v1/jobs/:jobId/cancel", async (request) => { const id = parameter(request, "jobId"); const current = repository.getJob(id); if (!current) missing("job", id); const queued = await queue.getJob(id); const state = queued ? await queued.getState() : "unknown"; if (queued && ["waiting", "delayed", "prioritized"].includes(state)) { await queued.remove(); return repository.updateJob(id, { status: "CANCELLED", cancelRequested: true }); } return repository.updateJob(id, { cancelRequested: true }); });
  app.post("/api/v1/jobs/:jobId/retry", async (request, reply) => { const id = parameter(request, "jobId"); const job = repository.getJob(id); if (!job) missing("job", id); if (!job.retryable) throw new ApiError(409, "CONFLICT", "This job cannot be retried"); const retry = repository.createJob({ id: randomUUID(), projectId: job.projectId, storyboardItemId: job.storyboardItemId, type: job.type, input: job.input }); await enqueue(queue, { jobId: retry.id, kind: retry.type.toLowerCase() as "plan" | "generate" | "export" }); return reply.code(202).send(retry); });
  app.get("/api/v1/projects/:projectId/outputs", async (request) => repository.listOutputs(parameter(request, "projectId")));
  app.patch("/api/v1/outputs/:outputId/review", async (request) => { const body = object(request.body, "body"); const result = repository.reviewOutput(parameter(request, "outputId"), enumValue<OutputReviewDecision>(body.reviewDecision, ["SELECTED", "REJECTED", "NEEDS_REVIEW"], "reviewDecision"), optionalString(body.reviewNote) ?? null); if (!result) missing("output", parameter(request, "outputId")); return result; });
  app.post("/api/v1/projects/:projectId/export-jobs", async (request, reply) => { const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); const body = object(request.body ?? {}, "body"); const input = { outputIds: optionalStringArray(body.outputIds), filenamePrefix: optionalString(body.filenamePrefix) }; const fingerprint = requestFingerprint({ type: "EXPORT", projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null }); const existing = repository.findJobByFingerprint(projectId, fingerprint); if (existing) { const exportRecord = repository.getExportByJobId(existing.id); return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send({ job: existing, export: exportRecord ?? null }); } const job = repository.createJob({ id: randomUUID(), projectId, storyboardItemId: null, type: "EXPORT", input, requestFingerprint: fingerprint, estimatedCost: { status: "UNKNOWN", unit: "local-storage" } }); const exportRecord = repository.createExport({ projectId, jobId: job.id, status: "QUEUED", storagePath: null }); await enqueue(queue, { jobId: job.id, kind: "export" }); return reply.code(202).send({ job, export: exportRecord }); });
  app.get("/api/v1/exports/:exportId", async (request) => { const result = repository.getExport(parameter(request, "exportId")); if (!result) missing("export", parameter(request, "exportId")); return result; });
  app.get("/api/v1/files/assets/:assetId", async (request, reply) => sendStored(reply, storage, repository.getAsset(parameter(request, "assetId")), "asset"));
  app.get("/api/v1/files/outputs/:outputId", async (request, reply) => sendStored(reply, storage, repository.getOutput(parameter(request, "outputId")), "output"));
  app.get("/api/v1/files/exports/:exportId", async (request, reply) => sendStored(reply, storage, repository.getExport(parameter(request, "exportId")), "export"));
  app.get("/api/v1/events", { sse: "only" }, async (request, reply) => {
    const projectId = typeof request.query === "object" && request.query && "projectId" in request.query ? String((request.query as Record<string, unknown>).projectId) : ""; if (!projectId) throw new ApiError(400, "VALIDATION_ERROR", "projectId query parameter is required"); ensureProject(repository, projectId);
    reply.sse.keepAlive(); const unsubscribe = await events.subscribe(projectId, (event) => { void reply.sse.send({ id: event.id, event: event.type, data: event }); }); reply.sse.onClose(() => { void unsubscribe(); }); await reply.sse.send({ event: "connected", data: { projectId } });
  });
  return app;
}

function publicProvider(value: ProviderRecord): object { const { encryptedApiKey, ...provider } = value; return { ...provider, hasApiKey: Boolean(encryptedApiKey) }; }
function projectDetail(repository: EcomRepository, id: string): object { const project = repository.getProject(id); if (!project) missing("project", id); return { ...project, variants: repository.listVariants(id), assets: repository.listAssets(id), storyboard: repository.getStoryboard(id), items: repository.listStoryboardItems(id), outputs: repository.listOutputs(id), jobs: repository.listJobs(id) }; }
function verifyModel(repository: EcomRepository, providerId: string, modelId: string, kind: "reasoning" | "image"): void { const provider = repository.getProvider(providerId); if (!provider) missing("provider", providerId); const model = provider.models.find((candidate) => candidate.id === modelId); if (!model) throw new ApiError(400, "VALIDATION_ERROR", `${kind} model is not declared by the selected provider`); if (kind === "image" && !model.imageApiKind) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected image model has no image API configured"); }
function ensureProject(repository: EcomRepository, id: string): void { if (!repository.getProject(id)) missing("project", id); }
function missing(resource: string, id: string): never { throw new ApiError(404, "NOT_FOUND", `${resource} not found: ${id}`); }
function parameter(request: FastifyRequest, name: string): string { const value = (request.params as Record<string, unknown>)[name]; return string(value, name); }
function object(value: unknown, path: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "VALIDATION_ERROR", `${path} must be an object`); return value as Record<string, unknown>; }
function string(value: unknown, path: string): string { if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "VALIDATION_ERROR", `${path} must be a non-empty string`); return value.trim(); }
function optionalString(value: unknown): string | undefined { return value === undefined || value === null || value === "" ? undefined : string(value, "value"); }
function optionalNumber(value: unknown): number | undefined { if (value === undefined || value === null) return undefined; if (typeof value !== "number" || !Number.isFinite(value) || value < 1) throw new ApiError(400, "VALIDATION_ERROR", "requestedCount must be a positive number"); return value; }
function stringArray(value: unknown, path: string): string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new ApiError(400, "VALIDATION_ERROR", `${path} must be an array of strings`); return value as string[]; }
function optionalStringArray(value: unknown): string[] | undefined { return value === undefined ? undefined : stringArray(value, "value"); }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T { const item = string(value, path) as T; if (!allowed.includes(item)) throw new ApiError(400, "VALIDATION_ERROR", `${path} must be one of ${allowed.join(", ")}`); return item; }
function enumArray<T extends string>(value: unknown, allowed: readonly T[], path: string): T[] { const items = stringArray(value, path).map((item) => enumValue<T>(item, allowed, path)); return [...new Set(items)]; }
function objectOfStrings(value: unknown, path: string): Record<string, string> { const result = object(value, path); for (const [key, item] of Object.entries(result)) if (typeof item !== "string") throw new ApiError(400, "VALIDATION_ERROR", `${path}.${key} must be a string`); return result as Record<string, string>; }
function requireModels(value: unknown): ModelDefinition[] { if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "models must contain at least one model"); return value.map((model, index) => { const entry = object(model, `models[${index}]`); return { id: string(entry.id, `models[${index}].id`), supportsVision: Boolean(entry.supportsVision), supportsTools: Boolean(entry.supportsTools), supportsStructuredOutput: Boolean(entry.supportsStructuredOutput), imageApiKind: entry.imageApiKind === "openai_images" || entry.imageApiKind === "custom" ? entry.imageApiKind : null }; }); }
async function sendStored(reply: FastifyReply, storage: LocalAssetStore, record: { storagePath: string | null; mimeType?: string } | undefined, name: string): Promise<unknown> { if (!record || !record.storagePath) missing(name, "unknown"); return reply.type(record.mimeType ?? mimeForPath(record.storagePath)).send(await storage.read(record.storagePath)); }
function mimeForPath(path: string): string { if (path.endsWith(".png")) return "image/png"; if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"; if (path.endsWith(".webp")) return "image/webp"; if (path.endsWith(".zip")) return "application/zip"; return "application/octet-stream"; }
