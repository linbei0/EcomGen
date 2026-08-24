import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { fastifySSE } from "@fastify/sse";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { EcomRepository, LocalAssetStore, SecretBox, openDatabase, requestFingerprint, type AssetRecord, type EditReferenceAssetRecord, type EditSessionRecord, type ProjectRecord, type ProviderRecord, type SearchSourceRecord } from "@ecomgen/core";
import { ECOM_DETAILS_IMAGE_SOURCE, ECOM_TEMPLATES, getTemplate, resolveTemplates } from "@ecomgen/ecom-skill";
import { createJobQueue, createRedisConnection, enqueue, RedisProjectEventBus, type EcomJobKind } from "@ecomgen/jobs";
import type { AssetRole, CopywritingTarget, ImageAspectRatio, ImageResolution, JobType, ModelDefinition, PlanningMode, PlatformTarget, ReasoningProtocolProfile, SearchSourceKind, StoryboardMode, TargetMarket, UserAssetKind, ReferencePurpose, ReferenceSelection } from "@ecomgen/contracts";
import { DEFAULT_CANDIDATES_PER_TYPE, DEFAULT_IMAGE_ASPECT_RATIO, DEFAULT_IMAGE_RESOLUTION, DEFAULT_TARGET_IMAGE_COUNT, IMAGE_ASPECT_RATIOS, IMAGE_RESOLUTIONS, MAX_CANDIDATES_PER_TYPE, MAX_GENERATION_REFERENCE_IMAGES, MAX_PRODUCT_IMAGE_ASSETS, MAX_REFERENCE_IMAGE_ASSETS, MAX_TARGET_IMAGE_COUNT, MIN_TARGET_IMAGE_COUNT, roleForUserAssetKind } from "@ecomgen/contracts";
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

  app.get("/api/v1/projects", async (request) => {
    const query = typeof request.query === "object" && request.query ? request.query as Record<string, unknown> : {};
    const archivedValue = query.archived;
    const archived = archivedValue === undefined
      ? false
      : archivedValue === true || archivedValue === "true"
        ? true
        : archivedValue === false || archivedValue === "false"
          ? false
          : booleanValue(archivedValue, "archived");
    const projects = repository.listProjects(archived);
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
    if (body.archived !== undefined) update.archivedAt = booleanValue(body.archived, "archived") ? new Date().toISOString() : null;
    applyModelFields(body, update, (providerId, modelId, kind) => verifyModel(repository, providerId, modelId, kind));
    return repository.updateProject(id, update) as object;
  });
  app.delete("/api/v1/projects/:projectId", async (request, reply) => {
    const id = parameter(request, "projectId");
    const project = repository.getProject(id);
    if (!project) {
      // DELETE 保持幂等，并补清上一次数据库已删除但文件清理失败留下的目录。
      await storage.deleteProject(id);
      return reply.code(204).send();
    }
    if (!project.archivedAt) throw new ApiError(409, "CONFLICT", "Only archived projects can be deleted");
    // 先清文件再删数据库：文件清理失败时保留项目记录，前端可准确重试。
    await storage.deleteProject(id);
    const result = repository.deleteArchivedProject(id);
    if (result === "missing") return reply.code(204).send();
    if (result === "not_archived") throw new ApiError(409, "CONFLICT", "Only archived projects can be deleted");
    return reply.code(204).send();
  });
  app.post("/api/v1/projects/:projectId/assets", async (request) => {
    const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); const data = await request.file(); if (!data) throw new ApiError(400, "VALIDATION_ERROR", "A file is required");
    if (!data.mimetype.startsWith("image/")) throw new ApiError(400, "VALIDATION_ERROR", "Only image files are supported");
    const fields = data.fields as Record<string, { value?: unknown }>;
    const role = parseAssetRole(fields.kind?.value ?? fields.role?.value);
    const content = await data.toBuffer(); const hash = contentHash(content);
    assertProjectAssetCapacity(repository, projectId, role);
    assertProjectAssetHashUnique(repository, projectId, hash);
    const stored = await storage.putAsset(projectId, data.filename, content);
    return repository.createAsset({ projectId, role, storagePath: stored.path, hash: stored.hash, originalName: data.filename, mimeType: data.mimetype, width: null, height: null });
  });
  // 先删文件再删行：行删了就找不到 storagePath；不级联分镜/输出/任务（契约 deleteAsset）
  app.delete("/api/v1/assets/:assetId", async (request, reply) => { const id = parameter(request, "assetId"); const asset = repository.getAsset(id); if (!asset) missing("asset", id); await storage.delete(asset.storagePath); repository.deleteAsset(id); return reply.code(204).send(); });
  app.post("/api/v1/projects/:projectId/planning-jobs", async (request, reply) => {
    const projectId = parameter(request, "projectId"); const project = repository.getProject(projectId); if (!project) missing("project", projectId); const body = object(request.body ?? {}, "body");
    if (project.defaultMode === "PIXEL_PROTECTED" && !repository.listAssets(projectId).some((asset) => asset.role === "PRODUCT_TRUTH" && asset.mimeType.startsWith("image/"))) {
      throw new ApiError(400, "VALIDATION_ERROR", "PIXEL_PROTECTED planning requires at least one PRODUCT_TRUTH image");
    }
    const requestedTypes = optionalStringArray(body.requestedTypes ?? body.imageTypes); if (requestedTypes?.length && resolveTemplates(requestedTypes).length !== requestedTypes.length) throw new ApiError(400, "VALIDATION_ERROR", "requestedTypes contains an unknown ecom-details-image template ID or alias");
    const planningMode = body.planningMode === undefined ? "AI" : enumValue<PlanningMode>(body.planningMode, ["AI", "MANUAL"], "planningMode");
    if (planningMode === "MANUAL" && !requestedTypes?.length) throw new ApiError(400, "VALIDATION_ERROR", "MANUAL planning requires requestedTypes");
    if (planningMode === "MANUAL" && body.targetImageCount !== undefined) throw new ApiError(400, "VALIDATION_ERROR", "targetImageCount is only supported for AI planning");
    const targetImageCount = planningMode === "AI"
      ? body.targetImageCount === undefined ? DEFAULT_TARGET_IMAGE_COUNT : planningImageCount(body.targetImageCount)
      : undefined;
    const input = {
      planningMode,
      requestedTypes,
      userInstruction: optionalString(body.userInstruction),
      candidatesPerType: body.candidatesPerType === undefined ? undefined : candidatesPerType(body.candidatesPerType),
      targetImageCount,
      imageResolution: body.imageResolution === undefined ? undefined : enumValue<ImageResolution>(body.imageResolution, IMAGE_RESOLUTIONS, "imageResolution"),
      imageAspectRatio: body.imageAspectRatio === undefined ? undefined : enumValue<ImageAspectRatio>(body.imageAspectRatio, IMAGE_ASPECT_RATIOS, "imageAspectRatio"),
      regenerationKey: optionalString(body.regenerationKey)
    };
    const fingerprint = requestFingerprint({ type: "PLAN", projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null }); const existing = repository.findJobByFingerprint(projectId, fingerprint); if (existing) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    const job = repository.createJob({ id: randomUUID(), projectId, storyboardItemId: null, type: "PLAN", input, requestFingerprint: fingerprint, providerId: project.reasoningProviderId, modelId: project.reasoningModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueue(queue, { jobId: job.id, kind: "plan" }); return reply.code(202).send(job);
  });
  app.post("/api/v1/projects/:projectId/copywriting-jobs", async (request, reply) => {
    const projectId = parameter(request, "projectId");
    const project = repository.getProject(projectId);
    if (!project) missing("project", projectId);
    const productImages = repository.listAssets(projectId).filter((asset) => asset.role === "PRODUCT_TRUTH" && asset.mimeType.startsWith("image/"));
    if (productImages.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "AI copywriting requires at least one product image");
    verifyCopywritingModel(repository, project.reasoningProviderId, project.reasoningModelId);
    const body = object(request.body ?? {}, "body");
    const input = {
      target: enumValue<CopywritingTarget>(body.target, ["PRODUCT_DESCRIPTION", "PLANNING_INSTRUCTION"], "target"),
      regenerationKey: string(body.regenerationKey, "regenerationKey"),
    };
    const fingerprint = requestFingerprint({ type: "COPYWRITE", projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null });
    const existing = repository.findJobByFingerprint(projectId, fingerprint);
    if (existing) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    const job = repository.createJob({
      id: randomUUID(), projectId, storyboardItemId: null, type: "COPYWRITE", input, requestFingerprint: fingerprint,
      providerId: project.reasoningProviderId, modelId: project.reasoningModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" },
    });
    await enqueue(queue, { jobId: job.id, kind: "copywrite" });
    return reply.code(202).send(job);
  });
  app.get("/api/v1/projects/:projectId/storyboard", async (request) => {
    const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); return { storyboard: repository.getStoryboard(projectId) ?? null, items: repository.listStoryboardItems(projectId) };
  });
  app.patch("/api/v1/storyboard-items/:itemId", async (request) => {
    const itemId = parameter(request, "itemId"); const current = repository.getStoryboardItem(itemId); if (!current) missing("storyboard item", itemId); const body = object(request.body, "body");
    if (current.status === "GENERATING") {
      throw new ApiError(409, "CONFLICT", "Generating storyboard items cannot be updated");
    }
    if (current.status === "GENERATED" && (body.assetType !== undefined || body.displayName !== undefined || body.templateVariant !== undefined || body.referencedAssets !== undefined || body.mode !== undefined || body.promptInstruction !== undefined)) {
      throw new ApiError(409, "CONFLICT", "Generated storyboard items only allow generation-setting updates");
    }
    const patch: Record<string, unknown> = {};
    if (body.assetType !== undefined) {
      const templateId = string(body.assetType, "assetType");
      if (templateId !== current.assetType) throw new ApiError(409, "CONFLICT", "Storyboard item image type is immutable");
      if (!getTemplate(templateId)) throw new ApiError(400, "VALIDATION_ERROR", "assetType must be an ecom-details-image template ID");
    }
    if (body.displayName !== undefined) patch.displayName = string(body.displayName, "displayName");
    if (body.templateVariant !== undefined) { const template = getTemplate(String(patch.assetType ?? current.assetType)); const variant = optionalString(body.templateVariant) ?? null; if (variant && !template?.variants[variant]) throw new ApiError(400, "VALIDATION_ERROR", "templateVariant is not declared by the selected ecom-details-image template"); patch.templateVariant = variant; }
    if (body.candidateCount !== undefined) patch.candidateCount = candidatesPerType(body.candidateCount);
    if (body.imageModel !== undefined) {
      const model = object(body.imageModel, "imageModel");
      const providerId = string(model.providerId, "imageModel.providerId");
      const modelId = string(model.modelId, "imageModel.modelId");
      verifyModel(repository, providerId, modelId, "image");
      patch.imageProviderId = providerId;
      patch.imageModelId = modelId;
    }
    if (body.imageResolution !== undefined) patch.imageResolution = enumValue<ImageResolution>(body.imageResolution, IMAGE_RESOLUTIONS, "imageResolution");
    if (body.imageAspectRatio !== undefined) patch.imageAspectRatio = enumValue<ImageAspectRatio>(body.imageAspectRatio, IMAGE_ASPECT_RATIOS, "imageAspectRatio");
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
    if (current.status === "GENERATING" || current.status === "GENERATED") {
      throw new ApiError(409, "CONFLICT", "Generated or generating storyboard items cannot be deleted");
    }
    repository.deleteStoryboardItem(itemId);
    return reply.code(204).send();
  });
  app.post("/api/v1/projects/:projectId/storyboard/confirm", async (request) => { const projectId = parameter(request, "projectId"); const result = repository.confirmStoryboard(projectId); if (!result) throw new ApiError(409, "CONFLICT", "A draft storyboard must exist before confirmation"); return result; });
  app.post("/api/v1/projects/:projectId/generation-jobs", async (request, reply) => {
    const projectId = parameter(request, "projectId"); const storyboard = repository.getStoryboard(projectId); if (!storyboard || storyboard.status !== "CONFIRMED") throw new ApiError(409, "CONFLICT", "Confirm the storyboard before generation");
    const body = object(request.body, "body"); const itemIds = stringArray(body.storyboardItemIds, "storyboardItemIds"); if (itemIds.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "At least one storyboardItemId is required");
    const config = body.generationConfig === undefined ? null : object(body.generationConfig, "generationConfig");
    const overrideResolution = config?.imageResolution === undefined ? undefined : enumValue<ImageResolution>(config.imageResolution, IMAGE_RESOLUTIONS, "generationConfig.imageResolution");
    const overrideAspect = config?.imageAspectRatio === undefined ? undefined : enumValue<ImageAspectRatio>(config.imageAspectRatio, IMAGE_ASPECT_RATIOS, "generationConfig.imageAspectRatio");
    const overrideCandidates = config?.candidateCount === undefined ? undefined : candidatesPerType(config.candidateCount);
    const overrideModel = config?.imageModel === undefined ? undefined : object(config.imageModel, "generationConfig.imageModel");
    const overrideProviderId = overrideModel ? string(overrideModel.providerId, "generationConfig.imageModel.providerId") : undefined;
    const overrideModelId = overrideModel ? string(overrideModel.modelId, "generationConfig.imageModel.modelId") : undefined;
    if (overrideProviderId && overrideModelId) verifyModel(repository, overrideProviderId, overrideModelId, "image");
    const project = repository.getProject(projectId); if (!project) missing("project", projectId);
    const jobs = itemIds.flatMap((itemId) => {
      const item = repository.getStoryboardItem(itemId); if (!item || item.projectId !== projectId) throw new ApiError(400, "VALIDATION_ERROR", "Storyboard item does not belong to this project");
      const candidateCount = overrideCandidates ?? clampCandidates(item.candidateCount);
      return Array.from({ length: candidateCount }, (_, index) => {
        const input = {
          revision: optionalString(body.revision),
          candidateIndex: index + 1,
          imageResolution: overrideResolution ?? item.imageResolution,
          imageAspectRatio: overrideAspect ?? item.imageAspectRatio
        };
        const fingerprint = requestFingerprint({ type: "GENERATE", projectId, itemId, storyboardVersion: storyboard.version, itemUpdatedAt: item.updatedAt, input, idempotencyKey: request.headers["idempotency-key"] ?? null });
        const existing = repository.findJobByFingerprint(projectId, fingerprint);
        if (existing) return existing;
        return repository.createJob({ id: randomUUID(), projectId, storyboardItemId: itemId, type: "GENERATE", input, requestFingerprint: fingerprint, providerId: overrideProviderId ?? item.imageProviderId, modelId: overrideModelId ?? item.imageModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
      });
    });
    await Promise.all(jobs.map((job) => enqueue(queue, { jobId: job.id, kind: "generate" }))); return reply.code(202).send({ jobs });
  });
  app.post("/api/v1/projects/:projectId/outputs/:outputId/edit-sessions", async (request, reply) => {
    const projectId = parameter(request, "projectId"); const outputId = parameter(request, "outputId"); ensureProject(repository, projectId);
    const output = repository.getOutput(outputId); if (!output || output.projectId !== projectId) missing("output", outputId);
    const existing = repository.getActiveEditSession(projectId, outputId);
    if (existing) {
      const selected = existing.currentOutputId === outputId ? existing : repository.updateEditSession(existing.id, { currentOutputId: outputId });
      if (!selected) missing("edit session", existing.id);
      return reply.code(201).send(editSessionDetails(repository, selected));
    }
    return reply.code(201).send(editSessionDetails(repository, repository.createEditSession({ id: randomUUID(), projectId, currentOutputId: outputId, status: "ACTIVE", memorySummary: {} })));
  });
  app.get("/api/v1/edit-sessions/:sessionId", async (request) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    return editSessionDetails(repository, session);
  });
  app.get("/api/v1/edit-sessions/:sessionId/reference-assets", async (request) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    const projectAssets = repository.listAssets(session.projectId).map((asset) => publicReferenceAsset(asset));
    const nowIso = new Date().toISOString();
    const temporaryAssets = repository.listEditReferenceAssets(session.id).filter((asset) => asset.expiresAt > nowIso).map((asset) => publicReferenceAsset(asset));
    const previousTurn = repository.listEditTurns(session.id).at(-1);
    return { items: [...projectAssets, ...temporaryAssets], suggestedSelections: previousTurn?.referenceSelections ?? [] };
  });
  app.post("/api/v1/edit-sessions/:sessionId/reference-assets", async (request, reply) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    const parts = request.parts(); let file: { name: string; mimeType: string; content: Buffer } | undefined; let purpose: ReferencePurpose = "PRODUCT_APPEARANCE";
    for await (const part of parts) {
      if (part.type === "file") {
        if (part.fieldname !== "file" || !part.mimetype.startsWith("image/")) throw new ApiError(400, "VALIDATION_ERROR", "file must be an image");
        file = { name: part.filename, mimeType: part.mimetype, content: await part.toBuffer() };
      } else if (part.fieldname === "purpose") purpose = enumValue<ReferencePurpose>(part.value, ["PRODUCT_APPEARANCE", "PACKAGING", "LABEL", "STYLE", "LAYOUT"], "purpose");
    }
    if (!file) throw new ApiError(400, "VALIDATION_ERROR", "file is required");
    const hash = contentHash(file.content);
    assertProjectAssetHashUnique(repository, session.projectId, hash);
    if (repository.listEditReferenceAssets(session.id).some((asset) => asset.turnId === null && asset.expiresAt > new Date().toISOString() && asset.hash === hash)) {
      throw new ApiError(400, "VALIDATION_ERROR", "相同图片已作为本次编辑的临时参考素材上传");
    }
    const stored = await storage.putEditReferenceAsset(session.projectId, session.id, file.name, file.content);
    const record = repository.createEditReferenceAsset({ id: randomUUID(), projectId: session.projectId, sessionId: session.id, turnId: null, storagePath: stored.path, hash: stored.hash, originalName: file.name, mimeType: file.mimeType, purpose, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() });
    return reply.code(201).send(publicReferenceAsset(record));
  });
  app.delete("/api/v1/edit-sessions/:sessionId/reference-assets/:referenceAssetId", async (request, reply) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    const record = repository.getEditReferenceAsset(parameter(request, "referenceAssetId"));
    if (!record || record.sessionId !== session.id) missing("reference asset", parameter(request, "referenceAssetId"));
    if (record.turnId) throw new ApiError(409, "CONFLICT", "Reference asset is already used by an edit turn");
    repository.deleteEditReferenceAsset(record.id); await storage.delete(record.storagePath); return reply.code(204).send();
  });
  app.post("/api/v1/edit-sessions/:sessionId/reference-assets/:referenceAssetId/promote", async (request, reply) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    const temporary = repository.getEditReferenceAsset(parameter(request, "referenceAssetId"));
    if (!temporary || temporary.sessionId !== session.id) missing("reference asset", parameter(request, "referenceAssetId"));
    const role = roleForReferencePurpose(temporary.purpose); assertProjectAssetCapacity(repository, session.projectId, role);
    assertProjectAssetHashUnique(repository, session.projectId, temporary.hash);
    const content = await storage.read(temporary.storagePath); const stored = await storage.putAsset(session.projectId, temporary.originalName, content);
    const asset = repository.createAsset({ projectId: session.projectId, role, storagePath: stored.path, hash: stored.hash, originalName: temporary.originalName, mimeType: temporary.mimeType, width: null, height: null });
    repository.deleteEditReferenceAsset(temporary.id); await storage.delete(temporary.storagePath); return reply.code(201).send(publicReferenceAsset(asset));
  });
  app.patch("/api/v1/edit-sessions/:sessionId/memory", async (request) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    const body = object(request.body, "body");
    const outputId = body.outputId === undefined ? session.currentOutputId : string(body.outputId, "outputId");
    const output = repository.getOutput(outputId);
    if (!output || output.projectId !== session.projectId || !repository.isOutputInEditSession(session.id, outputId)) throw new ApiError(400, "VALIDATION_ERROR", "outputId must belong to the edit session");
    const summary = optionalString(body.summary) ?? "";
    const constraints = body.constraints === undefined ? (session.memorySummary.scopes?.[outputId]?.constraints ?? session.memorySummary.constraints ?? []) : stringArray(body.constraints, "constraints");
    const scopes = { ...(session.memorySummary.scopes ?? {}), [outputId]: { summary, constraints } };
    const updated = repository.updateEditSession(session.id, { memorySummary: { ...session.memorySummary, scopes } });
    if (!updated) missing("edit session", session.id);
    await events.publish(session.projectId, "edit-session.updated", { session: updated });
    return editSessionDetails(repository, updated);
  });
  app.post("/api/v1/edit-sessions/:sessionId/turns", async (request, reply) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    if (session.status !== "ACTIVE") throw new ApiError(409, "CONFLICT", "Edit session is not active");
    const parts = request.parts(); const fields = new Map<string, string>(); let editMask: { content: Buffer; mimeType: string } | undefined; let protectMask: { content: Buffer; mimeType: string } | undefined;
    for await (const part of parts) {
      if (part.type === "file") {
        if (part.fieldname !== "editMask" && part.fieldname !== "protectMask") throw new ApiError(400, "VALIDATION_ERROR", `Unsupported edit file field: ${part.fieldname}`);
        if (part.mimetype !== "image/png") throw new ApiError(400, "VALIDATION_ERROR", `${part.fieldname} must be a PNG image`);
        const value = { content: await part.toBuffer(), mimeType: part.mimetype };
        if (part.fieldname === "editMask") editMask = value; else protectMask = value;
      } else fields.set(part.fieldname, String(part.value));
    }
    const baseOutputId = fields.get("baseOutputId") ?? session.currentOutputId;
    const baseOutput = repository.getOutput(baseOutputId); if (!baseOutput || baseOutput.projectId !== session.projectId) throw new ApiError(400, "VALIDATION_ERROR", "baseOutputId must belong to this project");
    const message = fields.get("message")?.trim(); if (!message) throw new ApiError(400, "VALIDATION_ERROR", "message is required");
    const annotations = jsonObject(fields.get("annotations"), "annotations");
    const legacyReferenceAssetIds = jsonStringArray(fields.get("referenceAssetIds"), "referenceAssetIds");
    const submittedReferenceSelections = parseReferenceSelections(fields.get("referenceSelections"));
    const referenceSelections = submittedReferenceSelections.length > 0
      ? submittedReferenceSelections
      : legacyReferenceAssetIds.map((id, order) => ({ id, source: "PROJECT" as const, purpose: "PRODUCT_APPEARANCE" as const, order }));
    const referenceAssetIds = referenceSelections.filter((selection) => selection.source === "PROJECT").map((selection) => selection.id);
    const projectAssets = repository.listAssets(session.projectId); const knownAssets = new Set(projectAssets.map((asset) => asset.id));
    const temporary = repository.listEditReferenceAssets(session.id).filter((asset) => asset.expiresAt > new Date().toISOString()); const knownTemporary = new Set(temporary.map((asset) => asset.id));
    if (referenceSelections.some((selection) => selection.source === "PROJECT" ? !knownAssets.has(selection.id) : !knownTemporary.has(selection.id))) throw new ApiError(400, "VALIDATION_ERROR", "referenceSelections must belong to this project or edit session");
    const nonProductReferences = referenceSelections.filter((selection) => selection.source === "TEMPORARY" || projectAssets.find((asset) => asset.id === selection.id)?.role !== "PRODUCT_TRUTH");
    if (nonProductReferences.length > MAX_GENERATION_REFERENCE_IMAGES) throw new ApiError(400, "VALIDATION_ERROR", `单次编辑最多选择 ${MAX_GENERATION_REFERENCE_IMAGES} 张非商品参考图`);
    if (editMask) await validateMaskDimensions(baseOutput.storagePath, editMask.content, storage);
    if (protectMask) await validateMaskDimensions(baseOutput.storagePath, protectMask.content, storage);
    const turnId = randomUUID();
    const editStored = editMask ? await storage.putEditArtifact(session.projectId, session.id, turnId, "edit-mask.png", editMask.content) : undefined;
    const protectStored = protectMask ? await storage.putEditArtifact(session.projectId, session.id, turnId, "protect-mask.png", protectMask.content) : undefined;
    const fingerprint = requestFingerprint({ type: "EDIT_PLAN", projectId: session.projectId, sessionId: session.id, baseOutputId, message, annotations, editMaskHash: editStored?.hash ?? null, protectMaskHash: protectStored?.hash ?? null, referenceSelections, idempotencyKey: request.headers["idempotency-key"] ?? null });
    const existing = repository.findJobByFingerprint(session.projectId, fingerprint); if (existing) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send({ turnId: existing.input.editTurnId, planJobId: existing.id, status: existing.status });
    const project = repository.getProject(session.projectId); if (!project) missing("project", session.projectId);
    const generationConfig = editGenerationConfigFor(repository, project, annotations);
    const turn = repository.createEditTurn({ id: turnId, sessionId: session.id, projectId: session.projectId, baseOutputId, status: "PLANNING", message, annotations, editMaskPath: editStored?.path ?? null, editMaskHash: editStored?.hash ?? null, protectMaskPath: protectStored?.path ?? null, protectMaskHash: protectStored?.hash ?? null, referenceAssetIds, referenceSelections, plan: null, error: null });
    repository.attachEditReferenceAssets(session.id, turn.id, referenceSelections.filter((selection) => selection.source === "TEMPORARY").map((selection) => selection.id));
    const job = repository.createJob({ id: randomUUID(), projectId: session.projectId, storyboardItemId: null, type: "EDIT_PLAN", input: { editTurnId: turn.id }, requestFingerprint: fingerprint, providerId: generationConfig.reasoningProviderId, modelId: generationConfig.reasoningModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueue(queue, { jobId: job.id, kind: "edit_plan" }); return reply.code(202).send({ turnId: turn.id, planJobId: job.id, status: turn.status });
  });
  app.get("/api/v1/edit-turns/:turnId", async (request) => { const turn = repository.getEditTurn(parameter(request, "turnId")); if (!turn) missing("edit turn", parameter(request, "turnId")); return turn; });
  app.post("/api/v1/edit-turns/:turnId/approve", async (request, reply) => {
    const turn = repository.getEditTurn(parameter(request, "turnId")); if (!turn) missing("edit turn", parameter(request, "turnId"));
    if (turn.status !== "AWAITING_CONFIRMATION" && turn.status !== "PLAN_READY") throw new ApiError(409, "CONFLICT", "Edit turn is not ready for generation");
    const project = repository.getProject(turn.projectId); if (!project) missing("project", turn.projectId);
    const generationConfig = editGenerationConfigFor(repository, project, turn.annotations);
    const fingerprint = requestFingerprint({ type: "EDIT_GENERATE", projectId: turn.projectId, editTurnId: turn.id, plan: turn.plan });
    const existing = repository.findJobByFingerprint(turn.projectId, fingerprint); if (existing) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send({ job: existing, turn: repository.getEditTurn(turn.id) });
    repository.updateEditTurn(turn.id, { status: "GENERATING", error: null });
    const job = repository.createJob({ id: randomUUID(), projectId: turn.projectId, storyboardItemId: null, type: "EDIT_GENERATE", input: { editTurnId: turn.id }, requestFingerprint: fingerprint, providerId: generationConfig.imageProviderId, modelId: generationConfig.imageModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueue(queue, { jobId: job.id, kind: "edit_generate" }); return reply.code(202).send({ job, turn: repository.getEditTurn(turn.id) });
  });
  app.post("/api/v1/edit-sessions/:sessionId/select-output", async (request) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    const body = object(request.body, "body"); const outputId = string(body.outputId, "outputId"); const output = repository.getOutput(outputId); if (!output || output.projectId !== session.projectId) throw new ApiError(400, "VALIDATION_ERROR", "outputId must belong to this project");
    if (!repository.isOutputInEditSession(session.id, output.id)) throw new ApiError(400, "VALIDATION_ERROR", "outputId is not part of this edit session");
    const updated = repository.updateEditSession(session.id, { currentOutputId: outputId });
    if (!updated) missing("edit session", session.id);
    await events.publish(session.projectId, "edit-session.updated", { session: updated });
    return editSessionDetails(repository, updated);
  });
  app.get("/api/v1/jobs/:jobId", async (request) => { const job = repository.getJob(parameter(request, "jobId")); if (!job) missing("job", parameter(request, "jobId")); return job; });
  app.get("/api/v1/copywriting-jobs/:jobId/result", async (request) => {
    const jobId = parameter(request, "jobId");
    const job = repository.getJob(jobId);
    if (!job || job.type !== "COPYWRITE") missing("copywriting job", jobId);
    if (job.status !== "SUCCEEDED") throw new ApiError(409, "CONFLICT", "Copywriting job has not succeeded");
    const result = repository.getCopywritingResult(jobId);
    if (!result) missing("copywriting result", jobId);
    return result;
  });
  app.post("/api/v1/jobs/:jobId/cancel", async (request) => {
    const id = parameter(request, "jobId");
    const current = repository.getJob(id);
    if (!current) missing("job", id);
    // 已失败任务没有可中断的队列工作，将其标记为已取消以关闭失败提示，同时保留审计记录。
    if (current.status === "FAILED") return repository.updateJob(id, { status: "CANCELLED", cancelRequested: true });
    const queued = await queue.getJob(id);
    const state = queued ? await queued.getState() : "unknown";
    if (queued && ["waiting", "delayed", "prioritized"].includes(state)) {
      await queued.remove();
      return repository.updateJob(id, { status: "CANCELLED", cancelRequested: true });
    }
    return repository.updateJob(id, { cancelRequested: true });
  });
  app.post("/api/v1/jobs/:jobId/retry", async (request, reply) => { const id = parameter(request, "jobId"); const job = repository.getJob(id); if (!job) missing("job", id); if (!job.retryable) throw new ApiError(409, "CONFLICT", "This job cannot be retried"); const retry = repository.createJob({ id: randomUUID(), projectId: job.projectId, storyboardItemId: job.storyboardItemId, type: job.type, input: job.input, providerId: job.providerId, modelId: job.modelId, estimatedCost: job.estimatedCost }); await enqueue(queue, { jobId: retry.id, kind: queueKindForJobType(retry.type) }); return reply.code(202).send(retry); });
  app.get("/api/v1/projects/:projectId/outputs", async (request) => repository.listOutputs(parameter(request, "projectId")));
  app.post("/api/v1/projects/:projectId/export-jobs", async (request, reply) => { const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); const body = object(request.body ?? {}, "body"); const input = { outputIds: optionalStringArray(body.outputIds), filenamePrefix: optionalString(body.filenamePrefix) }; const fingerprint = requestFingerprint({ type: "EXPORT", projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null }); const existing = repository.findJobByFingerprint(projectId, fingerprint); if (existing) { const exportRecord = repository.getExportByJobId(existing.id); return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send({ job: existing, export: exportRecord ?? null }); } const job = repository.createJob({ id: randomUUID(), projectId, storyboardItemId: null, type: "EXPORT", input, requestFingerprint: fingerprint, estimatedCost: { status: "UNKNOWN", unit: "local-storage" } }); const exportRecord = repository.createExport({ projectId, jobId: job.id, status: "QUEUED", storagePath: null }); await enqueue(queue, { jobId: job.id, kind: "export" }); return reply.code(202).send({ job, export: exportRecord }); });
  app.get("/api/v1/exports/:exportId", async (request) => { const result = repository.getExport(parameter(request, "exportId")); if (!result) missing("export", parameter(request, "exportId")); return result; });
  app.get("/api/v1/files/assets/:assetId", async (request, reply) => sendStored(request, reply, storage, repository.getAsset(parameter(request, "assetId")), "asset"));
  app.get("/api/v1/files/edit-reference-assets/:referenceAssetId", async (request, reply) => sendStored(request, reply, storage, repository.getEditReferenceAsset(parameter(request, "referenceAssetId")), "reference asset"));
  app.get("/api/v1/files/outputs/:outputId", async (request, reply) => sendStored(request, reply, storage, repository.getOutput(parameter(request, "outputId")), "output"));
  app.get("/api/v1/files/exports/:exportId", async (request, reply) => sendStored(request, reply, storage, repository.getExport(parameter(request, "exportId")), "export"));
  app.get("/api/v1/events", { sse: "only" }, async (request, reply) => {
    const projectId = typeof request.query === "object" && request.query && "projectId" in request.query ? String((request.query as Record<string, unknown>).projectId) : ""; if (!projectId) throw new ApiError(400, "VALIDATION_ERROR", "projectId query parameter is required"); ensureProject(repository, projectId);
    reply.sse.keepAlive(); const unsubscribe = await events.subscribe(projectId, (event) => { void reply.sse.send({ id: event.id, event: event.type, data: event }); }); reply.sse.onClose(() => { void unsubscribe(); }); await reply.sse.send({ event: "connected", data: { projectId } });
  });
  return app;
}

function publicProvider(value: ProviderRecord): object { const { encryptedApiKey, ...provider } = value; return { ...provider, hasApiKey: Boolean(encryptedApiKey) }; }
function publicSearchSource(value: SearchSourceRecord): object { const { encryptedApiKey, ...source } = value; return { ...source, hasApiKey: Boolean(encryptedApiKey) }; }
function publicReferenceAsset(value: AssetRecord | EditReferenceAssetRecord): object {
  const temporary = "sessionId" in value;
  return { id: value.id, source: temporary ? "TEMPORARY" : "PROJECT", purpose: temporary ? value.purpose : defaultPurposeForRole(value.role), role: temporary ? null : value.role, originalName: value.originalName, mimeType: value.mimeType, hash: value.hash, createdAt: value.createdAt, expiresAt: temporary ? value.expiresAt : null, url: temporary ? `/files/edit-reference-assets/${value.id}` : `/files/assets/${value.id}` };
}
function defaultPurposeForRole(role: AssetRole): ReferencePurpose { return role === "PRODUCT_TRUTH" ? "PRODUCT_APPEARANCE" : role === "PACKAGING" ? "PACKAGING" : role === "STYLE_REFERENCE" ? "STYLE" : "LAYOUT"; }
function roleForReferencePurpose(purpose: ReferencePurpose): AssetRole { return purpose === "PRODUCT_APPEARANCE" ? "PRODUCT_TRUTH" : purpose === "PACKAGING" || purpose === "LABEL" ? "PACKAGING" : purpose === "STYLE" ? "STYLE_REFERENCE" : "LAYOUT_REFERENCE"; }
function projectDetail(repository: EcomRepository, id: string): object { const project = repository.getProject(id); if (!project) missing("project", id); return { ...project, assets: repository.listAssets(id), storyboard: repository.getStoryboard(id), items: repository.listStoryboardItems(id), outputs: repository.listOutputs(id), jobs: repository.listJobs(id) }; }
function editSessionDetails(repository: EcomRepository, session: EditSessionRecord): object {
  const editOutputs = repository.listEditOutputs(session.id);
  const rootIds = new Set(editOutputs.map((output) => output.rootOutputId).filter((id): id is string => Boolean(id)));
  const candidates = [...editOutputs, ...[...rootIds].map((id) => repository.getOutput(id)).filter((output): output is NonNullable<typeof output> => Boolean(output)), repository.getOutput(session.currentOutputId)].filter((output): output is NonNullable<typeof output> => Boolean(output)).filter((output, index, all) => all.findIndex((candidate) => candidate.id === output.id) === index);
  const current = repository.getOutput(session.currentOutputId);
  const byId = new Map(candidates.map((output) => [output.id, output]));
  const relatedIds = new Set<string>();
  let ancestor = current;
  while (ancestor) {
    relatedIds.add(ancestor.id);
    ancestor = ancestor.parentOutputId ? byId.get(ancestor.parentOutputId) : undefined;
  }
  const descendants = [current].filter((output): output is NonNullable<typeof output> => Boolean(output));
  while (descendants.length > 0) {
    const parent = descendants.shift();
    if (!parent) continue;
    for (const child of candidates) {
      if (child.parentOutputId !== parent.id || relatedIds.has(child.id)) continue;
      relatedIds.add(child.id);
      descendants.push(child);
    }
  }
  const versions = candidates.filter((output) => relatedIds.has(output.id)).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return { ...session, memorySummary: effectiveEditMemory(repository, session, session.currentOutputId), turns: repository.listEditTurns(session.id), versions };
}
function effectiveEditMemory(repository: EcomRepository, session: EditSessionRecord, outputId: string): { summary?: string; constraints?: string[]; sourceOutputId?: string } {
  const scopes = session.memorySummary.scopes ?? {};
  let current = repository.getOutput(outputId);
  while (current) {
    const scoped = scopes[current.id];
    if (scoped) return { ...scoped, sourceOutputId: current.id };
    current = current.parentOutputId ? repository.getOutput(current.parentOutputId) : undefined;
  }
  const output = repository.getOutput(outputId);
  return output && !output.parentOutputId
    ? { summary: session.memorySummary.summary, constraints: session.memorySummary.constraints, sourceOutputId: output.id }
    : {};
}
function parseAssetRole(value: unknown): AssetRole {
  if (value === "PRODUCT" || value === "REFERENCE") return roleForUserAssetKind(value as UserAssetKind);
  return enumValue<AssetRole>(value, ["PRODUCT_TRUTH", "PACKAGING", "STYLE_REFERENCE", "LAYOUT_REFERENCE"], "role");
}
function candidatesPerType(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_CANDIDATES_PER_TYPE) throw new ApiError(400, "VALIDATION_ERROR", `candidatesPerType must be an integer between 1 and ${MAX_CANDIDATES_PER_TYPE}`);
  return count;
}
function planningImageCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(count) || count < MIN_TARGET_IMAGE_COUNT || count > MAX_TARGET_IMAGE_COUNT) throw new ApiError(400, "VALIDATION_ERROR", `targetImageCount must be an integer between ${MIN_TARGET_IMAGE_COUNT} and ${MAX_TARGET_IMAGE_COUNT}`);
  return count;
}
function clampCandidates(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CANDIDATES_PER_TYPE, Math.max(1, Math.round(value)));
}
function verifyCopywritingModel(repository: EcomRepository, providerId: string, modelId: string): void {
  const provider = repository.getProvider(providerId);
  if (!provider) missing("provider", providerId);
  const model = provider.models.find((candidate) => candidate.id === modelId);
  if (!model) throw new ApiError(400, "VALIDATION_ERROR", "Configured reasoning model is not declared by its provider");
  if (!model.supportsVision) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected reasoning model must support Vision for AI copywriting");
}
interface EditGenerationConfig { reasoningProviderId: string; reasoningModelId: string; imageProviderId: string; imageModelId: string; imageResolution: ImageResolution; candidateCount: number; }
function editGenerationConfigFor(repository: EcomRepository, project: ProjectRecord, annotations: Record<string, unknown>): EditGenerationConfig {
  const raw = annotations.generationConfig;
  if (raw === undefined) return { reasoningProviderId: project.reasoningProviderId, reasoningModelId: project.reasoningModelId, imageProviderId: project.imageProviderId, imageModelId: project.imageModelId, imageResolution: project.imageResolution, candidateCount: clampCandidates(project.candidatesPerType) };
  const config = object(raw, "annotations.generationConfig");
  const reasoningProviderId = string(config.reasoningProviderId, "annotations.generationConfig.reasoningProviderId");
  const reasoningModelId = string(config.reasoningModelId, "annotations.generationConfig.reasoningModelId");
  const imageProviderId = string(config.imageProviderId, "annotations.generationConfig.imageProviderId");
  const imageModelId = string(config.imageModelId, "annotations.generationConfig.imageModelId");
  verifyModel(repository, reasoningProviderId, reasoningModelId, "reasoning");
  verifyModel(repository, imageProviderId, imageModelId, "image");
  return { reasoningProviderId, reasoningModelId, imageProviderId, imageModelId, imageResolution: config.imageResolution === undefined ? project.imageResolution : enumValue<ImageResolution>(config.imageResolution, IMAGE_RESOLUTIONS, "annotations.generationConfig.imageResolution"), candidateCount: config.candidateCount === undefined ? clampCandidates(project.candidatesPerType) : candidatesPerType(config.candidateCount) };
}
function queueKindForJobType(type: JobType): EcomJobKind {
  if (type === "PLAN") return "plan";
  if (type === "COPYWRITE") return "copywrite";
  if (type === "GENERATE") return "generate";
  return "export";
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
function jsonObject(value: string | undefined, path: string): Record<string, unknown> {
  if (!value) return {};
  try { return object(JSON.parse(value), path); } catch { throw new ApiError(400, "VALIDATION_ERROR", `${path} must be valid JSON object`); }
}
function jsonStringArray(value: string | undefined, path: string): string[] {
  if (!value) return [];
  try { return stringArray(JSON.parse(value), path); } catch { throw new ApiError(400, "VALIDATION_ERROR", `${path} must be a JSON array of strings`); }
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
function contentHash(content: Buffer): string { return createHash("sha256").update(content).digest("hex"); }
function parseReferenceSelections(value: string | undefined): ReferenceSelection[] {
  if (!value) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new ApiError(400, "VALIDATION_ERROR", "referenceSelections must be valid JSON"); }
  if (!Array.isArray(parsed)) throw new ApiError(400, "VALIDATION_ERROR", "referenceSelections must be an array");
  const purposes: ReferencePurpose[] = ["PRODUCT_APPEARANCE", "PACKAGING", "LABEL", "STYLE", "LAYOUT"];
  const seen = new Set<string>();
  const selections = parsed.map((item, index) => {
    const entry = object(item, `referenceSelections[${index}]`);
    const id = string(entry.id, `referenceSelections[${index}].id`); const source = enumValue<"PROJECT" | "TEMPORARY">(entry.source, ["PROJECT", "TEMPORARY"], `referenceSelections[${index}].source`); const purpose = enumValue<ReferencePurpose>(entry.purpose, purposes, `referenceSelections[${index}].purpose`);
    if (seen.has(`${source}:${id}`)) throw new ApiError(400, "VALIDATION_ERROR", "referenceSelections cannot contain duplicates");
    seen.add(`${source}:${id}`); return { id, source, purpose, order: index };
  });
  return selections;
}
async function validateMaskDimensions(sourcePath: string, mask: Buffer, storage: LocalAssetStore): Promise<void> {
  const [source, candidate] = await Promise.all([sharp(await storage.read(sourcePath)).metadata(), sharp(mask).metadata()]);
  if (!source.width || !source.height || source.width !== candidate.width || source.height !== candidate.height) throw new ApiError(400, "VALIDATION_ERROR", "MASK_DIMENSION_MISMATCH");
}
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
async function sendStored(request: FastifyRequest, reply: FastifyReply, storage: LocalAssetStore, record: { storagePath: string | null; mimeType?: string; hash?: string } | undefined, name: string): Promise<unknown> {
  if (!record || !record.storagePath) missing(name, "unknown");
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
function mimeForPath(path: string): string { if (path.endsWith(".png")) return "image/png"; if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"; if (path.endsWith(".webp")) return "image/webp"; if (path.endsWith(".zip")) return "application/zip"; return "application/octet-stream"; }
