import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { EcomRepository, LibraryItemRecord } from "@ecomgen/core";
import { requestFingerprint } from "@ecomgen/core";
import { compileUserTemplate, resolveTemplatesWithUser } from "@ecomgen/ecom-skill";
import {
  CopyLibraryAssetToProjectInput,
  CreateCopywritingJobInput,
  CreatePlanningJobInput,
  CreateProjectInput,
  UpdateProjectInput,
  DEFAULT_CANDIDATES_PER_TYPE,
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_RESOLUTION,
  DEFAULT_TARGET_IMAGE_COUNT,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  MODEL_AGES,
  MODEL_BUILDS,
  MODEL_GENDERS,
  MODEL_HERITAGES,
  MODEL_STATURES,
  PLATFORM_TARGETS,
} from "@ecomgen/contracts";
import type {
  CopywritingTarget,
  ImageAspectRatio,
  ImageResolution,
  LibraryItemKind,
  PlanningMode,
  PlatformTarget,
  PromptLanguage,
  StoryboardMode,
  TargetMarket,
} from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import {
  UUID_PATTERN,
  assertProjectAssetCapacity,
  assertProjectAssetHashUnique,
  candidatesPerType,
  contentHash,
  ensureProject,
  imageDimensions,
  missing,
  parseAssetRole,
  planningImageCount,
  readSegmentationModel,
  verifyCopywritingModel,
  verifyModel,
  writeThumbnail,
} from "../helpers.js";
import { parseBody } from "../http-input.js";
import {
  enumArray,
  enumValue,
  objectOfStrings,
  parameter,
  readBoolean,
  readOptionalText,
  readOptionalTextArray,
  readText,
  readTextArray,
} from "../input-normalizers.js";
import { applyModelFields } from "../projectPatch.js";
import { resolveRequestedSuiteShots } from "./suites.js";

function projectDetail(repository: EcomRepository, id: string): object { const project = repository.getProject(id); if (!project) missing("project", id); return { ...project, assets: repository.listAssets(id), storyboard: repository.getStoryboard(id), items: repository.listStoryboardItems(id), outputs: repository.listOutputs(id), jobs: repository.listJobs(id) }; }

/** 规划校验与 Worker 共用同一编译口径；表极小，按请求读取即可保证最新。 */
function compiledUserTemplates(repository: EcomRepository): ReturnType<typeof compileUserTemplate>[] { return repository.listUserTemplates().map((record) => compileUserTemplate({ id: record.id, name: record.name, prompt: record.prompt, defaultSize: record.defaultSize, supportsImageReference: record.supportsImageReference })); }

function platformTargetsValue(value: unknown): PlatformTarget[] {
  const targets = value === undefined || value === null ? [] : enumArray<PlatformTarget>(value, PLATFORM_TARGETS, "platformTargets");
  if (targets.length > 1) throw new ApiError(400, "VALIDATION_ERROR", "platformTargets must contain at most one target");
  return targets;
}

function targetMarketValue(value: unknown): TargetMarket | null {
  if (value === undefined || value === null || value === "") return null;
  return enumValue<TargetMarket>(value, ["CHINA_MAINLAND", "HONG_KONG", "MACAU", "TAIWAN", "UNITED_STATES", "UNITED_KINGDOM", "GERMANY", "FRANCE", "ITALY", "SPAIN", "JAPAN", "SOUTH_KOREA"], "targetMarket");
}

function copyLanguageValue(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const language = readText(value, "copyLanguage");
  if (language.length > 64) throw new ApiError(400, "VALIDATION_ERROR", "copyLanguage must contain 1 to 64 characters");
  return language;
}

function promptLanguageValue(value: unknown): PromptLanguage {
  return enumValue<PromptLanguage>(value, ["CHINESE", "ENGLISH"], "promptLanguage");
}

/** 可选日期时间查询参数：解析失败返回 400，不把非法值静默当成「不限时间」；统一规范化为 UTC ISO 以便与 created_at 字典序比较。 */
function dateTimeParameter(value: unknown, path: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = typeof value === "string" ? value.trim() : "";
  const parsed = text ? Date.parse(text) : Number.NaN;
  if (Number.isNaN(parsed)) throw new ApiError(400, "VALIDATION_ERROR", `${path} must be an ISO 8601 date-time`);
  return new Date(parsed).toISOString();
}

/** 可选身份维度查询参数：取值必须落在对应契约元组内；空串表示该维度不筛选。 */
function modelSpecParameter<T extends string>(value: unknown, allowed: readonly T[], path: string): T | null {
  return value === undefined || value === null || value === "" ? null : enumValue<T>(value, allowed, path);
}

function publicLibraryAsset(item: LibraryItemRecord): Record<string, unknown> {
  const idBody = item.id.slice(item.id.indexOf(":") + 1);
  // 分层条目 ID 为 layer:<layerExportId>:<index>，下载走分层文件端点；规格包同理按文件下标寻址。
  const url = item.id.startsWith("layer:")
    ? `/api/v1/files/layer-exports/${idBody.slice(0, idBody.lastIndexOf(":"))}/layers/${idBody.slice(idBody.lastIndexOf(":") + 1)}`
    : item.id.startsWith("model:")
      ? `/api/v1/files/model-portraits/${idBody}`
      : item.id.startsWith("pattern:")
        ? `/api/v1/files/patterns/${idBody}`
        : item.id.startsWith("pack:")
          ? `/api/v1/files/print-packs/${idBody.slice(0, idBody.lastIndexOf(":"))}/files/${idBody.slice(idBody.lastIndexOf(":") + 1)}`
          : item.source === "UPLOADED"
            ? `/api/v1/files/assets/${idBody}`
            : `/api/v1/files/outputs/${idBody}`;
  return {
    id: item.id,
    source: item.source,
    kind: item.kind,
    name: item.name,
    projectId: item.projectId,
    projectName: item.projectName,
    mimeType: item.mimeType,
    hash: item.hash,
    width: item.width,
    height: item.height,
    url,
    thumbnailUrl: `/api/v1/files/thumbnails/${item.hash}`,
    createdAt: item.createdAt,
    role: item.role
  };
}

export function registerProjectRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, storage, suiteCatalog, enqueueOrMarkFailed } = ctx;
  app.get("/api/v1/projects", async (request) => {
    const query = typeof request.query === "object" && request.query ? request.query as Record<string, unknown> : {};
    const archivedValue = query.archived;
    const archived = archivedValue === undefined
      ? false
      : archivedValue === true || archivedValue === "true"
        ? true
        : archivedValue === false || archivedValue === "false"
          ? false
          : readBoolean(archivedValue, "archived");
    const projects = repository.listProjects(archived);
    const covers = repository.listProjectCovers(projects.map((project) => project.id));
    return {
      items: projects.map((project) => ({ ...project, cover: covers.get(project.id) ?? { productAssetId: null, coverOutputId: null, previewOutputIds: [], outputCount: 0 } })),
      nextCursor: null
    };
  });
  app.post("/api/v1/projects", async (request, reply) => {
    const body = parseBody(CreateProjectInput, request.body); const platformTargets = platformTargetsValue(body.platformTargets);
    const reasoningProviderId = readText(body.reasoningProviderId, "reasoningProviderId"); const imageProviderId = readText(body.imageProviderId, "imageProviderId");
    verifyModel(repository, reasoningProviderId, readText(body.reasoningModelId, "reasoningModelId"), "reasoning"); verifyModel(repository, imageProviderId, readText(body.imageModelId, "imageModelId"), "image");
    return reply.code(201).send(repository.createProject({
      name: readText(body.name, "name"),
      category: readOptionalText(body.category) ?? null,
      productDescription: readOptionalText(body.productDescription) ?? null,
      verifiedFacts: readOptionalTextArray(body.verifiedFacts) ?? [],
      prohibitedClaims: readOptionalTextArray(body.prohibitedClaims) ?? [],
      brandGuidelines: body.brandGuidelines === undefined ? {} : objectOfStrings(body.brandGuidelines, "brandGuidelines"),
      platformTargets,
      targetMarket: targetMarketValue(body.targetMarket),
      copyLanguage: copyLanguageValue(body.copyLanguage),
      promptLanguage: body.promptLanguage === undefined ? "CHINESE" : promptLanguageValue(body.promptLanguage),
      reasoningProviderId,
      reasoningModelId: readText(body.reasoningModelId, "reasoningModelId"),
      imageProviderId,
      imageModelId: readText(body.imageModelId, "imageModelId"),
      defaultMode: enumValue<StoryboardMode>(body.defaultMode, ["CREATIVE", "PIXEL_PROTECTED"], "defaultMode"),
      imageResolution: body.imageResolution === undefined ? DEFAULT_IMAGE_RESOLUTION : enumValue<ImageResolution>(body.imageResolution, IMAGE_RESOLUTIONS, "imageResolution"),
      imageAspectRatio: body.imageAspectRatio === undefined ? DEFAULT_IMAGE_ASPECT_RATIO : enumValue<ImageAspectRatio>(body.imageAspectRatio, IMAGE_ASPECT_RATIOS, "imageAspectRatio"),
      candidatesPerType: body.candidatesPerType === undefined ? DEFAULT_CANDIDATES_PER_TYPE : candidatesPerType(body.candidatesPerType),
      webResearchEnabled: body.webResearchEnabled === undefined ? false : readBoolean(body.webResearchEnabled, "webResearchEnabled"),
      segmentationModel: body.segmentationModel === undefined || body.segmentationModel === null ? null : readSegmentationModel(repository, body.segmentationModel)
    }));
  });
  app.get("/api/v1/projects/:projectId", async (request) => projectDetail(repository, parameter(request, "projectId")));
  app.patch("/api/v1/projects/:projectId", async (request) => {
    const id = parameter(request, "projectId"); const body = parseBody(UpdateProjectInput, request.body); const current = repository.getProject(id); if (!current) missing("project", id);
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = readText(body.name, "name");
    if (body.category !== undefined) update.category = readOptionalText(body.category) ?? null;
    if (body.productDescription !== undefined) update.productDescription = readOptionalText(body.productDescription) ?? null;
    if (body.verifiedFacts !== undefined) update.verifiedFacts = readTextArray(body.verifiedFacts, "verifiedFacts");
    if (body.prohibitedClaims !== undefined) update.prohibitedClaims = readTextArray(body.prohibitedClaims, "prohibitedClaims");
    if (body.brandGuidelines !== undefined) update.brandGuidelines = objectOfStrings(body.brandGuidelines, "brandGuidelines");
    if (body.platformTargets !== undefined) update.platformTargets = platformTargetsValue(body.platformTargets);
    if (body.targetMarket !== undefined) update.targetMarket = targetMarketValue(body.targetMarket);
    if (body.copyLanguage !== undefined) update.copyLanguage = copyLanguageValue(body.copyLanguage);
    if (body.promptLanguage !== undefined) update.promptLanguage = promptLanguageValue(body.promptLanguage);
    if (body.defaultMode !== undefined) update.defaultMode = enumValue<StoryboardMode>(body.defaultMode, ["CREATIVE", "PIXEL_PROTECTED"], "defaultMode");
    if (body.imageResolution !== undefined) update.imageResolution = enumValue<ImageResolution>(body.imageResolution, IMAGE_RESOLUTIONS, "imageResolution");
    if (body.imageAspectRatio !== undefined) update.imageAspectRatio = enumValue<ImageAspectRatio>(body.imageAspectRatio, IMAGE_ASPECT_RATIOS, "imageAspectRatio");
    if (body.candidatesPerType !== undefined) update.candidatesPerType = candidatesPerType(body.candidatesPerType);
    if (body.webResearchEnabled !== undefined) update.webResearchEnabled = readBoolean(body.webResearchEnabled, "webResearchEnabled");
    if (body.archived !== undefined) update.archivedAt = readBoolean(body.archived, "archived") ? new Date().toISOString() : null;
    if (body.segmentationModel !== undefined) update.segmentationModel = body.segmentationModel === null ? null : readSegmentationModel(repository, body.segmentationModel);
    applyModelFields(body, update, (providerId, modelId, kind) => verifyModel(repository, providerId, modelId, kind));
    return repository.updateProject(id, update) as object;
  });
  app.delete("/api/v1/projects/:projectId", async (request, reply) => {
    const id = parameter(request, "projectId");
    // 项目 ID 同时是存储目录名：这里只接受 UUID，杜绝 `../` 等穿越参数进入存储层删除越界目录
    if (!UUID_PATTERN.test(id)) throw new ApiError(400, "VALIDATION_ERROR", "projectId must be a UUID");
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
    const dimensions = await imageDimensions(content);
    await writeThumbnail(storage, hash, content);
    return repository.createAsset({ projectId, role, storagePath: stored.path, hash: stored.hash, originalName: data.filename, mimeType: data.mimetype, width: dimensions.width, height: dimensions.height });
  });
  // 先删文件再删行：行删了就找不到 storagePath；不级联分镜/输出/任务（契约 deleteAsset）
  app.delete("/api/v1/assets/:assetId", async (request, reply) => { const id = parameter(request, "assetId"); const asset = repository.getAsset(id); if (!asset) missing("asset", id); await storage.delete(asset.storagePath); repository.deleteAsset(id); return reply.code(204).send(); });
  // 资产库：assets/outputs/model_portraits/layer_exports 的全局只读视图，不复制文件、不落库；缩略图按内容 hash 共享。
  app.get("/api/v1/library-assets", async (request) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const kind = typeof query.kind === "string" && query.kind ? enumValue<LibraryItemKind>(query.kind, ["PRODUCT", "REFERENCE", "GENERATED", "LAYER", "MODEL", "PATTERN", "PRINT_PACK"], "kind") : null;
    const q = typeof query.q === "string" && query.q.trim() ? query.q.trim() : null;
    // 项目 ID 与路径参数同口径只接受 UUID：非法值返回 400，不静默当作没传。
    const projectId = typeof query.projectId === "string" && query.projectId.trim() ? query.projectId.trim() : null;
    if (projectId && !UUID_PATTERN.test(projectId)) throw new ApiError(400, "VALIDATION_ERROR", "projectId must be a UUID");
    const createdFrom = dateTimeParameter(query.createdFrom, "createdFrom");
    const createdTo = dateTimeParameter(query.createdTo, "createdTo");
    // 身份维度逐维收紧：任一维度非法即 400，不做「忽略该维度」的降级。
    const modelSpec = {
      gender: modelSpecParameter(query.modelGender, MODEL_GENDERS, "modelGender"),
      age: modelSpecParameter(query.modelAge, MODEL_AGES, "modelAge"),
      heritage: modelSpecParameter(query.modelHeritage, MODEL_HERITAGES, "modelHeritage"),
      stature: modelSpecParameter(query.modelStature, MODEL_STATURES, "modelStature"),
      build: modelSpecParameter(query.modelBuild, MODEL_BUILDS, "modelBuild"),
    };
    const cursor = typeof query.cursor === "string" && query.cursor ? query.cursor : null;
    const limit = typeof query.limit === "string" && query.limit ? Math.min(Math.max(Number.parseInt(query.limit, 10) || 40, 1), 100) : 40;
    const page = repository.listLibraryItems({ kind, q, projectId, createdFrom, createdTo, modelSpec, cursor, limit });
    return { items: page.items.map(publicLibraryAsset), nextCursor: page.nextCursor, total: page.total };
  });
  // 复制而非共享 storage_path：DELETE 资产会删物理文件、deleteProject 按项目目录清理，共享路径会互相破坏
  app.post("/api/v1/projects/:projectId/assets/from-library", async (request, reply) => {
    const projectId = parameter(request, "projectId"); ensureProject(repository, projectId);
    const body = parseBody(CopyLibraryAssetToProjectInput, request.body ?? {});
    const source = repository.resolveLibrarySource(body.itemId); if (!source) missing("library asset", body.itemId);
    const role = parseAssetRole(body.kind ?? body.role ?? source.role ?? "REFERENCE");
    assertProjectAssetCapacity(repository, projectId, role);
    assertProjectAssetHashUnique(repository, projectId, source.hash);
    if (!(await storage.exists(source.storagePath))) throw new ApiError(404, "NOT_FOUND", "Source file is missing");
    const content = await storage.read(source.storagePath);
    const originalName = source.originalName || "library-asset";
    const stored = await storage.putAsset(projectId, originalName, content);
    return reply.code(201).send(repository.createAsset({ projectId, role, storagePath: stored.path, hash: stored.hash, originalName, mimeType: source.mimeType, width: null, height: null }));
  });
  app.post("/api/v1/projects/:projectId/planning-jobs", async (request, reply) => {
    const projectId = parameter(request, "projectId"); const project = repository.getProject(projectId); if (!project) missing("project", projectId); const body = parseBody(CreatePlanningJobInput, request.body ?? {});
    if (project.defaultMode === "PIXEL_PROTECTED" && !repository.listAssets(projectId).some((asset) => asset.role === "PRODUCT_TRUTH" && asset.mimeType.startsWith("image/"))) {
      throw new ApiError(400, "VALIDATION_ERROR", "PIXEL_PROTECTED planning requires at least one PRODUCT_TRUTH image");
    }
    const requestedTypes = readOptionalTextArray(body.requestedTypes ?? body.imageTypes); if (requestedTypes?.length && resolveTemplatesWithUser(requestedTypes, compiledUserTemplates(repository)).length !== requestedTypes.length) throw new ApiError(400, "VALIDATION_ERROR", "requestedTypes contains an unknown ecom-details-image template ID or alias");
    const requestedSuiteShots = resolveRequestedSuiteShots(body.requestedSuiteShots, suiteCatalog);
    const planningMode = body.planningMode === undefined ? "AI" : enumValue<PlanningMode>(body.planningMode, ["AI", "MANUAL"], "planningMode");
    if (planningMode === "MANUAL" && !requestedTypes?.length && requestedSuiteShots.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "MANUAL planning requires requestedTypes or requestedSuiteShots");
    if (planningMode === "MANUAL" && requestedTypes?.length && requestedSuiteShots.length > 0) throw new ApiError(400, "VALIDATION_ERROR", "MANUAL planning accepts requestedTypes or requestedSuiteShots, not both");
    if (planningMode === "MANUAL" && body.targetImageCount !== undefined) throw new ApiError(400, "VALIDATION_ERROR", "targetImageCount is only supported for AI planning");
    if (planningMode === "AI" && requestedSuiteShots.length > 0) throw new ApiError(400, "VALIDATION_ERROR", "requestedSuiteShots is only supported for MANUAL planning");
    const targetImageCount = planningMode === "AI"
      ? body.targetImageCount === undefined ? DEFAULT_TARGET_IMAGE_COUNT : planningImageCount(body.targetImageCount)
      : undefined;
    const input = {
      // 规划修订号参与指纹：项目事实变化后旧规划任务不再被复用，避免结果基于过期内容
      planningRevision: project.planningRevision,
      planningMode,
      requestedTypes,
      requestedSuiteShots: requestedSuiteShots.length ? requestedSuiteShots : undefined,
      userInstruction: readOptionalText(body.userInstruction),
      candidatesPerType: body.candidatesPerType === undefined ? undefined : candidatesPerType(body.candidatesPerType),
      targetImageCount,
      imageResolution: body.imageResolution === undefined ? undefined : enumValue<ImageResolution>(body.imageResolution, IMAGE_RESOLUTIONS, "imageResolution"),
      imageAspectRatio: body.imageAspectRatio === undefined ? undefined : enumValue<ImageAspectRatio>(body.imageAspectRatio, IMAGE_ASPECT_RATIOS, "imageAspectRatio"),
      regenerationKey: readOptionalText(body.regenerationKey)
    };
    const fingerprint = requestFingerprint({ type: "PLAN", projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null }); const existing = repository.findJobByFingerprint(projectId, fingerprint); if (existing) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    verifyModel(repository, project.reasoningProviderId, project.reasoningModelId, "reasoning");
    const job = repository.createJob({ id: randomUUID(), projectId, storyboardItemId: null, type: "PLAN", input, requestFingerprint: fingerprint, providerId: project.reasoningProviderId, modelId: project.reasoningModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueueOrMarkFailed(job, "plan"); return reply.code(202).send(job);
  });
  app.get("/api/v1/projects/:projectId/planning-config-snapshots", async (request) => {
    const projectId = parameter(request, "projectId"); ensureProject(repository, projectId);
    return repository.listPlanningConfigSnapshots(projectId);
  });
  app.post("/api/v1/projects/:projectId/planning-config-snapshots/:snapshotId/apply", async (request) => {
    const projectId = parameter(request, "projectId"); const snapshotId = parameter(request, "snapshotId");
    ensureProject(repository, projectId); const snapshot = repository.getPlanningConfigSnapshot(snapshotId);
    if (!snapshot || snapshot.projectId !== projectId) missing("planning config snapshot", snapshotId);
    const payload = snapshot.payload;
    const project = payload.project;
    verifyModel(repository, project.reasoningProviderId, project.reasoningModelId, "reasoning");
    verifyModel(repository, project.imageProviderId, project.imageModelId, "image");
    const updated = repository.updateProject(projectId, {
      name: project.name, category: project.category, productDescription: project.productDescription,
      verifiedFacts: project.verifiedFacts, prohibitedClaims: project.prohibitedClaims, brandGuidelines: project.brandGuidelines,
      platformTargets: project.platformTargets, targetMarket: project.targetMarket, copyLanguage: project.copyLanguage,
      // 旧快照 payload 没有 promptLanguage，落到与创建时一致的默认值
      promptLanguage: project.promptLanguage ?? "CHINESE",
      reasoningProviderId: project.reasoningProviderId, reasoningModelId: project.reasoningModelId,
      imageProviderId: project.imageProviderId, imageModelId: project.imageModelId, defaultMode: project.defaultMode,
      imageResolution: project.imageResolution, imageAspectRatio: project.imageAspectRatio,
      candidatesPerType: project.candidatesPerType, webResearchEnabled: project.webResearchEnabled,
    });
    if (!updated) missing("project", projectId);
    return { project: updated, snapshot };
  });
  app.post("/api/v1/projects/:projectId/copywriting-jobs", async (request, reply) => {
    const projectId = parameter(request, "projectId");
    const project = repository.getProject(projectId);
    if (!project) missing("project", projectId);
    const productImages = repository.listAssets(projectId).filter((asset) => asset.role === "PRODUCT_TRUTH" && asset.mimeType.startsWith("image/"));
    if (productImages.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "AI copywriting requires at least one product image");
    verifyCopywritingModel(repository, project.reasoningProviderId, project.reasoningModelId);
    const body = parseBody(CreateCopywritingJobInput, request.body ?? {});
    const input = {
      target: enumValue<CopywritingTarget>(body.target, ["PRODUCT_DESCRIPTION", "PLANNING_INSTRUCTION"], "target"),
      regenerationKey: readText(body.regenerationKey, "regenerationKey"),
    };
    const fingerprint = requestFingerprint({ type: "COPYWRITE", projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null });
    const existing = repository.findJobByFingerprint(projectId, fingerprint);
    if (existing) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    const job = repository.createJob({
      id: randomUUID(), projectId, storyboardItemId: null, type: "COPYWRITE", input, requestFingerprint: fingerprint,
      providerId: project.reasoningProviderId, modelId: project.reasoningModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" },
    });
    await enqueueOrMarkFailed(job, "copywrite");
    return reply.code(202).send(job);
  });
}
