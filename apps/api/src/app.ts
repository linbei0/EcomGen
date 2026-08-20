import { randomUUID } from "node:crypto";
import { join } from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { fastifySSE } from "@fastify/sse";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { EcomRepository, LocalAssetStore, SecretBox, openDatabase, requestFingerprint, type ProviderRecord, type SearchSourceRecord } from "@ecomgen/core";
import { ECOM_DETAILS_IMAGE_SOURCE, ECOM_TEMPLATES, getTemplate, resolveTemplates } from "@ecomgen/ecom-skill";
import { createJobQueue, createRedisConnection, enqueue, RedisProjectEventBus } from "@ecomgen/jobs";
import type { AssetRole, ImageAspectRatio, ImageResolution, ModelDefinition, OutputReviewDecision, PlanningMode, PlatformTarget, ReasoningProtocolProfile, SearchSourceKind, StoryboardMode, TargetMarket, UserAssetKind } from "@ecomgen/contracts";
import { DEFAULT_CANDIDATES_PER_TYPE, DEFAULT_IMAGE_ASPECT_RATIO, DEFAULT_IMAGE_RESOLUTION, IMAGE_ASPECT_RATIOS, IMAGE_RESOLUTIONS, MAX_CANDIDATES_PER_TYPE, roleForUserAssetKind } from "@ecomgen/contracts";
import { OpenAiCompatibleImageProvider, ProviderError, probeReasoning } from "@ecomgen/providers";

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

  app.get("/health", async () => ({ status: "ok", webResearchAvailable: repository.listSearchSources().some((source) => source.enabled && (source.kind === "searxng" || source.encryptedApiKey)) }));
  app.get("/api/v1/ecom-templates", async () => ({ source: ECOM_DETAILS_IMAGE_SOURCE, items: ECOM_TEMPLATES }));
  app.get("/api/v1/providers", async () => ({ items: repository.listProviders().map(publicProvider), nextCursor: null }));
  app.post("/api/v1/providers", async (request, reply) => {
    const body = object(request.body, "body");
    const models = requireModels(body.models);
    const apiKey = string(body.apiKey, "apiKey");
    const reasoningProtocol = enumValue<ReasoningProtocolProfile>(body.reasoningProtocol ?? "openai", ["openai", "dashscope_qwen"], "reasoningProtocol");
    const record = repository.saveProvider({ name: string(body.name, "name"), baseUrl: string(body.baseUrl, "baseUrl"), reasoningProtocol, encryptedApiKey: secrets.encrypt(apiKey), models });
    await events.publish("system", "provider.updated", publicProvider(record)); return reply.code(201).send(publicProvider(record));
  });
  app.patch("/api/v1/providers/:providerId", async (request) => {
    const id = parameter(request, "providerId"); const current = repository.getProvider(id); if (!current) missing("provider", id);
    const body = object(request.body, "body");
    const reasoningProtocol = body.reasoningProtocol === undefined ? current.reasoningProtocol : enumValue<ReasoningProtocolProfile>(body.reasoningProtocol, ["openai", "dashscope_qwen"], "reasoningProtocol");
    const record = repository.saveProvider({ id, name: optionalString(body.name) ?? current.name, baseUrl: optionalString(body.baseUrl) ?? current.baseUrl, reasoningProtocol, encryptedApiKey: body.apiKey ? secrets.encrypt(string(body.apiKey, "apiKey")) : current.encryptedApiKey, models: body.models ? requireModels(body.models) : current.models });
    await events.publish("system", "provider.updated", publicProvider(record)); return publicProvider(record);
  });
  app.post("/api/v1/providers/:providerId/test", async (request) => {
    const providerId = parameter(request, "providerId"); const provider = repository.getProvider(providerId); if (!provider) missing("provider", providerId);
    const body = object(request.body, "body"); const modelId = string(body.modelId, "modelId"); const kind = enumValue<"reasoning" | "image">(body.kind ?? "image", ["reasoning", "image"], "kind");
    const model = provider.models.find((candidate) => candidate.id === modelId); if (!model) throw new ApiError(400, "VALIDATION_ERROR", "modelId is not declared by the selected provider");
    if (kind === "image" && !model.imageApiKind) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected image model has no image API configured");
    try {
      if (kind === "reasoning") {
        const probeModel = model;
        const probe = await probeReasoning({ providerId, modelId, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: probeModel.supportsVision, supportsThinking: probeModel.supportsThinking, apiKey: secrets.decrypt(provider.encryptedApiKey) });
        return { ok: true, providerId, modelId, kind, latencyMs: probe.latencyMs, models: null, modelAvailable: true };
      }
      const probe = await new OpenAiCompatibleImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) }).probe(); return { ok: true, providerId, modelId, kind, ...probe, modelAvailable: probe.models === null ? null : probe.models.includes(modelId) };
    }
    catch (error) { if (error instanceof ProviderError) throw new ApiError(502, "PROVIDER_ERROR", error.message); throw error; }
  });
  app.delete("/api/v1/providers/:providerId", async (request, reply) => { const id = parameter(request, "providerId"); const result = repository.deleteProvider(id); if (result === "missing") missing("provider", id); if (result === "in_use") throw new ApiError(409, "CONFLICT", "Provider is used by a project and cannot be deleted"); return reply.code(204).send(); });

  app.get("/api/v1/search-sources", async () => ({ items: repository.listSearchSources().map(publicSearchSource), nextCursor: null }));
  app.post("/api/v1/search-sources", async (request, reply) => {
    const body = object(request.body, "body");
    const kind = enumValue<SearchSourceKind>(body.kind, ["brave", "tavily", "searxng"], "kind");
    const apiKey = optionalString(body.apiKey);
    if (kind !== "searxng" && !apiKey) throw new ApiError(400, "VALIDATION_ERROR", "apiKey is required for this search source");
    const record = repository.saveSearchSource({ name: string(body.name, "name"), kind, baseUrl: searchSourceBaseUrl(kind, optionalString(body.baseUrl)), encryptedApiKey: apiKey ? secrets.encrypt(apiKey) : null, priority: priorityValue(body.priority), enabled: body.enabled === undefined ? true : booleanValue(body.enabled, "enabled") });
    return reply.code(201).send(publicSearchSource(record));
  });
  app.patch("/api/v1/search-sources/:sourceId", async (request) => {
    const id = parameter(request, "sourceId"); const current = repository.getSearchSource(id); if (!current) missing("search source", id);
    const body = object(request.body, "body");
    const kind = body.kind === undefined ? current.kind : enumValue<SearchSourceKind>(body.kind, ["brave", "tavily", "searxng"], "kind");
    const apiKey = optionalString(body.apiKey);
    const encryptedApiKey = apiKey ? secrets.encrypt(apiKey) : current.encryptedApiKey;
    if (kind !== "searxng" && !encryptedApiKey) throw new ApiError(400, "VALIDATION_ERROR", "apiKey is required for this search source");
    return publicSearchSource(repository.saveSearchSource({ id, name: optionalString(body.name) ?? current.name, kind, baseUrl: searchSourceBaseUrl(kind, optionalString(body.baseUrl) ?? current.baseUrl), encryptedApiKey, priority: body.priority === undefined ? current.priority : priorityValue(body.priority), enabled: body.enabled === undefined ? current.enabled : booleanValue(body.enabled, "enabled") }));
  });
  app.delete("/api/v1/search-sources/:sourceId", async (request, reply) => { const id = parameter(request, "sourceId"); if (!repository.deleteSearchSource(id)) missing("search source", id); return reply.code(204).send(); });

  app.get("/api/v1/projects", async () => {
    const projects = repository.listProjects();
    const covers = repository.listProjectCovers(projects.map((project) => project.id));
    return {
      items: projects.map((project) => ({ ...project, cover: covers.get(project.id) ?? { productAssetId: null, coverOutputId: null, previewOutputIds: [], outputCount: 0 } })),
      nextCursor: null
    };
  });
  app.post("/api/v1/projects", async (request, reply) => {
    const body = object(request.body, "body"); const platformTargets = platformTargetsValue(body.platformTargets);
    const reasoningProviderId = string(body.reasoningProviderId, "reasoningProviderId"); const imageProviderId = string(body.imageProviderId, "imageProviderId");
    verifyModel(repository, reasoningProviderId, string(body.reasoningModelId, "reasoningModelId"), "reasoning"); verifyModel(repository, imageProviderId, string(body.imageModelId, "imageModelId"), "image");
    return reply.code(201).send(repository.createProject({
      name: string(body.name, "name"),
      category: optionalString(body.category) ?? null,
      productDescription: optionalString(body.productDescription) ?? null,
      verifiedFacts: optionalStringArray(body.verifiedFacts) ?? [],
      prohibitedClaims: optionalStringArray(body.prohibitedClaims) ?? [],
      brandGuidelines: body.brandGuidelines === undefined ? {} : objectOfStrings(body.brandGuidelines, "brandGuidelines"),
      platformTargets,
      targetMarket: targetMarketValue(body.targetMarket),
      copyLanguage: copyLanguageValue(body.copyLanguage),
      reasoningProviderId,
      reasoningModelId: string(body.reasoningModelId, "reasoningModelId"),
      imageProviderId,
      imageModelId: string(body.imageModelId, "imageModelId"),
      defaultMode: enumValue<StoryboardMode>(body.defaultMode, ["CREATIVE", "PIXEL_PROTECTED"], "defaultMode"),
      imageResolution: body.imageResolution === undefined ? DEFAULT_IMAGE_RESOLUTION : enumValue<ImageResolution>(body.imageResolution, IMAGE_RESOLUTIONS, "imageResolution"),
      imageAspectRatio: body.imageAspectRatio === undefined ? DEFAULT_IMAGE_ASPECT_RATIO : enumValue<ImageAspectRatio>(body.imageAspectRatio, IMAGE_ASPECT_RATIOS, "imageAspectRatio"),
      candidatesPerType: body.candidatesPerType === undefined ? DEFAULT_CANDIDATES_PER_TYPE : candidatesPerType(body.candidatesPerType),
      webResearchEnabled: body.webResearchEnabled === undefined ? false : booleanValue(body.webResearchEnabled, "webResearchEnabled")
    }));
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
    if (body.platformTargets !== undefined) update.platformTargets = platformTargetsValue(body.platformTargets);
    if (body.targetMarket !== undefined) update.targetMarket = targetMarketValue(body.targetMarket);
    if (body.copyLanguage !== undefined) update.copyLanguage = copyLanguageValue(body.copyLanguage);
    if (body.defaultMode !== undefined) update.defaultMode = enumValue<StoryboardMode>(body.defaultMode, ["CREATIVE", "PIXEL_PROTECTED"], "defaultMode");
    if (body.imageResolution !== undefined) update.imageResolution = enumValue<ImageResolution>(body.imageResolution, IMAGE_RESOLUTIONS, "imageResolution");
    if (body.imageAspectRatio !== undefined) update.imageAspectRatio = enumValue<ImageAspectRatio>(body.imageAspectRatio, IMAGE_ASPECT_RATIOS, "imageAspectRatio");
    if (body.candidatesPerType !== undefined) update.candidatesPerType = candidatesPerType(body.candidatesPerType);
    if (body.webResearchEnabled !== undefined) update.webResearchEnabled = booleanValue(body.webResearchEnabled, "webResearchEnabled");
    applyModelFields(body, update, (providerId, modelId, kind) => verifyModel(repository, providerId, modelId, kind));
    return repository.updateProject(id, update) as object;
  });
  app.post("/api/v1/projects/:projectId/assets", async (request) => {
    const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); const data = await request.file(); if (!data) throw new ApiError(400, "VALIDATION_ERROR", "A file is required");
    if (!data.mimetype.startsWith("image/")) throw new ApiError(400, "VALIDATION_ERROR", "Only image files are supported");
    const fields = data.fields as Record<string, { value?: unknown }>;
    const role = parseAssetRole(fields.kind?.value ?? fields.role?.value);
    const stored = await storage.putAsset(projectId, data.filename, await data.toBuffer());
    return repository.createAsset({ projectId, role, storagePath: stored.path, hash: stored.hash, originalName: data.filename, mimeType: data.mimetype, width: null, height: null });
  });
  // 先删文件再删行：行删了就找不到 storagePath；不级联分镜/输出/任务（契约 deleteAsset）
  app.delete("/api/v1/assets/:assetId", async (request, reply) => { const id = parameter(request, "assetId"); const asset = repository.getAsset(id); if (!asset) missing("asset", id); await storage.delete(asset.storagePath); repository.deleteAsset(id); return reply.code(204).send(); });
  app.post("/api/v1/projects/:projectId/planning-jobs", async (request, reply) => {
    const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); const body = object(request.body ?? {}, "body");
    const requestedTypes = optionalStringArray(body.requestedTypes ?? body.imageTypes); if (requestedTypes?.length && resolveTemplates(requestedTypes).length !== requestedTypes.length) throw new ApiError(400, "VALIDATION_ERROR", "requestedTypes contains an unknown ecom-details-image template ID or alias");
    const planningMode = body.planningMode === undefined ? "AI" : enumValue<PlanningMode>(body.planningMode, ["AI", "MANUAL"], "planningMode");
    if (planningMode === "MANUAL" && !requestedTypes?.length) throw new ApiError(400, "VALIDATION_ERROR", "MANUAL planning requires requestedTypes");
    const input = {
      planningMode,
      requestedTypes,
      userInstruction: optionalString(body.userInstruction),
      candidatesPerType: body.candidatesPerType === undefined ? undefined : candidatesPerType(body.candidatesPerType),
      imageResolution: body.imageResolution === undefined ? undefined : enumValue<ImageResolution>(body.imageResolution, IMAGE_RESOLUTIONS, "imageResolution"),
      imageAspectRatio: body.imageAspectRatio === undefined ? undefined : enumValue<ImageAspectRatio>(body.imageAspectRatio, IMAGE_ASPECT_RATIOS, "imageAspectRatio"),
      regenerationKey: optionalString(body.regenerationKey)
    };
    const fingerprint = requestFingerprint({ type: "PLAN", projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null }); const existing = repository.findJobByFingerprint(projectId, fingerprint); if (existing) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    const project = repository.getProject(projectId); const job = repository.createJob({ id: randomUUID(), projectId, storyboardItemId: null, type: "PLAN", input, requestFingerprint: fingerprint, providerId: project?.reasoningProviderId ?? null, modelId: project?.reasoningModelId ?? null, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueue(queue, { jobId: job.id, kind: "plan" }); return reply.code(202).send(job);
  });
  app.get("/api/v1/projects/:projectId/storyboard", async (request) => {
    const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); return { storyboard: repository.getStoryboard(projectId) ?? null, items: repository.listStoryboardItems(projectId) };
  });
  app.patch("/api/v1/storyboard-items/:itemId", async (request) => {
    const itemId = parameter(request, "itemId"); const current = repository.getStoryboardItem(itemId); if (!current) missing("storyboard item", itemId); const body = object(request.body, "body");
    const patch: Record<string, unknown> = {};
    if (body.assetType !== undefined) {
      const templateId = string(body.assetType, "assetType");
      if (templateId !== current.assetType) throw new ApiError(409, "CONFLICT", "Storyboard item image type is immutable");
      if (!getTemplate(templateId)) throw new ApiError(400, "VALIDATION_ERROR", "assetType must be an ecom-details-image template ID");
    }
    if (body.displayName !== undefined) patch.displayName = string(body.displayName, "displayName");
    if (body.templateVariant !== undefined) { const template = getTemplate(String(patch.assetType ?? current.assetType)); const variant = optionalString(body.templateVariant) ?? null; if (variant && !template?.variants[variant]) throw new ApiError(400, "VALIDATION_ERROR", "templateVariant is not declared by the selected ecom-details-image template"); patch.templateVariant = variant; }
    if (body.candidateCount !== undefined) patch.candidateCount = candidatesPerType(body.candidateCount);
    if (body.referencedAssets !== undefined) {
      const ids = stringArray(body.referencedAssets, "referencedAssets");
      const known = new Set(repository.listAssets(current.projectId).map((asset) => asset.id));
      if (ids.some((id) => !known.has(id))) throw new ApiError(400, "VALIDATION_ERROR", "referencedAssets must belong to this project");
      patch.referencedAssets = ids;
    }
    if (body.mode !== undefined) patch.mode = enumValue<StoryboardMode>(body.mode, ["CREATIVE", "PIXEL_PROTECTED"], "mode");
    if (body.promptInstruction !== undefined) patch.promptInstruction = string(body.promptInstruction, "promptInstruction");
    return repository.updateStoryboardItem(itemId, patch) as object;
  });
  app.delete("/api/v1/storyboard-items/:itemId", async (request, reply) => {
    const itemId = parameter(request, "itemId");
    const current = repository.getStoryboardItem(itemId);
    if (!current) missing("storyboard item", itemId);
    if (current.status !== "DRAFT") throw new ApiError(409, "CONFLICT", "Only draft storyboard items can be deleted");
    repository.deleteStoryboardItem(itemId);
    return reply.code(204).send();
  });
  app.post("/api/v1/projects/:projectId/storyboard/confirm", async (request) => { const projectId = parameter(request, "projectId"); const result = repository.confirmStoryboard(projectId); if (!result) throw new ApiError(409, "CONFLICT", "A draft storyboard must exist before confirmation"); return result; });
  app.post("/api/v1/projects/:projectId/generation-jobs", async (request, reply) => {
    const projectId = parameter(request, "projectId"); const storyboard = repository.getStoryboard(projectId); if (!storyboard || storyboard.status !== "CONFIRMED") throw new ApiError(409, "CONFLICT", "Confirm the storyboard before generation");
    const body = object(request.body, "body"); const itemIds = stringArray(body.storyboardItemIds, "storyboardItemIds"); if (itemIds.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "At least one storyboardItemId is required");
    const project = repository.getProject(projectId); if (!project) missing("project", projectId);
    const jobs = itemIds.flatMap((itemId) => {
      const item = repository.getStoryboardItem(itemId); if (!item || item.projectId !== projectId) throw new ApiError(400, "VALIDATION_ERROR", "Storyboard item does not belong to this project");
      const candidateCount = clampCandidates(item.candidateCount);
      return Array.from({ length: candidateCount }, (_, index) => {
        const input = {
          revision: optionalString(body.revision),
          candidateIndex: index + 1,
          imageResolution: project.imageResolution,
          imageAspectRatio: project.imageAspectRatio
        };
        const fingerprint = requestFingerprint({ type: "GENERATE", projectId, itemId, storyboardVersion: storyboard.version, itemUpdatedAt: item.updatedAt, input, idempotencyKey: request.headers["idempotency-key"] ?? null });
        const existing = repository.findJobByFingerprint(projectId, fingerprint);
        if (existing) return existing;
        return repository.createJob({ id: randomUUID(), projectId, storyboardItemId: itemId, type: "GENERATE", input, requestFingerprint: fingerprint, providerId: project.imageProviderId, modelId: project.imageModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
      });
    });
    await Promise.all(jobs.map((job) => enqueue(queue, { jobId: job.id, kind: "generate" }))); return reply.code(202).send({ jobs });
  });
  app.get("/api/v1/jobs/:jobId", async (request) => { const job = repository.getJob(parameter(request, "jobId")); if (!job) missing("job", parameter(request, "jobId")); return job; });
  app.post("/api/v1/jobs/:jobId/cancel", async (request) => { const id = parameter(request, "jobId"); const current = repository.getJob(id); if (!current) missing("job", id); const queued = await queue.getJob(id); const state = queued ? await queued.getState() : "unknown"; if (queued && ["waiting", "delayed", "prioritized"].includes(state)) { await queued.remove(); return repository.updateJob(id, { status: "CANCELLED", cancelRequested: true }); } return repository.updateJob(id, { cancelRequested: true }); });
  app.post("/api/v1/jobs/:jobId/retry", async (request, reply) => { const id = parameter(request, "jobId"); const job = repository.getJob(id); if (!job) missing("job", id); if (!job.retryable) throw new ApiError(409, "CONFLICT", "This job cannot be retried"); const retry = repository.createJob({ id: randomUUID(), projectId: job.projectId, storyboardItemId: job.storyboardItemId, type: job.type, input: job.input }); await enqueue(queue, { jobId: retry.id, kind: retry.type.toLowerCase() as "plan" | "generate" | "export" }); return reply.code(202).send(retry); });
  app.get("/api/v1/projects/:projectId/outputs", async (request) => repository.listOutputs(parameter(request, "projectId")));
  app.patch("/api/v1/outputs/:outputId/review", async (request) => { const body = object(request.body, "body"); const result = repository.reviewOutput(parameter(request, "outputId"), enumValue<OutputReviewDecision>(body.reviewDecision ?? body.decision, ["SELECTED", "REJECTED", "NEEDS_REVIEW"], "reviewDecision"), optionalString(body.reviewNote ?? body.note) ?? null); if (!result) missing("output", parameter(request, "outputId")); return result; });
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
function publicSearchSource(value: SearchSourceRecord): object { const { encryptedApiKey, ...source } = value; return { ...source, hasApiKey: Boolean(encryptedApiKey) }; }
function projectDetail(repository: EcomRepository, id: string): object { const project = repository.getProject(id); if (!project) missing("project", id); return { ...project, assets: repository.listAssets(id), storyboard: repository.getStoryboard(id), items: repository.listStoryboardItems(id), outputs: repository.listOutputs(id), jobs: repository.listJobs(id) }; }
function parseAssetRole(value: unknown): AssetRole {
  if (value === "PRODUCT" || value === "REFERENCE") return roleForUserAssetKind(value as UserAssetKind);
  return enumValue<AssetRole>(value, ["PRODUCT_TRUTH", "PACKAGING", "STYLE_REFERENCE", "LAYOUT_REFERENCE"], "role");
}
function candidatesPerType(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_CANDIDATES_PER_TYPE) throw new ApiError(400, "VALIDATION_ERROR", `candidatesPerType must be an integer between 1 and ${MAX_CANDIDATES_PER_TYPE}`);
  return count;
}
function clampCandidates(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CANDIDATES_PER_TYPE, Math.max(1, Math.round(value)));
}
function verifyModel(repository: EcomRepository, providerId: string, modelId: string, kind: "reasoning" | "image"): void { const provider = repository.getProvider(providerId); if (!provider) missing("provider", providerId); const model = provider.models.find((candidate) => candidate.id === modelId); if (!model) throw new ApiError(400, "VALIDATION_ERROR", `${kind} model is not declared by the selected provider`); if (kind === "image" && !model.imageApiKind) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected image model has no image API configured"); }
function ensureProject(repository: EcomRepository, id: string): void { if (!repository.getProject(id)) missing("project", id); }
function missing(resource: string, id: string): never { throw new ApiError(404, "NOT_FOUND", `${resource} not found: ${id}`); }
function parameter(request: FastifyRequest, name: string): string { const value = (request.params as Record<string, unknown>)[name]; return string(value, name); }
function object(value: unknown, path: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "VALIDATION_ERROR", `${path} must be an object`); return value as Record<string, unknown>; }
function string(value: unknown, path: string): string { if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "VALIDATION_ERROR", `${path} must be a non-empty string`); return value.trim(); }
function optionalString(value: unknown): string | undefined { return value === undefined || value === null || value === "" ? undefined : string(value, "value"); }
function booleanValue(value: unknown, path: string): boolean { if (typeof value !== "boolean") throw new ApiError(400, "VALIDATION_ERROR", `${path} must be a boolean`); return value; }
function priorityValue(value: unknown): number { const priority = typeof value === "number" ? value : Number(value); if (!Number.isInteger(priority) || priority < 0 || priority > 100_000) throw new ApiError(400, "VALIDATION_ERROR", "priority must be an integer between 0 and 100000"); return priority; }
function searchSourceBaseUrl(kind: SearchSourceKind, value: string | undefined): string {
  const baseUrl = value ?? (kind === "brave" ? "https://api.search.brave.com/res/v1/web/search" : kind === "tavily" ? "https://api.tavily.com/search" : "http://127.0.0.1:8080/search");
  try { new URL(baseUrl); } catch { throw new ApiError(400, "VALIDATION_ERROR", "baseUrl must be a valid URL"); }
  return baseUrl;
}

function stringArray(value: unknown, path: string): string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new ApiError(400, "VALIDATION_ERROR", `${path} must be an array of strings`); return value as string[]; }
function optionalStringArray(value: unknown): string[] | undefined { return value === undefined ? undefined : stringArray(value, "value"); }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T { const item = string(value, path) as T; if (!allowed.includes(item)) throw new ApiError(400, "VALIDATION_ERROR", `${path} must be one of ${allowed.join(", ")}`); return item; }
function enumArray<T extends string>(value: unknown, allowed: readonly T[], path: string): T[] { const items = stringArray(value, path).map((item) => enumValue<T>(item, allowed, path)); return [...new Set(items)]; }
function platformTargetsValue(value: unknown): PlatformTarget[] {
  const targets = value === undefined || value === null ? [] : enumArray<PlatformTarget>(value, ["DOMESTIC", "AMAZON"], "platformTargets");
  if (targets.length > 1) throw new ApiError(400, "VALIDATION_ERROR", "platformTargets must contain at most one target");
  return targets;
}
function targetMarketValue(value: unknown): TargetMarket | null {
  if (value === undefined || value === null || value === "") return null;
  return enumValue<TargetMarket>(value, ["CHINA_MAINLAND", "HONG_KONG", "MACAU", "TAIWAN", "UNITED_STATES", "UNITED_KINGDOM", "GERMANY", "FRANCE", "ITALY", "SPAIN", "JAPAN", "SOUTH_KOREA"], "targetMarket");
}
function copyLanguageValue(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const language = string(value, "copyLanguage");
  if (language.length > 64) throw new ApiError(400, "VALIDATION_ERROR", "copyLanguage must contain 1 to 64 characters");
  return language;
}
function objectOfStrings(value: unknown, path: string): Record<string, string> { const result = object(value, path); for (const [key, item] of Object.entries(result)) if (typeof item !== "string") throw new ApiError(400, "VALIDATION_ERROR", `${path}.${key} must be a string`); return result as Record<string, string>; }
function requireModels(value: unknown): ModelDefinition[] { if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "models must contain at least one model"); return value.map((model, index) => { const entry = object(model, `models[${index}]`); return { id: string(entry.id, `models[${index}].id`), supportsVision: Boolean(entry.supportsVision), supportsThinking: Boolean(entry.supportsThinking), supportsTools: Boolean(entry.supportsTools), supportsStructuredOutput: Boolean(entry.supportsStructuredOutput), imageApiKind: entry.imageApiKind === "openai_images" || entry.imageApiKind === "custom" ? entry.imageApiKind : null }; }); }
async function sendStored(reply: FastifyReply, storage: LocalAssetStore, record: { storagePath: string | null; mimeType?: string } | undefined, name: string): Promise<unknown> { if (!record || !record.storagePath) missing(name, "unknown"); return reply.type(record.mimeType ?? mimeForPath(record.storagePath)).send(await storage.read(record.storagePath)); }
function mimeForPath(path: string): string { if (path.endsWith(".png")) return "image/png"; if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"; if (path.endsWith(".webp")) return "image/webp"; if (path.endsWith(".zip")) return "application/zip"; return "application/octet-stream"; }
