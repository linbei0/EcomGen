import { createHash, randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { fastifySSE } from "@fastify/sse";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { EcomRepository, LocalAssetStore, SecretBox, SuiteCatalog, settlePipelineStep, nextPipelineStep, openDatabase, pipelineStepPlan, requestFingerprint, resetPipelineStepsFrom, startPipelineStep, type AssetRecord, type EditReferenceAssetRecord, type EditSessionRecord, type JobRecord, type LayerExportRecord, type LayerPlanRecord, type LibraryItemRecord, type ModelPortraitRecord, type ModelRecord, type PatternPipelineWithSteps, type PatternRecord, type PrintPackRecord, type ProjectRecord, type ProviderRecord, type SearchSourceRecord, type SuiteForgeResultRecord, type SuiteListQuery, type UserTemplateRecord, SUITE_PAGE_SIZE_DEFAULT, SUITE_PAGE_SIZE_MAX } from "@ecomgen/core";
import { compileUserTemplate, ECOM_DETAILS_IMAGE_SOURCE, ECOM_TEMPLATES, PATTERN_FORGE_PROMPT_VERSION, PATTERN_VARIANT_PROMPT_VERSION, defaultPatternName, findModelSpecConflicts, getTemplate, isUserTemplateId, presetBelongsToAxis, resolveTemplatesWithUser } from "@ecomgen/ecom-skill";
import { SUITE_TAXONOMY, type SuiteDocumentInput, type SuiteOrigin } from "@ecomgen/ecom-suite";
import { createJobQueue, createRedisConnection, enqueue, queueKindForJobType, RedisProjectEventBus, type EcomJobKind } from "@ecomgen/jobs";
import type { AssetRole, CopywritingTarget, ImageAspectRatio, ImageResolution, JobType, LibraryItemKind, PatternBackgroundMode, PlanningMode, PlatformTarget, ReasoningProtocolProfile, SearchSourceKind, ModelSpec, SegmentationProtocol, StoryboardMode, TargetMarket, UserAssetKind, ReferencePurpose, ReferenceSelection } from "@ecomgen/contracts";
import { CopyLibraryAssetToProjectInput, CreateCopywritingJobInput, CreateExportJobRequest, CreateGenerationJobInput, CreateLayerExportInput, CreateLayerPlanInput, CreateModelCastJobInput, CreateModelInput, CreatePatternDeriveJobInput, CreatePatternExtractJobInput, CreatePatternForgeJobInput, CreatePatternListingJobInput, CreatePatternPipelineInput, ContinuePatternPipelineInput, PatternPipelineAnswers, CreatePatternVariantJobInput, CreatePlanningJobInput, CreatePrintPackJobInput, CreateProviderInput, CreateSearchSourceInput, CreateProjectInput, CreateUserTemplateInput, ConfirmStoryboardInput, EcomSuiteFile, EditGenerationConfigInput, SelectEditSessionOutputInput, TestProviderInput, UpdateEditSessionMemoryInput, UpdateModelInput, UpdatePatternInput, UpdateProjectInput, UpdateProviderInput, UpdateSearchSourceInput, UpdateStoryboardItemInput, UpdateUserTemplateInput, ASSET_ROLES, DEFAULT_CANDIDATES_PER_TYPE, DEFAULT_IMAGE_ASPECT_RATIO, DEFAULT_IMAGE_RESOLUTION, DEFAULT_TARGET_IMAGE_COUNT, IMAGE_ASPECT_RATIOS, IMAGE_RESOLUTIONS, MAX_CANDIDATES_PER_TYPE, MAX_GENERATION_REFERENCE_IMAGES, MAX_PATTERN_BRIEF_LENGTH, MAX_PATTERN_NAME_LENGTH, MAX_PATTERN_TAG_LENGTH, MAX_PRODUCT_IMAGE_ASSETS, MAX_REFERENCE_IMAGE_ASSETS, MAX_REQUESTED_SUITE_SHOTS, MAX_SUITE_FORGE_INSTRUCTION_LENGTH, MAX_SUITE_FORGE_NAME_LENGTH, MAX_SUITE_FORGE_SHOTS, MAX_SUITE_FORGE_SOURCES, MAX_TARGET_IMAGE_COUNT, MAX_UPLOAD_FILE_BYTES, MIN_SUITE_FORGE_SHOTS, MIN_TARGET_IMAGE_COUNT, MODEL_AGES, MODEL_BUILDS, MODEL_GENDERS, MODEL_HERITAGES, MODEL_STATURES, PLATFORM_TARGETS, LISTING_PLATFORMS, PATTERN_PIPELINE_STEPS, PATTERN_TAGS_MAX, POD_MOCKUP_SCENE_VERSION, POD_PRINT_SPECS, POD_PRINT_SPEC_VERSION, SEGMENTATION_PROTOCOL_CAPABILITIES, SEGMENTATION_PROTOCOLS, TILEABILITY_ALGORITHM_VERSION, getPodPrintSpec, roleForUserAssetKind, supportsTransparentBackground, validateEcomSuiteFile } from "@ecomgen/contracts";
import { GeminiImageProvider, OpenAiCompatibleImageProvider, ProviderError, SeedreamLayerizeProvider, createSegmentationProvider, probeReasoning, type PromptSegmentationProtocol } from "@ecomgen/providers";

import { ApiError } from "./errors.js";
import { applyModelFields, parseModelRef } from "./projectPatch.js";
import { parseBody } from "./http-input.js";
import { registerWebStatic } from "./web-static.js";
import { enumArray, enumValue, normalizeModels, objectOfStrings, parameter, readBoolean, readJsonObject, readJsonTextArray, readObject, readOptionalText, readOptionalTextArray, readPatchText, readPriority, readText, readTextArray, searchSourceBaseUrl } from "./input-normalizers.js";

export interface ApiOptions { dataDir: string; redisUrl: string; masterKey: string; corsOrigins?: string[]; }

/** 未显式配置时的默认允许来源：本机 web dev server。API 自托管前端时为同源请求，不依赖 CORS。 */
export const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

/**
 * 校验 CORS 允许列表：项目没有认证层，允许任意来源等于把读写接口开放给任意站点。
 * 拒绝通配符、空值和非 origin 形态（带路径、查询或非 http/https 协议），让配置错误在启动时暴露。
 */
export function resolveCorsOrigins(configured?: string[]): string[] {
  const origins = configured ?? DEFAULT_CORS_ORIGINS;
  if (origins.length === 0) throw new Error("CORS origins must not be empty");
  for (const origin of origins) {
    if (origin.trim() !== origin || origin === "") throw new Error(`Invalid CORS origin: "${origin}"`);
    if (origin === "*") throw new Error("CORS origin must not be a wildcard; list explicit origins instead");
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new Error(`Invalid CORS origin: "${origin}"`); }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new Error(`Invalid CORS origin (must be scheme://host[:port]): "${origin}"`);
    }
  }
  return origins;
}

export async function buildApi(options: ApiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, genReqId: () => randomUUID() });
  const database = openDatabase(join(options.dataDir, "ecomgen.sqlite"));
  const repository = new EcomRepository(database);
  const suiteCatalog = new SuiteCatalog({ dataDir: options.dataDir, repository });
  await suiteCatalog.refresh();
  const storage = new LocalAssetStore(options.dataDir); await storage.initialize();
  const secrets = new SecretBox(options.masterKey);
  const redis = createRedisConnection(options.redisUrl);
  const queue = createJobQueue(redis);
  const events = new RedisProjectEventBus(redis.duplicate(), redis.duplicate());
  await app.register(cors, { origin: resolveCorsOrigins(options.corsOrigins) });
  // 全局 multipart 上限作用于所有上传路由；files 取套图源图上限，因为它是唯一的批量多文件入口。
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_FILE_BYTES, files: MAX_SUITE_FORGE_SOURCES } });
  await app.register(fastifySSE, { heartbeatInterval: 20_000 });
  app.addHook("onClose", async () => { await events.close(); await queue.close(); database.close(); });
  /**
   * 入队是持久化之后的第二步：数据库已落 QUEUED 而入队失败时，任务永远不会执行，
   * 且相同指纹会继续复用这个坏状态。这里把尚未入队的任务统一落为 FAILED(QUEUE_UNAVAILABLE)
   * 并发布状态事件；顺序入队保证只回滚真正未入队的任务，已入队的照常执行。
   */
  /**
   * pending 全部尝试入队；失败时只把 markable（默认即 pending，生成批次要传“本次新建”子集）
   * 及其后未入队者统一落为 FAILED(QUEUE_UNAVAILABLE) 并发布事件——按指纹复用的既有任务
   * 不属于本请求的失败面，不能被改写状态。顺序入队保证只回滚真正未入队的任务，已入队的照常执行。
   */
  async function enqueueOrMarkFailed(pending: JobRecord | JobRecord[], kind: EcomJobKind, options: { onFail?: (jobId: string) => void; markable?: JobRecord[] } = {}): Promise<void> {
    const jobs = Array.isArray(pending) ? pending : [pending];
    const markable = new Set((options.markable ?? jobs).map((job) => job.id));
    for (let index = 0; index < jobs.length; index++) {
      const job = jobs[index];
      try {
        await enqueue(queue, { jobId: job.id, kind });
      } catch (error) {
        app.log.error(error, "enqueue failed for job %s", job.id);
        const message = "任务已创建但队列暂不可用，请稍后重试";
        for (const remaining of jobs.slice(index)) {
          if (!markable.has(remaining.id)) continue;
          options.onFail?.(remaining.id);
          const failed = repository.updateJob(remaining.id, { status: "FAILED", progress: 100, error: { code: "QUEUE_UNAVAILABLE", message } });
          if (failed && failed.projectId) await events.publish(failed.projectId, "job.updated", failed);
        }
        throw new ApiError(503, "QUEUE_UNAVAILABLE", message);
      }
    }
  }
  /**
   * 请求取消一个任务：已失败任务直接落 CANCELLED（没有可中断的队列工作，但需要关闭失败提示并留审计记录）；
   * 仍在队列中等待的移出队列；已在执行的只置取消标记，由 Worker 断开在途请求。
   * 抽成函数是因为流水线取消也要走同一条路径——两处各写一份必然会丢其中一种情况。
   */
  async function requestJobCancellation(id: string): Promise<JobRecord> {
    const current = repository.getJob(id);
    if (!current) missing("job", id);
    if (current.status === "FAILED") return repository.updateJob(id, { status: "CANCELLED", cancelRequested: true }) ?? current;
    const queued = await queue.getJob(id);
    const state = queued ? await queued.getState() : "unknown";
    if (queued && ["waiting", "delayed", "prioritized"].includes(state)) {
      await queued.remove();
      return repository.updateJob(id, { status: "CANCELLED", cancelRequested: true }) ?? current;
    }
    return repository.updateJob(id, { cancelRequested: true }) ?? current;
  }
  /**
   * 建链（三问一跑）：校验两个答案 → 建流水线 → 起跑第一步。
   *
   * 从既有花型起链（POST /patterns/:patternId/pipelines）与"源入口顺带成包"共用本函数：
   * 两处对同一份答案必须给出同一套校验、默认值、指纹与步骤表，分开写必然漂移。
   *
   * 两种起跑方式刻意不同：
   * - 从既有花型：立刻建第一个步骤的任务并入队（图案已经在库里）。
   * - 从源入口：SOURCE 步骤绑定来源任务、只置队列中，**不入队**——图案要等来源任务产出了才有，
   *   由 Worker 在来源任务成功后推进（见 worker 的 advancePatternPipeline）。
   */
  async function startPatternPipeline(input: {
    patternId: string | null;
    patternHash: string | null;
    answers: PatternPipelineAnswers;
    sourceJobId?: string;
    idempotencyKey?: string | null;
  }): Promise<{ pipeline: PatternPipelineWithSteps; reused: boolean }> {
    const spec = validatePatternPipelineAnswers(repository, input.answers);
    const layout = input.answers.layout ?? "CENTERED";
    const repeatLayout = layout === "TILE" ? input.answers.repeatLayout ?? "STRAIGHT" : "STRAIGHT";
    const idempotencyKey = input.idempotencyKey ?? null;
    const fingerprint = requestFingerprint({ type: "PATTERN_PIPELINE", patternId: input.patternId, patternHash: input.patternHash, specId: spec.id, specVersion: POD_PRINT_SPEC_VERSION, layout, repeatLayout, listingPlatform: input.answers.listingPlatform, listingProviderId: input.answers.listingProviderId, listingModelId: input.answers.listingModelId, sellingPoints: input.answers.sellingPoints ?? null, bannedWords: input.answers.bannedWords ?? null, idempotencyKey });
    // 只复用进行中的同参数流水线：已完成的再点一次是"再出一套"的明确意图，复用会静默无事发生。
    const reusable = repository.findReusablePatternPipeline(fingerprint);
    if (reusable) return { pipeline: reusable, reused: true };
    const fromSource = Boolean(input.sourceJobId);
    const pipeline = repository.createPatternPipeline({
      patternId: input.patternId,
      specId: spec.id,
      specVersion: POD_PRINT_SPEC_VERSION,
      layout,
      repeatLayout,
      listingPlatform: input.answers.listingPlatform,
      listingProviderId: input.answers.listingProviderId,
      listingModelId: input.answers.listingModelId,
      listingHints: { sellingPoints: input.answers.sellingPoints ?? null, bannedWords: input.answers.bannedWords ?? null },
      requestFingerprint: fingerprint,
      steps: pipelineStepPlan(fromSource),
    });
    const first = pipeline.steps[0];
    if (!first) throw new ApiError(500, "INTERNAL_ERROR", "流水线没有可执行的步骤");
    if (input.sourceJobId) {
      repository.updatePatternPipelineStep(first.id, { status: "QUEUED", jobId: input.sourceJobId });
      const running = repository.updatePatternPipeline(pipeline.id, { status: "RUNNING" }) ?? pipeline;
      return { pipeline: running, reused: false };
    }
    if (!input.patternId) throw new ApiError(500, "INTERNAL_ERROR", "流水线缺少花型，无法起跑");
    const started = startPipelineStep(repository, pipeline, first, input.patternId);
    await enqueueOrMarkFailed(started.job, queueKindForJobType(started.jobType), { onFail: (jobId) => settlePipelineStep(repository, jobId, "FAILED", { code: "QUEUE_UNAVAILABLE", message: "任务已创建但队列暂不可用" }) });
    return { pipeline: repository.getPatternPipeline(pipeline.id) ?? pipeline, reused: false };
  }
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof ApiError;
    const status = known ? error.statusCode : 500;
    request.log.error(error);
    return reply.status(status).send({ error: { code: known ? error.code : "INTERNAL_ERROR", message: known ? error.message : "Unexpected server error", details: known ? error.details : [], requestId: request.id } });
  });

  app.get("/health", async () => ({ status: "ok", webResearchAvailable: repository.listSearchSources().some((source) => source.enabled && (source.kind === "searxng" || source.encryptedApiKey)) }));
  app.get("/api/v1/ecom-templates", async () => ({ source: ECOM_DETAILS_IMAGE_SOURCE, items: ECOM_TEMPLATES }));
  app.get("/api/v1/user-templates", async () => ({ items: repository.listUserTemplates().map(publicUserTemplate), nextCursor: null }));
  app.post("/api/v1/user-templates", async (request, reply) => {
    const body = parseBody(CreateUserTemplateInput, request.body);
    // custom- 前缀与内置 ID 空间隔离；8 位 hex 撞库概率可忽略，仍做一次冲突重试保证唯一
    let id = `custom-${randomBytes(4).toString("hex")}`;
    if (repository.getUserTemplate(id)) id = `custom-${randomBytes(4).toString("hex")}`;
    const record = repository.saveUserTemplate({
      id,
      name: readText(body.name, "name"),
      prompt: readText(body.prompt, "prompt"),
      defaultSize: body.defaultSize === undefined ? "1024x1024" : enumValue(body.defaultSize, ["1024x1024", "1024x1536"], "defaultSize"),
      supportsImageReference: body.supportsImageReference === undefined ? true : readBoolean(body.supportsImageReference, "supportsImageReference")
    });
    return reply.code(201).send(publicUserTemplate(record));
  });
  app.patch("/api/v1/user-templates/:templateId", async (request) => {
    const id = parameter(request, "templateId"); const current = repository.getUserTemplate(id); if (!current) missing("user template", id);
    const body = parseBody(UpdateUserTemplateInput, request.body);
    const record = repository.saveUserTemplate({
      id,
      name: body.name === undefined ? current.name : readText(body.name, "name"),
      prompt: body.prompt === undefined ? current.prompt : readText(body.prompt, "prompt"),
      defaultSize: body.defaultSize === undefined ? current.defaultSize : enumValue(body.defaultSize, ["1024x1024", "1024x1536"], "defaultSize"),
      supportsImageReference: body.supportsImageReference === undefined ? current.supportsImageReference : readBoolean(body.supportsImageReference, "supportsImageReference")
    });
    return publicUserTemplate(record);
  });
  app.delete("/api/v1/user-templates/:templateId", async (request, reply) => {
    const id = parameter(request, "templateId"); if (!repository.getUserTemplate(id)) missing("user template", id);
    // 模板是规划期资产：允许删除，引用它的旧分镜在生成期显式报错（见 worker 模板解析），不做静默降级
    repository.deleteUserTemplate(id);
    return reply.code(204).send();
  });
  app.get("/api/v1/suites", async (request) => suiteCatalog.pageSummaries(parseSuiteListQuery(request.query)));
  app.get("/api/v1/suite-categories", async () => ({ l1: [...SUITE_TAXONOMY.l1], l2: SUITE_TAXONOMY.l2 }));
  app.post("/api/v1/suites/refresh", async () => { await suiteCatalog.refresh(); return suiteCatalog.pageSummaries(); });
  app.get("/api/v1/suites/:suiteId", async (request) => {
    const id = parameter(request, "suiteId"); const suite = suiteCatalog.getSuite(id); if (!suite) missing("suite", id);
    return suite;
  });
  app.post("/api/v1/suites", async (request, reply) => {
    const body = parseBody(EcomSuiteFile, request.body);
    assertValidSuiteDocument(body);
    const id = suiteIdForImport(body.id, suiteCatalog);
    const record = repository.saveUserSuite({ id, name: body.name, l1: body.category.l1, l2: body.category.l2, leaf: body.category.leaf, productFamily: body.productFamily ?? null, payload: { ...body, id } });
    suiteCatalog.upsertUserSuite(record);
    const suite = suiteCatalog.getSuite(id); if (!suite) throw new ApiError(500, "INTERNAL_ERROR", "Suite was saved but could not be indexed");
    return reply.code(201).send(suite);
  });
  app.patch("/api/v1/suites/:suiteId", async (request) => {
    const id = parameter(request, "suiteId"); if (!repository.getUserSuite(id)) missing("user suite", id);
    const body = parseBody(EcomSuiteFile, request.body);
    assertValidSuiteDocument(body);
    const record = repository.saveUserSuite({ id, name: body.name, l1: body.category.l1, l2: body.category.l2, leaf: body.category.leaf, productFamily: body.productFamily ?? null, payload: { ...body, id } });
    suiteCatalog.upsertUserSuite(record);
    const suite = suiteCatalog.getSuite(id); if (!suite) missing("suite", id);
    return suite;
  });
  app.delete("/api/v1/suites/:suiteId", async (request, reply) => {
    const id = parameter(request, "suiteId");
    // 内置套图与目录投放套图不落库，只有导入套图可删；引用它的旧分镜在生成期显式报错，不做静默降级
    if (!repository.getUserSuite(id)) throw new ApiError(409, "CONFLICT", "Only user-imported suites can be deleted");
    repository.deleteUserSuite(id);
    suiteCatalog.removeUserSuite(id);
    return reply.code(204).send();
  });
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
  app.get("/api/v1/files/models/:modelId/reference-face", async (request, reply) => {
    const model = repository.getModel(parameter(request, "modelId"));
    if (!model?.referenceFacePath) missing("reference face", parameter(request, "modelId"));
    return sendStored(request, reply, storage, { storagePath: model.referenceFacePath, hash: model.referenceFaceHash ?? undefined }, "reference face", parameter(request, "modelId"));
  });
  app.get("/api/v1/files/model-portraits/:portraitId", async (request, reply) => {
    const portrait = repository.getModelPortrait(parameter(request, "portraitId"));
    if (!portrait) missing("model portrait", parameter(request, "portraitId"));
    return sendStored(request, reply, storage, portrait, "model portrait", parameter(request, "portraitId"));
  });

  // ---- 花型工坊：全局花型库 + 提取/起稿/规格包/Listing 文案任务。任务不绑定项目，前端依赖任务轮询。 ----
  app.get("/api/v1/patterns", async () => {
    // 无产物的行（提取排队中或失败）对库不可见：主图路径落盘前它没有可展示的内容。
    const items = repository.listPatterns().filter((record) => record.storagePath).map(publicPattern);
    return { items, nextCursor: null };
  });
  app.get("/api/v1/patterns/:patternId", async (request) => {
    const pattern = ensurePattern(repository, parameter(request, "patternId"));
    return publicPattern(pattern);
  });
  app.delete("/api/v1/patterns/:patternId", async (request, reply) => {
    const pattern = ensurePattern(repository, parameter(request, "patternId"));
    // 先清文件再删行：行删了就找不到存储路径；文件清理失败时保留记录可重试（与模特删除同理）。
    await storage.deletePattern(pattern.id);
    repository.deletePattern(pattern.id);
    return reply.code(204).send();
  });
  app.patch("/api/v1/patterns/:patternId", async (request) => {
    const current = ensurePattern(repository, parameter(request, "patternId"));
    const body = parseBody(UpdatePatternInput, request.body);
    const patch: { name?: string; tags?: string[] } = {};
    if (body.name !== undefined) patch.name = readText(body.name, "name");
    if (body.tags !== undefined) patch.tags = body.tags.map((tag) => readText(tag, "tag"));
    const record = repository.updatePattern(current.id, patch) ?? current;
    return publicPattern(record);
  });
  // 提取：源图以 multipart 上传并作为来源血缘留痕；分割 Provider 由页面自选（全局页没有项目配置可继承）。
  app.post("/api/v1/patterns/extract-jobs", async (request, reply) => {
    const { upload, fields } = await readSingleImageMultipart(request, "source image");
    const providerId = readText(fields.providerId, "providerId");
    const modelId = readText(fields.modelId, "modelId");
    const { protocol } = resolvePatternSegmentationModel(repository, providerId, modelId, readOptionalText(fields.protocol));
    const brief = optionalBoundedText(readOptionalText(fields.brief), MAX_PATTERN_BRIEF_LENGTH, "brief");
    const name = optionalBoundedText(readOptionalText(fields.name), MAX_PATTERN_NAME_LENGTH, "name");
    const tags = parsePatternTags(readOptionalText(fields.tags));
    const idempotencyKey = readOptionalText(fields.idempotencyKey) ?? (request.headers["idempotency-key"] as string | undefined) ?? null;
    // 成包答案先校验：请求要失败就该在落源图、建任务之前失败，不留半个花型。
    const answers = readPatternPipelineAnswers(fields.pipeline);
    if (answers) validatePatternPipelineAnswers(repository, answers);
    const sourceHash = contentHash(upload.buffer);
    const fingerprint = requestFingerprint({ type: "PATTERN_EXTRACT", providerId, modelId, protocol, sourceHash, brief: brief ?? null, name: name ?? null, tags, idempotencyKey });
    const existing = repository.findJobByFingerprint(null, fingerprint);
    // 在途照常复用；SUCCEEDED 花型被删后按同指纹重提必须新建，否则只会复用一个不再产出花型的旧任务。
    if (existing && reusableFingerprintedJob(existing, repository.hasPatternArtifactsByJobId(existing.id))) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    const jobId = randomUUID();
    const patternId = randomUUID();
    // 源图先落 patterns/<id>/ 作为血缘留痕：提取成功后与花型同目录，删除花型时一并清理。
    const storedSource = await storage.putPatternSource(patternId, upload.filename, upload.buffer);
    const job = repository.createJob({ id: jobId, projectId: null, storyboardItemId: null, type: "PATTERN_EXTRACT", input: { patternId, sourcePath: storedSource.path, sourceHash: storedSource.hash, name: name ?? null, brief: brief ?? null, tags, segmentationProviderId: providerId, segmentationModelId: modelId, segmentationProtocol: protocol }, requestFingerprint: fingerprint, providerId, modelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    repository.createPattern({ id: patternId, name: name ?? defaultPatternName(brief ?? upload.filename.replace(/\.[^.]+$/, "")), sourceType: "EXTRACTED", sourceJobId: jobId, sourceAssetHash: storedSource.hash, parentPatternId: null, storagePath: null, fileHash: null, width: null, height: null, tags });
    // 流水线必须在入队之前建好并绑上 SOURCE 步骤：Worker 可能在本请求返回前就完成提取，
    // 那时若还没有步骤行，推进就找不到落点，整条链永远不会启动。
    if (answers) {
      await startPatternPipeline({ patternId, patternHash: null, answers, sourceJobId: jobId, idempotencyKey });
    }
    // 入队失败不回滚花型行：无产物的行对库不可见，任务重试会复用同一行（含已留痕的源图）。
    await enqueueOrMarkFailed(job, "pattern_extract", { onFail: (failedJobId) => settlePipelineStep(repository, failedJobId, "FAILED", { code: "QUEUE_UNAVAILABLE", message: "任务已创建但队列暂不可用" }) });
    return reply.code(202).send(job);
  });
  // 上传花型文件：跳过提取，直接以本地文件入库（来源 UPLOADED），供规格包与文案复用。
  app.post("/api/v1/patterns/upload", async (request, reply) => {
    const { upload, fields } = await readSingleImageMultipart(request, "pattern image");
    const name = optionalBoundedText(readOptionalText(fields.name), MAX_PATTERN_NAME_LENGTH, "name");
    const tags = parsePatternTags(readOptionalText(fields.tags));
    // 同上：答案不合法时整个请求失败，不留孤儿花型。
    const answers = readPatternPipelineAnswers(fields.pipeline);
    if (answers) validatePatternPipelineAnswers(repository, answers);
    const patternId = randomUUID();
    // 统一归一化为 PNG 再入库：客户端声明的 mimetype 不可信，而下游有一整串"花型即 PNG"的假设
    // （存储扩展名、衍生时发往 images/edits 的 mimeType、文件接口回传的 Content-Type），
    // JPEG/WebP 直接入库会让它们全部失真；顺手把解码失败挡在入库之前。
    const patternPng = await sharp(upload.buffer).png().toBuffer();
    const stored = await storage.putPatternArtifact(patternId, "pattern", patternPng);
    const dimensions = await imageDimensions(patternPng);
    const record = repository.createPattern({ id: patternId, name: name ?? defaultPatternName(upload.filename.replace(/\.[^.]+$/, "")), sourceType: "UPLOADED", sourceJobId: null, sourceAssetHash: stored.hash, parentPatternId: null, storagePath: stored.path, fileHash: stored.hash, width: dimensions.width, height: dimensions.height, tags });
    // 上传没有来源任务可等，图案此刻就在库里，所以直接按"从既有花型起链"的方式起跑。
    if (answers) await startPatternPipeline({ patternId: record.id, patternHash: record.fileHash, answers });
    return reply.code(201).send(publicPattern(record));
  });
  // AI 起稿：主题/风格是入队快照，prompt 由 ecom-skill 的编译函数确定性派生；每张候选独立成花型。
  app.post("/api/v1/patterns/forge-jobs", async (request, reply) => {
    const body = parseBody(CreatePatternForgeJobInput, request.body);
    verifyModel(repository, body.providerId, body.imageModelId, "image");
    const background = body.background ?? "WHITE";
    assertTransparentBackgroundAvailable(repository, body.providerId, body.imageModelId, background);
    const candidateCount = body.candidateCount ?? 1;
    const idempotencyKey = body.idempotencyKey ?? (request.headers["idempotency-key"] as string | undefined) ?? null;
    // background 进指纹：它改的是编译后的提示词，不进指纹就会让"同主题不同底版"的两个请求互相复用。
    const fingerprint = requestFingerprint({ type: "PATTERN_FORGE", providerId: body.providerId, imageModelId: body.imageModelId, theme: body.theme, style: body.style ?? null, category: body.category ?? null, background, candidateCount, name: body.name ?? null, promptVersion: PATTERN_FORGE_PROMPT_VERSION, idempotencyKey });
    const existing = repository.findJobByFingerprint(null, fingerprint);
    // 在途照常复用（起稿的花型随候选完成才落库，不能要求在途已有产物）；产物被删光后同指纹重提必须新建。
    if (existing && reusableFingerprintedJob(existing, repository.hasPatternArtifactsByJobId(existing.id))) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: "PATTERN_FORGE", input: { theme: body.theme, style: body.style ?? null, category: body.category ?? null, background, candidateCount, name: body.name ?? null }, requestFingerprint: fingerprint, providerId: body.providerId, modelId: body.imageModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    // 与提取同理：流水线先建好再入队，Worker 才找得到 SOURCE 步骤；多候选时由第一张有产物的候选起链。
    if (body.pipeline) await startPatternPipeline({ patternId: null, patternHash: null, answers: body.pipeline, sourceJobId: job.id, idempotencyKey });
    await enqueueOrMarkFailed(job, "pattern_forge", { onFail: (failedJobId) => settlePipelineStep(repository, failedJobId, "FAILED", { code: "QUEUE_UNAVAILABLE", message: "任务已创建但队列暂不可用" }) });
    return reply.code(202).send(job);
  });
  // 规格包：花型 × 规格条目的确定性合成，双记录模式（createJob → createPrintPack → onFail 标记失败）。
  app.post("/api/v1/patterns/:patternId/print-pack-jobs", async (request, reply) => {
    const pattern = ensurePattern(repository, parameter(request, "patternId"));
    if (!pattern.storagePath) throw new ApiError(409, "CONFLICT", "该花型还没有可用的图稿产物，无法生成规格包");
    const body = parseBody(CreatePrintPackJobInput, request.body);
    const spec = getPodPrintSpec(body.specId);
    if (!spec) throw new ApiError(400, "VALIDATION_ERROR", `未知的印刷规格：${body.specId}`);
    const idempotencyKey = body.idempotencyKey ?? (request.headers["idempotency-key"] as string | undefined) ?? null;
    const layout = body.layout ?? "CENTERED";
    const repeatLayout = body.repeatLayout ?? "STRAIGHT";
    // 排列只在满印下有意义：显式带排列却选居中是矛盾答案，拒绝而不是静默忽略。
    if (body.repeatLayout && layout !== "TILE") throw new ApiError(400, "VALIDATION_ERROR", "平铺排列仅在满印（TILE）版式下生效");
    const fingerprint = requestFingerprint({ type: "PRINT_PACK", patternId: pattern.id, patternHash: pattern.fileHash, specId: spec.id, layout, repeatLayout, specVersion: POD_PRINT_SPEC_VERSION, idempotencyKey });
    const existing = repository.findJobByFingerprint(null, fingerprint);
    if (existing) {
      const pack = repository.getPrintPackByJobId(existing.id);
      // 在途任务照常复用；SUCCEEDED 包的场景渲染版本落后（manifest.mockupScene 非当前）时不再复用，
      // 同指纹新建任务重渲示意图（findJobByFingerprint 取最新一条，旧包保留在历史列表）；FAILED 放行走新建。
      const manifestScene = pack?.manifest && typeof pack.manifest.mockupScene === "string" ? pack.manifest.mockupScene : null;
      const reusable = existing.status === "QUEUED" || existing.status === "RUNNING" || (existing.status === "SUCCEEDED" && manifestScene === POD_MOCKUP_SCENE_VERSION);
      if (reusable) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send({ job: existing, printPack: pack ? publicPrintPack(pack) : null });
    }
    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: "PRINT_PACK", input: { patternId: pattern.id, specId: spec.id, specVersion: POD_PRINT_SPEC_VERSION, layout, repeatLayout }, requestFingerprint: fingerprint, estimatedCost: { status: "UNKNOWN", unit: "local-storage" } });
    const printPack = repository.createPrintPack({ patternId: pattern.id, jobId: job.id, specId: spec.id, specVersion: POD_PRINT_SPEC_VERSION, status: "QUEUED" });
    await enqueueOrMarkFailed(job, "print_pack", { onFail: (failedJobId) => markDomainRecordFailed(repository, "PRINT_PACK", failedJobId) });
    return reply.code(202).send({ job, printPack: publicPrintPack(printPack) });
  });
  // 花型衍生：确定性本地改色运算（HSL 调制），产出一 new 花型；同参数复用既有任务。
  app.post("/api/v1/patterns/:patternId/derive-jobs", async (request, reply) => {
    const pattern = ensurePattern(repository, parameter(request, "patternId"));
    if (!pattern.storagePath) throw new ApiError(409, "CONFLICT", "该花型还没有可用的图稿产物，无法衍生");
    const body = parseBody(CreatePatternDeriveJobInput, request.body);
    if (body.hueShift === undefined && body.saturationPct === undefined && body.brightnessPct === undefined) {
      throw new ApiError(400, "VALIDATION_ERROR", "改色至少需要提供色相、饱和度或亮度之一");
    }
    const idempotencyKey = body.idempotencyKey ?? (request.headers["idempotency-key"] as string | undefined) ?? null;
    const fingerprint = requestFingerprint({ type: "PATTERN_DERIVE", patternId: pattern.id, patternHash: pattern.fileHash, hueShift: body.hueShift ?? null, saturationPct: body.saturationPct ?? null, brightnessPct: body.brightnessPct ?? null, idempotencyKey });
    const existing = repository.findJobByFingerprint(null, fingerprint);
    // 与提取/起稿同规：在途照常复用；衍生产物被删后同指纹重提必须新建，不再复用孤儿任务。
    if (existing && reusableFingerprintedJob(existing, repository.hasPatternArtifactsByJobId(existing.id))) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: "PATTERN_DERIVE", input: { patternId: pattern.id, hueShift: body.hueShift ?? null, saturationPct: body.saturationPct ?? null, brightnessPct: body.brightnessPct ?? null }, requestFingerprint: fingerprint, estimatedCost: { status: "UNKNOWN", unit: "local-storage" } });
    await enqueueOrMarkFailed(job, "pattern_derive");
    return reply.code(202).send(job);
  });
  // 生成式衍生（画风 / 构图）：源花型作参考图走 images/edits，每张候选产出独立新花型（血缘指向源）。
  // 与起稿同规：Provider/模型入队快照 + 指纹复用；付费生图，失败不自动重跑。
  app.post("/api/v1/patterns/:patternId/variant-jobs", async (request, reply) => {
    const pattern = ensurePattern(repository, parameter(request, "patternId"));
    if (!pattern.storagePath) throw new ApiError(409, "CONFLICT", "该花型还没有可用的图稿产物，无法衍生");
    const body = parseBody(CreatePatternVariantJobInput, request.body);
    verifyModel(repository, body.providerId, body.imageModelId, "image");
    // 契约把 preset 限死为枚举，轴向归属在编译层单点判定，避免两处各写一份预设清单。
    if (!presetBelongsToAxis(body.axis, body.preset)) throw new ApiError(400, "VALIDATION_ERROR", `预设 ${body.preset} 不属于轴向 ${body.axis}`);
    const background = body.background ?? "SOURCE";
    assertTransparentBackgroundAvailable(repository, body.providerId, body.imageModelId, background);
    const candidateCount = body.candidateCount ?? 1;
    const idempotencyKey = body.idempotencyKey ?? (request.headers["idempotency-key"] as string | undefined) ?? null;
    const fingerprint = requestFingerprint({ type: "PATTERN_VARIANT", patternId: pattern.id, patternHash: pattern.fileHash, axis: body.axis, preset: body.preset, extra: body.extra ?? null, background, providerId: body.providerId, imageModelId: body.imageModelId, candidateCount, name: body.name ?? null, promptVersion: PATTERN_VARIANT_PROMPT_VERSION, idempotencyKey });
    const existing = repository.findJobByFingerprint(null, fingerprint);
    // 候选随完成才落库，在途照常复用；产物被删光后同指纹重提必须新建，不再复用孤儿任务。
    if (existing && reusableFingerprintedJob(existing, repository.hasPatternArtifactsByJobId(existing.id))) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: "PATTERN_VARIANT", input: { patternId: pattern.id, axis: body.axis, preset: body.preset, extra: body.extra ?? null, background, candidateCount, name: body.name ?? null }, requestFingerprint: fingerprint, providerId: body.providerId, modelId: body.imageModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueueOrMarkFailed(job, "pattern_variant");
    return reply.code(202).send(job);
  });
  // 验缝：本地确定性环绕位移判定，零费用、不改动花型像素；这条路径是 tileable* 的唯一写入方。
  app.post("/api/v1/patterns/:patternId/tile-check-jobs", async (request, reply) => {
    const pattern = ensurePattern(repository, parameter(request, "patternId"));
    if (!pattern.storagePath) throw new ApiError(409, "CONFLICT", "该花型还没有可用的图稿产物，无法验缝");
    const idempotencyKey = (request.headers["idempotency-key"] as string | undefined) ?? null;
    // 算法版本进指纹：阈值或度量口径升级后，同花型重提自然新建任务，而不是复用一个按旧算法判定的旧任务。
    const fingerprint = requestFingerprint({ type: "PATTERN_TILE_CHECK", patternId: pattern.id, patternHash: pattern.fileHash, algorithmVersion: TILEABILITY_ALGORITHM_VERSION, idempotencyKey });
    const existing = repository.findJobByFingerprint(null, fingerprint);
    if (existing) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: "PATTERN_TILE_CHECK", input: { patternId: pattern.id }, requestFingerprint: fingerprint, estimatedCost: { status: "UNKNOWN", unit: "local-storage" } });
    await enqueueOrMarkFailed(job, "pattern_tile_check");
    return reply.code(202).send(job);
  });
  app.get("/api/v1/patterns/:patternId/print-packs", async (request) => {
    const pattern = ensurePattern(repository, parameter(request, "patternId"));
    return { items: repository.listPrintPacks(pattern.id).map(publicPrintPack) };
  });
  app.get("/api/v1/print-packs/:printPackId", async (request) => {
    const pack = repository.getPrintPack(parameter(request, "printPackId"));
    if (!pack) missing("print pack", parameter(request, "printPackId"));
    return publicPrintPack(pack);
  });
  // Listing 文案：COPYWRITE 的全局扩展，看图写跨境标题/tags/描述；结果存 pattern_listing_results。
  app.post("/api/v1/patterns/:patternId/listing-jobs", async (request, reply) => {
    const pattern = ensurePattern(repository, parameter(request, "patternId"));
    if (!pattern.storagePath) throw new ApiError(409, "CONFLICT", "该花型还没有可用的图稿产物，无法生成 Listing 文案");
    const body = parseBody(CreatePatternListingJobInput, request.body);
    verifyCopywritingModel(repository, body.providerId, body.modelId);
    const idempotencyKey = body.idempotencyKey ?? (request.headers["idempotency-key"] as string | undefined) ?? null;
    const fingerprint = requestFingerprint({ type: "COPYWRITE", target: "LISTING", patternId: pattern.id, patternHash: pattern.fileHash, platform: body.platform, sellingPoints: body.sellingPoints ?? null, mustIncludeWords: body.mustIncludeWords ?? null, bannedWords: body.bannedWords ?? null, providerId: body.providerId, modelId: body.modelId, idempotencyKey });
    const existing = repository.findJobByFingerprint(null, fingerprint);
    if (existing) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: "COPYWRITE", input: { target: "LISTING", patternId: pattern.id, platform: body.platform, sellingPoints: body.sellingPoints ?? null, mustIncludeWords: body.mustIncludeWords ?? null, bannedWords: body.bannedWords ?? null }, requestFingerprint: fingerprint, providerId: body.providerId, modelId: body.modelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueueOrMarkFailed(job, "copywrite");
    return reply.code(202).send(job);
  });
  app.get("/api/v1/patterns/:patternId/listing-jobs/:jobId/result", async (request) => {
    const patternId = parameter(request, "patternId");
    const record = repository.getPatternListingResult(parameter(request, "jobId"));
    if (!record || record.patternId !== patternId) missing("listing result", parameter(request, "jobId"));
    return record;
  });
  app.get("/api/v1/pod/print-specs", async () => ({ specVersion: POD_PRINT_SPEC_VERSION, items: POD_PRINT_SPECS }));

  // ---- 成包流水线（三问一跑）：花型 × 规格 × 平台一次串起「验缝 → 规格包 → 文案」。 ----
  // 编排不是用户要学的东西：步骤顺序内建，用户只回答问题；每一步仍可单独重跑（见 steps/:step/retry）。
  app.post("/api/v1/patterns/:patternId/pipelines", async (request, reply) => {
    const pattern = ensurePattern(repository, parameter(request, "patternId"));
    if (!pattern.storagePath) throw new ApiError(409, "CONFLICT", "该花型还没有可用的图稿产物，无法成包");
    const body = parseBody(CreatePatternPipelineInput, request.body);
    const { pipeline, reused } = await startPatternPipeline({
      patternId: pattern.id,
      patternHash: pattern.fileHash,
      answers: body,
      idempotencyKey: body.idempotencyKey ?? (request.headers["idempotency-key"] as string | undefined) ?? null,
    });
    return reply.code(reused ? 200 : 202).send(publicPatternPipeline(pipeline));
  });
  app.get("/api/v1/patterns/:patternId/pipelines", async (request) => {
    const pattern = ensurePattern(repository, parameter(request, "patternId"));
    return { items: repository.listPatternPipelines(pattern.id).map(publicPatternPipeline) };
  });
  app.get("/api/v1/pattern-pipelines/:pipelineId", async (request) => {
    const pipeline = ensurePatternPipeline(repository, parameter(request, "pipelineId"));
    return publicPatternPipeline(pipeline);
  });
  // AWAITING_INPUT 的裁决：改用居中版式继续、换镜像排列出满印（构造性无缝），或明知有接缝仍出满印。均由用户明确选择。
  app.post("/api/v1/pattern-pipelines/:pipelineId/continue", async (request, reply) => {
    const pipeline = ensurePatternPipeline(repository, parameter(request, "pipelineId"));
    if (pipeline.status !== "AWAITING_INPUT" || pipeline.blockReason !== "SEAM_RISK") throw new ApiError(409, "CONFLICT", "该流水线当前不需要裁决");
    const patternId = pipeline.patternId;
    if (!patternId) throw new ApiError(409, "CONFLICT", "该流水线还没有花型，无法继续");
    const body = parseBody(ContinuePatternPipelineInput, request.body);
    const tileCheck = pipeline.steps.find((entry) => entry.step === "TILE_CHECK");
    if (!tileCheck) throw new ApiError(409, "CONFLICT", "该流水线没有验缝步骤，无法裁决");
    // 先改版式/排列再建任务：PRINT_PACK 任务从流水线读 layout 与 repeatLayout，顺序反了就会按旧答案出图。
    repository.updatePatternPipeline(pipeline.id, {
      layout: body.resolution === "USE_CENTERED" ? "CENTERED" : "TILE",
      // USE_MIRROR 把排列改写为镜像（构造性无缝，闸门放行的依据）；其余出口保留用户创建时选的排列。
      repeatLayout: body.resolution === "USE_MIRROR" ? "MIRROR" : pipeline.repeatLayout,
      status: "RUNNING",
      blockReason: null,
    });
    const updated = repository.getPatternPipeline(pipeline.id) ?? pipeline;
    const next = nextPipelineStep(updated.steps, tileCheck);
    if (!next) throw new ApiError(409, "CONFLICT", "验缝之后没有可执行的步骤");
    const started = startPipelineStep(repository, updated, next, patternId);
    await enqueueOrMarkFailed(started.job, queueKindForJobType(started.jobType), { onFail: (jobId) => settlePipelineStep(repository, jobId, "FAILED", { code: "QUEUE_UNAVAILABLE", message: "任务已创建但队列暂不可用" }) });
    return reply.code(202).send(publicPatternPipeline(repository.getPatternPipeline(pipeline.id) ?? pipeline));
  });
  // 单步重跑：重置该步及其下游（下游结果基于旧输入，必须一并重算），再重新起跑该步。
  app.post("/api/v1/pattern-pipelines/:pipelineId/steps/:step/retry", async (request, reply) => {
    const pipeline = ensurePatternPipeline(repository, parameter(request, "pipelineId"));
    const patternId = pipeline.patternId;
    if (!patternId) throw new ApiError(409, "CONFLICT", "该流水线还没有花型，无法重跑");
    const stepName = enumValue(parameter(request, "step"), [...PATTERN_PIPELINE_STEPS], "step");
    const step = pipeline.steps.find((entry) => entry.step === stepName);
    if (!step) throw new ApiError(404, "NOT_FOUND", `该流水线没有步骤：${stepName}`);
    // 在途步骤不能重跑：会与正在执行的 Worker 争抢同一份领域记录，并叠加付费调用。
    if (step.status === "QUEUED" || step.status === "RUNNING") throw new ApiError(409, "CONFLICT", "该步骤正在运行，请先取消再重跑");
    if (step.step === "SOURCE") throw new ApiError(409, "CONFLICT", "图案获取步骤请从花型墙的来源入口重新发起");
    // AWAITING_INPUT 只由 /continue 放行：允许在这里"重跑"下一个待办步骤，等于给了一条绕过接缝裁决
    // 直接出满印的暗门，而用户以为自己只是在重跑。
    if (pipeline.status === "AWAITING_INPUT") throw new ApiError(409, "CONFLICT", "流水线正等待你的裁决，请先选择「改为居中继续」「换镜像出满印」或「仍出满印」");
    resetPipelineStepsFrom(repository, pipeline.id, step.id);
    const updated = repository.getPatternPipeline(pipeline.id) ?? pipeline;
    const target = updated.steps.find((entry) => entry.id === step.id) ?? step;
    const started = startPipelineStep(repository, updated, target, patternId);
    await enqueueOrMarkFailed(started.job, queueKindForJobType(started.jobType), { onFail: (jobId) => settlePipelineStep(repository, jobId, "FAILED", { code: "QUEUE_UNAVAILABLE", message: "任务已创建但队列暂不可用" }) });
    return reply.code(202).send(publicPatternPipeline(repository.getPatternPipeline(pipeline.id) ?? pipeline));
  });
  app.post("/api/v1/pattern-pipelines/:pipelineId/cancel", async (request) => {
    const pipeline = ensurePatternPipeline(repository, parameter(request, "pipelineId"));
    if (pipeline.status === "SUCCEEDED" || pipeline.status === "CANCELLED") return publicPatternPipeline(pipeline);
    // 先取消在途任务（真正的计费请求在这里被断开），再落流水线状态；顺序反了会出现"已取消但请求仍在途"。
    const active = [...pipeline.steps].reverse().find((entry) => entry.jobId);
    if (active?.jobId) await requestJobCancellation(active.jobId);
    for (const step of pipeline.steps) {
      if (step.status === "PENDING" || step.status === "QUEUED" || step.status === "RUNNING") repository.updatePatternPipelineStep(step.id, { status: "CANCELLED" });
    }
    repository.updatePatternPipeline(pipeline.id, { status: "CANCELLED", blockReason: null });
    return publicPatternPipeline(repository.getPatternPipeline(pipeline.id) ?? pipeline);
  });

  app.get("/api/v1/files/patterns/:patternId", async (request, reply) => {
    const pattern = repository.getPattern(parameter(request, "patternId"));
    if (!pattern) missing("pattern", parameter(request, "patternId"));
    return sendStored(request, reply, storage, { storagePath: pattern.storagePath, hash: pattern.fileHash ?? undefined, mimeType: "image/png" }, "pattern", parameter(request, "patternId"));
  });
  app.get("/api/v1/files/print-packs/:printPackId/files/:index", async (request, reply) => {
    const pack = repository.getPrintPack(parameter(request, "printPackId"));
    if (!pack) missing("print pack", parameter(request, "printPackId"));
    const index = Number(parameter(request, "index"));
    const file = Number.isInteger(index) && index >= 0 ? pack.files?.[index] : undefined;
    if (!file) missing("print pack file", `${parameter(request, "printPackId")}/${index}`);
    return sendStored(request, reply, storage, { storagePath: file.storagePath, hash: file.hash }, "print pack file", file.name);
  });

  app.get("/api/v1/providers", async () => ({ items: repository.listProviders().map(publicProvider), nextCursor: null }));
  app.post("/api/v1/providers", async (request, reply) => {
    const body = parseBody(CreateProviderInput, request.body);
    const models = normalizeModels(body.models);
    const apiKey = readText(body.apiKey, "apiKey");
    const reasoningProtocol = enumValue<ReasoningProtocolProfile>(body.reasoningProtocol ?? "openai", ["openai", "dashscope_qwen", "openai_responses"], "reasoningProtocol");
    const record = repository.saveProvider({ name: readText(body.name, "name"), baseUrl: readText(body.baseUrl, "baseUrl"), reasoningProtocol, encryptedApiKey: secrets.encrypt(apiKey), models });
    await events.publish("system", "provider.updated", publicProvider(record)); return reply.code(201).send(publicProvider(record));
  });
  app.patch("/api/v1/providers/:providerId", async (request) => {
    const id = parameter(request, "providerId"); const current = repository.getProvider(id); if (!current) missing("provider", id);
    const body = parseBody(UpdateProviderInput, request.body);
    const reasoningProtocol = body.reasoningProtocol === undefined ? current.reasoningProtocol : enumValue<ReasoningProtocolProfile>(body.reasoningProtocol, ["openai", "dashscope_qwen", "openai_responses"], "reasoningProtocol");
    const record = repository.saveProvider({ id, name: readOptionalText(body.name) ?? current.name, baseUrl: readOptionalText(body.baseUrl) ?? current.baseUrl, reasoningProtocol, encryptedApiKey: body.apiKey ? secrets.encrypt(readText(body.apiKey, "apiKey")) : current.encryptedApiKey, models: body.models ? normalizeModels(body.models) : current.models });
    await events.publish("system", "provider.updated", publicProvider(record)); return publicProvider(record);
  });
  app.post("/api/v1/providers/:providerId/test", async (request) => {
    const providerId = parameter(request, "providerId"); const provider = repository.getProvider(providerId); if (!provider) missing("provider", providerId);
    const body = parseBody(TestProviderInput, request.body); const modelId = readText(body.modelId, "modelId"); const kind = enumValue<"reasoning" | "image" | "segmentation">(body.kind ?? "image", ["reasoning", "image", "segmentation"], "kind");
    const model = provider.models.find((candidate) => candidate.id === modelId); if (!model) throw new ApiError(400, "VALIDATION_ERROR", "modelId is not declared by the selected provider");
    if (kind === "image" && !model.imageApiKind) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected image model has no image API configured");
    if (kind === "segmentation" && !model.segmentationProtocol) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected segmentation model has no segmentation API configured");
    try {
      if (kind === "reasoning") {
        const probeModel = model;
        const probe = await probeReasoning({ providerId, modelId, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: probeModel.supportsVision, supportsThinking: probeModel.supportsThinking, supportsStructuredOutput: probeModel.supportsStructuredOutput, apiKey: secrets.decrypt(provider.encryptedApiKey) });
        return { ok: true, providerId, modelId, kind, latencyMs: probe.latencyMs, models: null, modelAvailable: true };
      }
      if (kind === "segmentation") {
        // 分割探测只做零费用连通性检查（/models 或最小请求），不调用真实分割
        const apiKey = secrets.decrypt(provider.encryptedApiKey);
        // seedream 走整图图层合成协议（无逐元素接口），其余文本提示协议统一由工厂选择适配器
        const probe = model.segmentationProtocol === "seedream_layerize"
          ? await new SeedreamLayerizeProvider({ baseUrl: provider.baseUrl, apiKey }).probe()
          : await createSegmentationProvider(model.segmentationProtocol as PromptSegmentationProtocol, { baseUrl: provider.baseUrl, apiKey }).probe();
        return { ok: true, providerId, modelId, kind, ...probe, modelAvailable: null };
      }
      const probe = model.imageApiKind === "gemini"
        ? await new GeminiImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) }).probe()
        : await new OpenAiCompatibleImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) }).probe();
      return { ok: true, providerId, modelId, kind, ...probe, modelAvailable: probe.models === null ? null : probe.models.includes(modelId) };
    }
    catch (error) { if (error instanceof ProviderError) throw new ApiError(502, "PROVIDER_ERROR", error.message); throw error; }
  });
  app.delete("/api/v1/providers/:providerId", async (request, reply) => { const id = parameter(request, "providerId"); const result = repository.deleteProvider(id); if (result === "missing") missing("provider", id); return reply.code(204).send(); });

  app.get("/api/v1/search-sources", async () => ({ items: repository.listSearchSources().map(publicSearchSource), nextCursor: null }));
  app.post("/api/v1/search-sources", async (request, reply) => {
    const body = parseBody(CreateSearchSourceInput, request.body);
    const kind = enumValue<SearchSourceKind>(body.kind, ["brave", "tavily", "searxng"], "kind");
    const apiKey = readOptionalText(body.apiKey);
    if (kind !== "searxng" && !apiKey) throw new ApiError(400, "VALIDATION_ERROR", "apiKey is required for this search source");
    const record = repository.saveSearchSource({ name: readText(body.name, "name"), kind, baseUrl: searchSourceBaseUrl(kind, readOptionalText(body.baseUrl)), encryptedApiKey: apiKey ? secrets.encrypt(apiKey) : null, priority: readPriority(body.priority), enabled: body.enabled === undefined ? true : readBoolean(body.enabled, "enabled") });
    return reply.code(201).send(publicSearchSource(record));
  });
  app.patch("/api/v1/search-sources/:sourceId", async (request) => {
    const id = parameter(request, "sourceId"); const current = repository.getSearchSource(id); if (!current) missing("search source", id);
    const body = parseBody(UpdateSearchSourceInput, request.body);
    const kind = body.kind === undefined ? current.kind : enumValue<SearchSourceKind>(body.kind, ["brave", "tavily", "searxng"], "kind");
    const apiKey = readOptionalText(body.apiKey);
    const encryptedApiKey = apiKey ? secrets.encrypt(apiKey) : current.encryptedApiKey;
    if (kind !== "searxng" && !encryptedApiKey) throw new ApiError(400, "VALIDATION_ERROR", "apiKey is required for this search source");
    return publicSearchSource(repository.saveSearchSource({ id, name: readOptionalText(body.name) ?? current.name, kind, baseUrl: searchSourceBaseUrl(kind, readOptionalText(body.baseUrl) ?? current.baseUrl), encryptedApiKey, priority: body.priority === undefined ? current.priority : readPriority(body.priority), enabled: body.enabled === undefined ? current.enabled : readBoolean(body.enabled, "enabled") }));
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
  app.get("/api/v1/projects/:projectId/storyboard", async (request) => {
    const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); return { storyboard: repository.getStoryboard(projectId) ?? null, items: repository.listStoryboardItems(projectId) };
  });
  app.patch("/api/v1/storyboard-items/:itemId", async (request) => {
    const itemId = parameter(request, "itemId"); const current = repository.getStoryboardItem(itemId); if (!current) missing("storyboard item", itemId); const body = parseBody(UpdateStoryboardItemInput, request.body);
    if (current.status === "GENERATING") {
      throw new ApiError(409, "CONFLICT", "Generating storyboard items cannot be updated");
    }
    if (current.status === "GENERATED" && (body.assetType !== undefined || body.displayName !== undefined || body.templateVariant !== undefined || body.referencedAssets !== undefined || body.mode !== undefined || body.promptInstruction !== undefined)) {
      throw new ApiError(409, "CONFLICT", "Generated storyboard items only allow generation-setting updates");
    }
    const patch: Record<string, unknown> = {};
    if (body.assetType !== undefined) {
      const templateId = readText(body.assetType, "assetType");
      if (templateId !== current.assetType) throw new ApiError(409, "CONFLICT", "Storyboard item image type is immutable");
      // assetType 不可变：这里只放行"仍可解析"的既有值（内置模板或未删除的自定义模板）
      if (!getTemplate(templateId) && !(isUserTemplateId(templateId) && repository.getUserTemplate(templateId))) throw new ApiError(400, "VALIDATION_ERROR", "assetType must be an ecom-details-image template ID");
    }
    if (body.displayName !== undefined) patch.displayName = readText(body.displayName, "displayName");
    if (body.templateVariant !== undefined) { const template = getTemplate(String(patch.assetType ?? current.assetType)); const variant = readOptionalText(body.templateVariant) ?? null; if (variant && !template?.variants[variant]) throw new ApiError(400, "VALIDATION_ERROR", "templateVariant is not declared by the selected ecom-details-image template"); patch.templateVariant = variant; }
    if (body.candidateCount !== undefined) patch.candidateCount = candidatesPerType(body.candidateCount);
    if (body.imageModel !== undefined) {
      const model = readObject(body.imageModel, "imageModel");
      const providerId = readText(model.providerId, "imageModel.providerId");
      const modelId = readText(model.modelId, "imageModel.modelId");
      verifyModel(repository, providerId, modelId, "image");
      patch.imageProviderId = providerId;
      patch.imageModelId = modelId;
    }
    if (body.imageResolution !== undefined) patch.imageResolution = enumValue<ImageResolution>(body.imageResolution, IMAGE_RESOLUTIONS, "imageResolution");
    if (body.imageAspectRatio !== undefined) patch.imageAspectRatio = enumValue<ImageAspectRatio>(body.imageAspectRatio, IMAGE_ASPECT_RATIOS, "imageAspectRatio");
    if (body.referencedAssets !== undefined) {
      const ids = readTextArray(body.referencedAssets, "referencedAssets");
      const known = new Set(repository.listAssets(current.projectId).map((asset) => asset.id));
      if (ids.some((id) => !known.has(id))) throw new ApiError(400, "VALIDATION_ERROR", "referencedAssets must belong to this project");
      patch.referencedAssets = ids;
    }
    if (body.mode !== undefined) patch.mode = enumValue<StoryboardMode>(body.mode, ["CREATIVE", "PIXEL_PROTECTED"], "mode");
    if (body.promptInstruction !== undefined) patch.promptInstruction = readText(body.promptInstruction, "promptInstruction");
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
  app.post("/api/v1/projects/:projectId/storyboard/confirm", async (request) => {
    const projectId = parameter(request, "projectId");
    const storyboard = repository.getStoryboard(projectId); if (!storyboard) throw new ApiError(409, "CONFLICT", "A draft storyboard must exist before confirmation");
    // 确认携带发起编辑时看到的版本：与当前版本不一致即并发冲突，拒绝并带回当前版本，防止旧页面覆盖新页面
    const body = parseBody(ConfirmStoryboardInput, request.body ?? {});
    if (body.version !== storyboard.version) {
      throw new ApiError(409, "CONFLICT", `分镜已被其他修改更新（当前版本 ${storyboard.version}），请刷新后重试`, [{ path: "/version", reason: `expected ${storyboard.version}` }]);
    }
    return repository.confirmStoryboard(projectId) as object;
  });
  app.post("/api/v1/projects/:projectId/generation-jobs", async (request, reply) => {
    const projectId = parameter(request, "projectId"); const storyboard = repository.getStoryboard(projectId); if (!storyboard || storyboard.status !== "CONFIRMED") throw new ApiError(409, "CONFLICT", "Confirm the storyboard before generation");
    const body = parseBody(CreateGenerationJobInput, request.body); const itemIds = readTextArray(body.storyboardItemIds, "storyboardItemIds"); if (itemIds.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "At least one storyboardItemId is required");
    const config = body.generationConfig ?? null;
    const revision = readOptionalText(body.revision);
    const requestedBatchId = readOptionalText(body.generationBatchId);
    const generationBatchId = requestedBatchId ?? (revision === "retry"
      ? repository.listOutputs(projectId).find((output) => itemIds.includes(output.storyboardItemId) && !output.editSessionId)?.generationBatchId ?? randomUUID()
      : randomUUID());
    const overrideResolution = config?.imageResolution === undefined ? undefined : enumValue<ImageResolution>(config.imageResolution, IMAGE_RESOLUTIONS, "generationConfig.imageResolution");
    const overrideAspect = config?.imageAspectRatio === undefined ? undefined : enumValue<ImageAspectRatio>(config.imageAspectRatio, IMAGE_ASPECT_RATIOS, "generationConfig.imageAspectRatio");
    const overrideCandidates = config?.candidateCount === undefined ? undefined : candidatesPerType(config.candidateCount);
    const overrideModel = config?.imageModel;
    const overrideProviderId = overrideModel ? readText(overrideModel.providerId, "generationConfig.imageModel.providerId") : undefined;
    const overrideModelId = overrideModel ? readText(overrideModel.modelId, "generationConfig.imageModel.modelId") : undefined;
    if (overrideProviderId && overrideModelId) verifyModel(repository, overrideProviderId, overrideModelId, "image");
    const project = repository.getProject(projectId); if (!project) missing("project", projectId);
    // 先完整校验全部 item，再在单个事务里创建任务：部分写入后返回 400 会留下不可执行的孤儿任务
    const plans = itemIds.map((itemId) => {
      const item = repository.getStoryboardItem(itemId); if (!item || item.projectId !== projectId) throw new ApiError(400, "VALIDATION_ERROR", "Storyboard item does not belong to this project");
      if (!overrideProviderId || !overrideModelId) verifyModel(repository, item.imageProviderId, item.imageModelId, "image");
      return { item, candidateCount: overrideCandidates ?? clampCandidates(item.candidateCount) };
    });
    const jobs: JobRecord[] = [];
    const created: JobRecord[] = [];
    const writeJobs = database.transaction(() => {
      for (const { item, candidateCount } of plans) {
        // 有效 Provider/模型参与指纹：切换 Provider 或模型必须产生新任务，不能复用旧结果
        const effectiveProviderId = overrideProviderId ?? item.imageProviderId;
        const effectiveModelId = overrideModelId ?? item.imageModelId;
        for (let index = 0; index < candidateCount; index++) {
          const input = {
            revision,
            generationBatchId,
            candidateIndex: index + 1,
            imageResolution: overrideResolution ?? item.imageResolution,
            imageAspectRatio: overrideAspect ?? item.imageAspectRatio
          };
          const { generationBatchId: _generationBatchId, ...fingerprintInput } = input;
          const fingerprint = requestFingerprint({ type: "GENERATE", projectId, itemId: item.id, storyboardVersion: storyboard.version, itemUpdatedAt: item.updatedAt, providerId: effectiveProviderId, modelId: effectiveModelId, input: fingerprintInput, idempotencyKey: request.headers["idempotency-key"] ?? null });
          const existing = repository.findJobByFingerprint(projectId, fingerprint);
          if (existing) { jobs.push(existing); continue; }
          const job = repository.createJob({ id: randomUUID(), projectId, storyboardItemId: item.id, type: "GENERATE", input, requestFingerprint: fingerprint, providerId: effectiveProviderId, modelId: effectiveModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
          jobs.push(job); created.push(job);
        }
      }
    });
    writeJobs();
    // 入队失败只回滚本次新建的任务：按指纹复用的既有任务不属于本请求的失败面
    await enqueueOrMarkFailed(jobs, "generate", { markable: created });
    return reply.code(202).send({ jobs });
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
    const body = parseBody(UpdateEditSessionMemoryInput, request.body);
    const outputId = body.outputId === undefined ? session.currentOutputId : readText(body.outputId, "outputId");
    const output = repository.getOutput(outputId);
    if (!output || output.projectId !== session.projectId || !repository.isOutputInEditSession(session.id, outputId)) throw new ApiError(400, "VALIDATION_ERROR", "outputId must belong to the edit session");
    const summary = readOptionalText(body.summary) ?? "";
    const constraints = body.constraints === undefined ? (session.memorySummary.scopes?.[outputId]?.constraints ?? session.memorySummary.constraints ?? []) : readTextArray(body.constraints, "constraints");
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
    const annotations = readJsonObject(fields.get("annotations"), "annotations");
    const legacyReferenceAssetIds = readJsonTextArray(fields.get("referenceAssetIds"), "referenceAssetIds");
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
    await enqueueOrMarkFailed(job, "edit_plan"); return reply.code(202).send({ turnId: turn.id, planJobId: job.id, status: turn.status });
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
    await enqueueOrMarkFailed(job, "edit_generate"); return reply.code(202).send({ job, turn: repository.getEditTurn(turn.id) });
  });
  app.post("/api/v1/edit-sessions/:sessionId/select-output", async (request) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    const body = parseBody(SelectEditSessionOutputInput, request.body); const outputId = readText(body.outputId, "outputId"); const output = repository.getOutput(outputId); if (!output || output.projectId !== session.projectId) throw new ApiError(400, "VALIDATION_ERROR", "outputId must belong to this project");
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
  app.post("/api/v1/jobs/:jobId/cancel", async (request) => requestJobCancellation(parameter(request, "jobId")));
  app.post("/api/v1/jobs/:jobId/retry", async (request, reply) => {
    const id = parameter(request, "jobId"); const job = repository.getJob(id); if (!job) missing("job", id);
    // 只有失败任务可重试：重试 QUEUED/RUNNING 会叠加 Provider 调用产生重复计费，
    // SUCCEEDED 无需重试，CANCELLED 是用户主动终结的终态；retryable=false 保留 Worker 对
    // 外部请求不确定状态的非重试判断，API 不绕过该不变量。
    if (job.status !== "FAILED" || !job.retryable) {
      throw new ApiError(409, "CONFLICT", `只有失败的任务可以重试，当前状态：${job.status}`);
    }
    const input = job.type === "GENERATE" ? { ...job.input, revision: "retry" } : job.input;
    // 分层任务重试必须同时重建分层记录，否则 Worker 按新 jobId 找不到对应记录会立即失败。
    let createLayerRecord: ((retryJobId: string) => void) | undefined;
    if (job.type === "LAYER_PLAN" || job.type === "LAYER_EXPORT") {
      const outputId = typeof job.input.outputId === "string" ? job.input.outputId : "";
      const output = outputId ? repository.getOutput(outputId) : undefined;
      if (!output || output.projectId !== job.projectId) throw new ApiError(409, "CONFLICT", "无法重试：源输出已不存在");
      if (job.type === "LAYER_PLAN") {
        createLayerRecord = (retryJobId) => { repository.createLayerPlan({ projectId: output.projectId, outputId: output.id, jobId: retryJobId, outputHash: output.hash, status: "QUEUED", elements: [], error: null }); };
      } else {
        const planId = typeof job.input.planId === "string" ? job.input.planId : null;
        const includeBackground = job.input.includeBackground !== false;
        createLayerRecord = (retryJobId) => { repository.createLayerExport({ projectId: output.projectId, outputId: output.id, jobId: retryJobId, planId, status: "QUEUED", includeBackground, psdStoragePath: null, layerFiles: null, error: null }); };
      }
    }
    // 规格包重试同理：记录按新 jobId 重建，否则 Worker 找不到对应记录会立即失败。
    if (job.type === "PRINT_PACK") {
      const patternId = typeof job.input.patternId === "string" ? job.input.patternId : "";
      const specId = typeof job.input.specId === "string" ? job.input.specId : "";
      const specVersion = typeof job.input.specVersion === "string" ? job.input.specVersion : "";
      if (!patternId || !specId || !specVersion) throw new ApiError(409, "CONFLICT", "无法重试：规格包任务缺少快照");
      createLayerRecord = (retryJobId) => { repository.createPrintPack({ patternId, jobId: retryJobId, specId, specVersion, status: "QUEUED" }); };
    }
    // 重试即替代原任务：先终结原失败任务再入队新任务，前端结果区不再残留旧卡片；retryable 在此关闭使并发双击得到 409。
    repository.updateJob(id, { status: "CANCELLED", cancelRequested: true, retryable: false });
    const retry = repository.createJob({ id: randomUUID(), projectId: job.projectId, storyboardItemId: job.storyboardItemId, type: job.type, input, providerId: job.providerId, modelId: job.modelId, estimatedCost: job.estimatedCost }); createLayerRecord?.(retry.id); await enqueueOrMarkFailed(retry, queueKindForJobType(retry.type), { onFail: (jobId) => markDomainRecordFailed(repository, retry.type, jobId) }); return reply.code(202).send(retry);
  });
  app.get("/api/v1/projects/:projectId/outputs", async (request) => repository.listOutputs(parameter(request, "projectId")));
  app.post("/api/v1/projects/:projectId/export-jobs", async (request, reply) => { const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); const body = parseBody(CreateExportJobRequest, request.body ?? {}); const input = { outputIds: body.outputIds, filenamePrefix: body.filenamePrefix }; const fingerprint = requestFingerprint({ type: "EXPORT", projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null }); const existing = repository.findJobByFingerprint(projectId, fingerprint); if (existing) { const exportRecord = repository.getExportByJobId(existing.id); return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send({ job: existing, export: exportRecord ?? null }); } const job = repository.createJob({ id: randomUUID(), projectId, storyboardItemId: null, type: "EXPORT", input, requestFingerprint: fingerprint, estimatedCost: { status: "UNKNOWN", unit: "local-storage" } }); const exportRecord = repository.createExport({ projectId, jobId: job.id, status: "QUEUED", storagePath: null }); await enqueueOrMarkFailed(job, "export", { onFail: (failedJobId) => { const pendingExport = repository.getExportByJobId(failedJobId); if (pendingExport) repository.updateExport(pendingExport.id, { status: "FAILED" }); } }); return reply.code(202).send({ job, export: exportRecord }); });
  app.get("/api/v1/exports/:exportId", async (request) => { const result = repository.getExport(parameter(request, "exportId")); if (!result) missing("export", parameter(request, "exportId")); return result; });
  app.get("/api/v1/files/assets/:assetId", async (request, reply) => sendStored(request, reply, storage, repository.getAsset(parameter(request, "assetId")), "asset", parameter(request, "assetId")));
  app.get("/api/v1/files/edit-reference-assets/:referenceAssetId", async (request, reply) => sendStored(request, reply, storage, repository.getEditReferenceAsset(parameter(request, "referenceAssetId")), "reference asset", parameter(request, "referenceAssetId")));
  app.get("/api/v1/files/outputs/:outputId", async (request, reply) => sendStored(request, reply, storage, repository.getOutput(parameter(request, "outputId")), "output", parameter(request, "outputId")));
  // 缩略图按内容 hash 寻址，跨项目共享；命中缓存直接流式返回，未命中（含历史图片）现场生成后落盘。
  app.get("/api/v1/files/thumbnails/:hash", async (request, reply) => {
    const hash = parameter(request, "hash");
    const thumbnailPath = storage.thumbnailPath(hash);
    if (!(await storage.exists(thumbnailPath))) {
      const sourcePath = repository.findLibrarySourcePath(hash);
      if (!sourcePath) missing("library image", hash);
      await storage.putThumbnail(hash, await renderThumbnail(await storage.read(sourcePath)));
    }
    return sendStored(request, reply, storage, { storagePath: thumbnailPath, mimeType: "image/webp", hash }, "thumbnail", hash);
  });
  app.get("/api/v1/files/exports/:exportId", async (request, reply) => sendStored(request, reply, storage, repository.getExport(parameter(request, "exportId")), "export", parameter(request, "exportId")));
  app.get("/api/v1/outputs/:outputId/layer-plan", async (request) => {
    const output = repository.getOutput(parameter(request, "outputId"));
    if (!output) missing("output", parameter(request, "outputId"));
    const plan = repository.getLayerPlanByOutput(output.id);
    if (!plan) missing("layer plan", output.id);
    return publicLayerPlan(plan);
  });
  app.post("/api/v1/outputs/:outputId/layer-plan", async (request, reply) => {
    const output = repository.getOutput(parameter(request, "outputId"));
    if (!output) missing("output", parameter(request, "outputId"));
    const project = repository.getProject(output.projectId);
    if (!project) missing("project", output.projectId);
    const body = parseBody(CreateLayerPlanInput, request.body ?? {});
    // 输出内容未变化、上次识别成功、且推理模型快照一致时才复用；显式 regenerationKey 表示调用方要求重新识别。
    const existing = repository.getLayerPlanByOutput(output.id);
    const existingJob = existing ? repository.getJob(existing.jobId) : undefined;
    const sameReasoningModel = existingJob?.providerId === project.reasoningProviderId && existingJob?.modelId === project.reasoningModelId;
    if (existing && existing.status === "SUCCEEDED" && existing.outputHash === output.hash && sameReasoningModel && !body.regenerationKey) return reply.code(200).send(publicLayerPlan(existing));
    const input = { outputId: output.id, outputHash: output.hash, regenerationKey: body.regenerationKey ?? null, reasoningProviderId: project.reasoningProviderId ?? null, reasoningModelId: project.reasoningModelId ?? null };
    const fingerprint = requestFingerprint({ type: "LAYER_PLAN", projectId: output.projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null });
    const duplicate = repository.findJobByFingerprint(output.projectId, fingerprint);
    if (duplicate) { const duplicatePlan = repository.getLayerPlanByJobId(duplicate.id); if (duplicatePlan) return reply.code(duplicate.status === "SUCCEEDED" ? 200 : 202).send(publicLayerPlan(duplicatePlan)); }
    const job = repository.createJob({ id: randomUUID(), projectId: output.projectId, storyboardItemId: null, type: "LAYER_PLAN", input, requestFingerprint: fingerprint, providerId: project.reasoningProviderId, modelId: project.reasoningModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    const plan = repository.createLayerPlan({ projectId: output.projectId, outputId: output.id, jobId: job.id, outputHash: output.hash, status: "QUEUED", elements: [], error: null });
    await enqueueOrMarkFailed(job, "layer_plan", { onFail: (failedJobId) => markDomainRecordFailed(repository, "LAYER_PLAN", failedJobId) });
    return reply.code(202).send(publicLayerPlan(plan));
  });
  app.get("/api/v1/outputs/:outputId/layer-exports", async (request) => {
    const output = repository.getOutput(parameter(request, "outputId"));
    if (!output) missing("output", parameter(request, "outputId"));
    const layerExport = repository.getLayerExportByOutput(output.id);
    if (!layerExport) missing("layer export", output.id);
    return publicLayerExport(layerExport);
  });
  // 历史导出全集：文件端点按记录 id 寻址，旧导出在重新分层/重新导出后仍可回看与下载
  app.get("/api/v1/outputs/:outputId/layer-exports/history", async (request) => {
    const output = repository.getOutput(parameter(request, "outputId"));
    if (!output) missing("output", parameter(request, "outputId"));
    return { exports: repository.listLayerExportsByOutput(output.id).map(publicLayerExport) };
  });
  app.post("/api/v1/outputs/:outputId/layer-exports", async (request, reply) => {
    const output = repository.getOutput(parameter(request, "outputId"));
    if (!output) missing("output", parameter(request, "outputId"));
    const project = repository.getProject(output.projectId);
    if (!project) missing("project", output.projectId);
    if (!project.segmentationModel) throw new ApiError(422, "PROVIDER_NOT_CONFIGURED", "请先在项目设置中选择分割模型");
    const body = parseBody(CreateLayerExportInput, request.body ?? {});
    const includeBackground = body.includeBackground ?? true;
    const plan = repository.getLayerPlanByOutput(output.id);
    // 画框/提示词元素可以跳过视觉识别直接分层；auto 元素必须来自当前识别结果，避免引用过期元素。
    const succeededPlan = plan?.status === "SUCCEEDED" ? plan : null;
    const planId = succeededPlan?.id ?? null;
    // auto 元素必须绑定勾选时的识别方案：方案被重新识别后 el-N 会指向新对象，仅靠局部 id 无法区分。
    if (body.elements.some((element) => element.source === "auto") && body.planId !== planId) throw new ApiError(409, "CONFLICT", "识别方案已更新，请重新选择图层元素后再导出");
    const planElementIds = new Set(succeededPlan?.elements.map((element) => element.id) ?? []);
    for (const element of body.elements) {
      if (element.source === "manual" && !element.bbox) throw new ApiError(400, "VALIDATION_ERROR", `手动元素「${element.name}」缺少画框坐标`);
      if (element.source === "auto" && !planElementIds.has(element.id)) throw new ApiError(409, "CONFLICT", `元素「${element.name}」不在识别结果中，请先完成图层识别再导出`);
    }
    // 单次导出元素数受分割协议上限约束（Seedream 最多 16 层、SAM 单次最多 32 个对象），提前校验避免任务必然失败。
    // 存储引用里的 protocol 可能是历史默认值，以模型当前声明为准，因此只传 providerId/modelId。
    const segmentation = readSegmentationModel(repository, { providerId: project.segmentationModel.providerId, modelId: project.segmentationModel.modelId });
    const maxLayerElements = SEGMENTATION_PROTOCOL_CAPABILITIES[segmentation.protocol].maxElements;
    if (body.elements.length > maxLayerElements) throw new ApiError(400, "VALIDATION_ERROR", `当前分割模型单次最多支持 ${maxLayerElements} 个图层元素，请减少元素后重试`);
    // auto 元素的英文分割提示由服务端从识别方案补齐：客户端只传 id/name/source/bbox，
    // promptEn 属于识别产物而非用户输入，避免客户端伪造或携带过期方案的数据。
    const promptEnById = new Map(succeededPlan?.elements.filter((element) => element.promptEn).map((element) => [element.id, element.promptEn]) ?? []);
    const elements = body.elements.map((element) => (element.source === "auto" && promptEnById.has(element.id) ? { ...element, promptEn: promptEnById.get(element.id) } : element));
    const input = { outputId: output.id, planId, outputHash: output.hash, elements, includeBackground, segmentationProviderId: segmentation.providerId, segmentationModelId: segmentation.modelId, segmentationProtocol: segmentation.protocol };
    const fingerprint = requestFingerprint({ type: "LAYER_EXPORT", projectId: output.projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null });
    const duplicate = repository.findJobByFingerprint(output.projectId, fingerprint);
    if (duplicate) { const duplicateExport = repository.getLayerExportByJobId(duplicate.id); if (duplicateExport) return reply.code(duplicate.status === "SUCCEEDED" ? 200 : 202).send({ job: duplicate, layerExport: publicLayerExport(duplicateExport) }); }
    const job = repository.createJob({ id: randomUUID(), projectId: output.projectId, storyboardItemId: null, type: "LAYER_EXPORT", input, requestFingerprint: fingerprint, providerId: project.segmentationModel.providerId, modelId: project.segmentationModel.modelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    const layerExport = repository.createLayerExport({ projectId: output.projectId, outputId: output.id, jobId: job.id, planId, status: "QUEUED", includeBackground, psdStoragePath: null, layerFiles: null, error: null });
    await enqueueOrMarkFailed(job, "layer_export", { onFail: (failedJobId) => markDomainRecordFailed(repository, "LAYER_EXPORT", failedJobId) });
    return reply.code(202).send({ job, layerExport: publicLayerExport(layerExport) });
  });
  app.get("/api/v1/files/layer-exports/:layerExportId", async (request, reply) => {
    const record = repository.getLayerExport(parameter(request, "layerExportId"));
    return sendStored(request, reply, storage, record?.psdStoragePath ? { storagePath: record.psdStoragePath } : undefined, "layer export", parameter(request, "layerExportId"));
  });
  app.get("/api/v1/files/layer-exports/:layerExportId/layers/:layerIndex", async (request, reply) => {
    const layerExportId = parameter(request, "layerExportId");
    const index = Number(parameter(request, "layerIndex"));
    const file = repository.getLayerExport(layerExportId)?.layerFiles?.[index];
    if (!file || !Number.isInteger(index) || index < 0) missing("layer file", `${layerExportId}#${parameter(request, "layerIndex")}`);
    return sendStored(request, reply, storage, { storagePath: file.storagePath, hash: file.hash }, "layer file", `${layerExportId}#${parameter(request, "layerIndex")}`);
  });
  app.get("/api/v1/events", { sse: "only" }, async (request, reply) => {
    const projectId = typeof request.query === "object" && request.query && "projectId" in request.query ? String((request.query as Record<string, unknown>).projectId) : ""; if (!projectId) throw new ApiError(400, "VALIDATION_ERROR", "projectId query parameter is required"); ensureProject(repository, projectId);
    reply.sse.keepAlive(); const unsubscribe = await events.subscribe(projectId, (event) => { void reply.sse.send({ id: event.id, event: event.type, data: event }); }); reply.sse.onClose(() => { void unsubscribe(); }); await reply.sse.send({ event: "connected", data: { projectId } });
  });
  await registerWebStatic(app);
  return app;
}

function publicProvider(value: ProviderRecord): object { const { encryptedApiKey, ...provider } = value; return { ...provider, hasApiKey: Boolean(encryptedApiKey) }; }
function publicLayerPlan(plan: LayerPlanRecord): object { return { ...plan, error: plan.error ?? undefined }; }
function publicLayerExport(record: LayerExportRecord): object {
  return {
    ...record,
    psdStoragePath: record.psdStoragePath ?? undefined,
    psdDownloadUrl: record.psdStoragePath ? `/files/layer-exports/${record.id}` : null,
    layerFiles: record.layerFiles?.map((file, index) => ({ name: file.name, kind: file.kind, downloadUrl: `/files/layer-exports/${record.id}/layers/${index}` })) ?? null,
    error: record.error ?? undefined,
  };
}
function publicSearchSource(value: SearchSourceRecord): object { const { encryptedApiKey, ...source } = value; return { ...source, hasApiKey: Boolean(encryptedApiKey) }; }
function publicUserTemplate(value: UserTemplateRecord): object { return { ...value }; }
/** 规划校验与 Worker 共用同一编译口径；表极小，按请求读取即可保证最新。 */
function compiledUserTemplates(repository: EcomRepository): ReturnType<typeof compileUserTemplate>[] { return repository.listUserTemplates().map((record) => compileUserTemplate({ id: record.id, name: record.name, prompt: record.prompt, defaultSize: record.defaultSize, supportsImageReference: record.supportsImageReference })); }
const SUITE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 导入套图必须落在 custom-suite- 命名空间，避免覆盖内置或目录投放套图。 */
function suiteIdForImport(requested: string | undefined, catalog: SuiteCatalog): string {
  if (requested) {
    if (!requested.startsWith("custom-suite-") || !SUITE_ID_PATTERN.test(requested)) throw new ApiError(400, "VALIDATION_ERROR", "Imported suite id must start with custom-suite- and use lowercase letters, digits, dot, dash or underscore");
    if (catalog.getSuite(requested)) throw new ApiError(409, "CONFLICT", `Suite id already exists: ${requested}`);
    return requested;
  }
  let id = `custom-suite-${randomBytes(4).toString("hex")}`;
  while (catalog.getSuite(id)) id = `custom-suite-${randomBytes(4).toString("hex")}`;
  return id;
}
function assertValidSuiteDocument(value: unknown): void {
  const result = validateEcomSuiteFile(value);
  if (!result.ok) throw new ApiError(400, "VALIDATION_ERROR", "Invalid suite document", result.errors.map((reason) => ({ path: "/", reason })));
}
/** 「最近反推」列表规模：默认 20 条，上限 50 条，与 paths.yaml 的 limit 声明保持一致。 */
const SUITE_FORGE_LIST_DEFAULT = 20;
const SUITE_FORGE_LIST_MAX = 50;
/** ids 回读只服务“已选分镜所属套图”，上限按单次选择的量级留一倍余量。 */
const MAX_SUITE_IDS_QUERY = 24;
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
/** 手动规划可混选套图分镜与单图模板；分镜 assetType 必须是当前编目已知项，未知即报错而非静默丢弃。 */
function resolveRequestedSuiteShots(requested: unknown, catalog: SuiteCatalog): string[] {
  const assetTypes = readOptionalTextArray(requested) ?? [];
  if (assetTypes.length === 0) return [];
  if (assetTypes.length > MAX_REQUESTED_SUITE_SHOTS) throw new ApiError(400, "VALIDATION_ERROR", `requestedSuiteShots supports at most ${MAX_REQUESTED_SUITE_SHOTS} shots`);
  const resolved: string[] = [];
  for (const assetType of assetTypes) {
    if (!catalog.resolveShot(assetType)) throw new ApiError(400, "VALIDATION_ERROR", `requestedSuiteShots contains an unknown suite shot: ${assetType}`);
    if (!resolved.includes(assetType)) resolved.push(assetType);
  }
  return resolved;
}
/** 套图列表查询参数：ids 是“精确回读已选分镜所属套图”的旁路，存在时不再走分页。 */
function parseSuiteListQuery(query: unknown): SuiteListQuery {
  const source = (query ?? {}) as Record<string, unknown>;
  const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  const rawLimit = text(source.limit);
  const parsedLimit = rawLimit === undefined ? undefined : Number.parseInt(rawLimit, 10);
  if (rawLimit !== undefined && !Number.isFinite(parsedLimit)) throw new ApiError(400, "VALIDATION_ERROR", "limit must be an integer");
  const ids = text(source.ids)?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  if (ids.length > MAX_SUITE_IDS_QUERY) throw new ApiError(400, "VALIDATION_ERROR", `ids supports at most ${MAX_SUITE_IDS_QUERY} suite IDs`);
  return {
    q: text(source.q),
    l1: text(source.l1),
    l2: text(source.l2),
    origin: parseSuiteOrigin(text(source.origin)),
    ids: ids.length ? [...new Set(ids)] : undefined,
    cursor: text(source.cursor) ?? null,
    limit: parsedLimit === undefined ? SUITE_PAGE_SIZE_DEFAULT : Math.min(Math.max(parsedLimit, 1), SUITE_PAGE_SIZE_MAX)
  };
}
/** 来源只接受契约枚举内的两个字面量；未知取值报 400，避免前端拼错参数时静默退化成“全部”。 */
function parseSuiteOrigin(value: string | undefined): SuiteOrigin | undefined {
  if (value === undefined) return undefined;
  if (value !== "builtin" && value !== "user") throw new ApiError(400, "VALIDATION_ERROR", "origin must be builtin or user");
  return value;
}
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
  return enumValue<AssetRole>(value, ASSET_ROLES, "role");
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
function verifyCopywritingModel(repository: EcomRepository, providerId: string | null, modelId: string | null): void {
  if (!providerId || !modelId) throw new ApiError(422, "PROVIDER_NOT_CONFIGURED", "请先在项目设置中选择推理与图片模型");
  const provider = repository.getProvider(providerId);
  if (!provider) missing("provider", providerId);
  const model = provider.models.find((candidate) => candidate.id === modelId);
  if (!model) throw new ApiError(400, "VALIDATION_ERROR", "Configured reasoning model is not declared by its provider");
  if (!model.supportsVision) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected reasoning model must support Vision for AI copywriting");
}
interface EditGenerationConfig { reasoningProviderId: string; reasoningModelId: string; imageProviderId: string; imageModelId: string; imageResolution: ImageResolution; candidateCount: number; }
function editGenerationConfigFor(repository: EcomRepository, project: ProjectRecord, annotations: Record<string, unknown>): EditGenerationConfig {
  const raw = annotations.generationConfig;
  if (raw === undefined) {
    // 无注解配置时沿用项目默认；Provider 被删除后引用已置空，这里显式拦截而不是把 null 传给任务
    if (!project.reasoningProviderId || !project.reasoningModelId || !project.imageProviderId || !project.imageModelId) {
      throw new ApiError(422, "PROVIDER_NOT_CONFIGURED", "请先在项目设置中选择推理与图片模型");
    }
    return { reasoningProviderId: project.reasoningProviderId, reasoningModelId: project.reasoningModelId, imageProviderId: project.imageProviderId, imageModelId: project.imageModelId, imageResolution: project.imageResolution, candidateCount: clampCandidates(project.candidatesPerType) };
  }
  const config = parseBody(EditGenerationConfigInput, raw, { pathPrefix: "annotations.generationConfig" });
  const reasoningProviderId = readText(config.reasoningProviderId, "annotations.generationConfig.reasoningProviderId");
  const reasoningModelId = readText(config.reasoningModelId, "annotations.generationConfig.reasoningModelId");
  const imageProviderId = readText(config.imageProviderId, "annotations.generationConfig.imageProviderId");
  const imageModelId = readText(config.imageModelId, "annotations.generationConfig.imageModelId");
  verifyModel(repository, reasoningProviderId, reasoningModelId, "reasoning");
  verifyModel(repository, imageProviderId, imageModelId, "image");
  return { reasoningProviderId, reasoningModelId, imageProviderId, imageModelId, imageResolution: config.imageResolution === undefined ? project.imageResolution : config.imageResolution, candidateCount: config.candidateCount === undefined ? clampCandidates(project.candidatesPerType) : config.candidateCount };
}
/** 入队失败时同步把任务的领域伴随记录推进到终态，避免前端看到永远 QUEUED 的记录。 */
function markDomainRecordFailed(repository: EcomRepository, type: JobType, jobId: string): void {
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
// ProviderId/modelId 为 null 表示项目尚未选择模型（Provider 被删除后置空），在入口拦截而不是打出一个注定失败的任务
function verifyModel(repository: EcomRepository, providerId: string | null, modelId: string | null, kind: "reasoning" | "image"): void { if (!providerId || !modelId) throw new ApiError(422, "PROVIDER_NOT_CONFIGURED", "请先在项目设置中选择推理与图片模型"); const provider = repository.getProvider(providerId); if (!provider) missing("provider", providerId); const model = provider.models.find((candidate) => candidate.id === modelId); if (!model) throw new ApiError(400, "VALIDATION_ERROR", `${kind} model is not declared by the selected provider`); if (kind === "image" && !model.imageApiKind) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected image model has no image API configured"); }
/** 分割模型引用必须指向声明了 segmentationProtocol 的模型；存储的 protocol 从模型声明派生，请求里显式给出的协议仅用于一致性校验。 */
function readSegmentationModel(repository: EcomRepository, value: unknown): { providerId: string; modelId: string; protocol: SegmentationProtocol } {
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
/**
 * 透明底是参数级能力，不是提示词风格：模型给不了就在入队前拒绝，而不是让用户为一次注定画成棋盘格的调用付费。
 * 只有显式选 TRANSPARENT 才校验——SOURCE 的语义是"跟随源图"，源图是否透明由 worker 解码判定，
 * 那时源图案已经在库里，报错信息也能说清是"源的透明底保不住"。
 */
function assertTransparentBackgroundAvailable(repository: EcomRepository, providerId: string, modelId: string, mode: PatternBackgroundMode | undefined): void {
  if (mode !== "TRANSPARENT") return;
  const declared = repository.getProvider(providerId)?.models.find((candidate) => candidate.id === modelId);
  if (declared && supportsTransparentBackground(declared.id)) return;
  throw new ApiError(422, "CAPABILITY_UNSUPPORTED", `模型 ${modelId} 不支持透明底，请改用 gpt-image-1 / 1.5 / 2 系列，或把底版改成白底`);
}
function ensureProject(repository: EcomRepository, id: string): void { if (!repository.getProject(id)) missing("project", id); }
function missing(resource: string, id: string): never { throw new ApiError(404, "NOT_FOUND", `${resource} not found: ${id}`); }

function ensureModel(repository: EcomRepository, id: string): ModelRecord { const model = repository.getModel(id); if (!model) missing("model", id); return model; }
function ensurePattern(repository: EcomRepository, id: string): PatternRecord { const pattern = repository.getPattern(id); if (!pattern) missing("pattern", id); return pattern; }
function ensurePatternPipeline(repository: EcomRepository, id: string): PatternPipelineWithSteps { const pipeline = repository.getPatternPipeline(id); if (!pipeline) missing("pattern pipeline", id); return pipeline; }

/**
 * 指纹复用的前提是产物仍在：在途任务照常复用——forge/cast 的产物随候选完成才逐张落库，
 * 在途阶段以"产物存在"为复用条件会让重复提交重复计费；SUCCEEDED 任务的产物被删除后
 * 指纹成为孤儿，复用它只会返回一个不再产出任何东西的旧任务（花型墙/定妆照区永远空着），
 * 必须放行走新建流程。同一指纹新建任务安全：findJobByFingerprint 取最新一条且无唯一约束。
 */
function reusableFingerprintedJob(existing: JobRecord, hasProducts: boolean): boolean {
  return existing.status !== "SUCCEEDED" || hasProducts;
}
function publicPattern(record: PatternRecord) {
  return {
    id: record.id,
    name: record.name,
    source: record.sourceType,
    tags: record.tags,
    sourceJobId: record.sourceJobId,
    parentPatternId: record.parentPatternId,
    tileable: record.tileable,
    tileableScore: record.tileableScore,
    tileableCheckedWith: record.tileableCheckedWith,
    ...(record.storagePath ? { imageUrl: `/api/v1/files/patterns/${record.id}` } : {}),
    ...(record.fileHash ? { thumbUrl: `/api/v1/files/thumbnails/${record.fileHash}` } : {}),
    width: record.width,
    height: record.height,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
/** 流水线序列化：步骤按 position 顺序下发，前端直接照它渲染时间线收据（不重新排序）。 */
function publicPatternPipeline(record: PatternPipelineWithSteps) {
  return {
    id: record.id,
    patternId: record.patternId,
    specId: record.specId,
    specVersion: record.specVersion,
    layout: record.layout,
    repeatLayout: record.repeatLayout,
    listingPlatform: record.listingPlatform,
    listingProviderId: record.listingProviderId,
    listingModelId: record.listingModelId,
    status: record.status,
    blockReason: record.blockReason,
    steps: record.steps.map((step) => ({ step: step.step, position: step.position, status: step.status, jobId: step.jobId, detail: step.detail, error: step.error })),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
function publicPrintPack(record: PrintPackRecord) {
  return {
    id: record.id,
    jobId: record.jobId,
    patternId: record.patternId,
    specId: record.specId,
    specVersion: record.specVersion,
    status: record.status,
    files: (record.files ?? []).map((file, index) => ({ name: file.name, kind: file.kind, hash: file.hash, url: `/api/v1/files/print-packs/${record.id}/files/${index}` })),
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
/** 花型提取的分割模型解析：与项目分层同语义——协议从模型声明派生，请求显式协议仅做一致性校验。 */
function resolvePatternSegmentationModel(repository: EcomRepository, providerId: string, modelId: string, requestedProtocol: string | null | undefined): { provider: ProviderRecord; model: { id: string }; protocol: SegmentationProtocol } {
  const provider = repository.getProvider(providerId);
  if (!provider) missing("provider", providerId);
  const model = provider.models.find((candidate) => candidate.id === modelId);
  if (!model) throw new ApiError(400, "VALIDATION_ERROR", "segmentation model is not declared by the selected provider");
  if (!model.segmentationProtocol) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected segmentation model has no segmentation API configured");
  const requested = requestedProtocol ? enumValue(requestedProtocol, [...SEGMENTATION_PROTOCOLS], "protocol") : undefined;
  if (requested && requested !== model.segmentationProtocol) throw new ApiError(400, "VALIDATION_ERROR", `protocol must match the model's declared protocol (${model.segmentationProtocol})`);
  if (model.segmentationProtocol === "seedream_layerize") throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "花型提取不支持 Seedream 图层拆分协议，请选择 SAM 类分割模型");
  return { provider, model, protocol: model.segmentationProtocol };
}
/**
 * 成包答案的校验：规格必须存在，文案模型必须是支持视觉的推理模型（文案步骤要读花型图）。
 *
 * 与建链分开是因为源入口要在**写任何文件或行之前**先失败：一个 400 请求不该留下半个花型。
 * 返回解析出的规格，供调用方避免二次查表。
 */
function validatePatternPipelineAnswers(repository: EcomRepository, answers: PatternPipelineAnswers) {
  const spec = getPodPrintSpec(answers.specId);
  if (!spec) throw new ApiError(400, "VALIDATION_ERROR", `未知的印刷规格：${answers.specId}`);
  if (answers.repeatLayout && (answers.layout ?? "CENTERED") !== "TILE") {
    throw new ApiError(400, "VALIDATION_ERROR", "平铺排列仅在满印（TILE）版式下生效");
  }
  verifyCopywritingModel(repository, answers.listingProviderId, answers.listingModelId);
  return spec;
}
/** multipart 的 tags 字段是 JSON 数组字符串；逐项校验后截断到容量上限。 */
/**
 * 源入口（提取 / 上传）共用的 multipart 收集：一个 image/* 文件 + 一组文本字段。
 * 收集规则只写这一份——两个路由各抄一遍的话，将来加同一条字段约束必然漏一处。
 * fileLabel 同时拼进三条错误信息与缺省文件名（如 "source image" / "pattern image"）。
 */
async function readSingleImageMultipart(request: FastifyRequest, fileLabel: string): Promise<{ upload: { filename: string; buffer: Buffer }; fields: Record<string, string> }> {
  let upload: { filename: string; buffer: Buffer } | null = null;
  const fields: Record<string, string> = {};
  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (!part.mimetype.startsWith("image/")) throw new ApiError(400, "VALIDATION_ERROR", "Only image files are supported");
      if (upload) throw new ApiError(400, "VALIDATION_ERROR", `A single ${fileLabel} is required`);
      upload = { filename: part.filename || fileLabel, buffer: await part.toBuffer() };
      continue;
    }
    fields[part.fieldname] = typeof part.value === "string" ? part.value : String(part.value ?? "");
  }
  if (!upload) throw new ApiError(400, "VALIDATION_ERROR", `A ${fileLabel} is required`);
  return { upload, fields };
}

/** multipart 字段不走 TypeBox，长度上限必须在这里对齐契约（同 suite-forge 的 boundedText 约定）。 */
function optionalBoundedText(value: string | undefined, maxLength: number, field: string): string | undefined {
  if (value && value.length > maxLength) throw new ApiError(400, "VALIDATION_ERROR", `${field} must be at most ${maxLength} characters`);
  return value;
}

function parsePatternTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ApiError(400, "VALIDATION_ERROR", "tags must be a JSON array of strings"); }
  if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== "string")) throw new ApiError(400, "VALIDATION_ERROR", "tags must be a JSON array of strings");
  const tags = parsed.map((tag) => (tag as string).trim()).filter(Boolean).slice(0, PATTERN_TAGS_MAX);
  if (tags.some((tag) => tag.length > MAX_PATTERN_TAG_LENGTH)) throw new ApiError(400, "VALIDATION_ERROR", `tag exceeds ${MAX_PATTERN_TAG_LENGTH} characters`);
  return tags;
}
/**
 * multipart 里的成包答案：多段表单只能传字符串，所以这一项是 JSON 文本。
 * 解析失败与字段缺失必须给不同口径的错误——把"没填"和"填错了"混成同一句，用户改不动。
 */
function readPatternPipelineAnswers(raw: string | null | undefined): PatternPipelineAnswers | undefined {
  const text = readOptionalText(raw);
  if (!text) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ApiError(400, "VALIDATION_ERROR", "pipeline 必须是 JSON 对象"); }
  return parseBody(PatternPipelineAnswers, parsed);
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
function contentHash(content: Buffer): string { return createHash("sha256").update(content).digest("hex"); }
function parseReferenceSelections(value: string | undefined): ReferenceSelection[] {
  if (!value) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new ApiError(400, "VALIDATION_ERROR", "referenceSelections must be valid JSON"); }
  if (!Array.isArray(parsed)) throw new ApiError(400, "VALIDATION_ERROR", "referenceSelections must be an array");
  const purposes: ReferencePurpose[] = ["PRODUCT_APPEARANCE", "PACKAGING", "LABEL", "STYLE", "LAYOUT"];
  const seen = new Set<string>();
  const selections = parsed.map((item, index) => {
    const entry = readObject(item, `referenceSelections[${index}]`);
    const id = readText(entry.id, `referenceSelections[${index}].id`); const source = enumValue<"PROJECT" | "TEMPORARY">(entry.source, ["PROJECT", "TEMPORARY"], `referenceSelections[${index}].source`); const purpose = enumValue<ReferencePurpose>(entry.purpose, purposes, `referenceSelections[${index}].purpose`);
    if (seen.has(`${source}:${id}`)) throw new ApiError(400, "VALIDATION_ERROR", "referenceSelections cannot contain duplicates");
    seen.add(`${source}:${id}`); return { id, source, purpose, order: index };
  });
  return selections;
}
async function validateMaskDimensions(sourcePath: string, mask: Buffer, storage: LocalAssetStore): Promise<void> {
  const [source, candidate] = await Promise.all([sharp(await storage.read(sourcePath)).metadata(), sharp(mask).metadata()]);
  if (!source.width || !source.height || source.width !== candidate.width || source.height !== candidate.height) throw new ApiError(400, "VALIDATION_ERROR", "MASK_DIMENSION_MISMATCH");
}
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
// requestedId 用于 404 文案带上真实请求标识：sendStored 不知道路由参数名，由各端点自行传入。
async function sendStored(request: FastifyRequest, reply: FastifyReply, storage: LocalAssetStore, record: { storagePath: string | null; mimeType?: string; hash?: string } | undefined, name: string, requestedId: string): Promise<unknown> {
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
function mimeForPath(path: string): string { if (path.endsWith(".png")) return "image/png"; if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"; if (path.endsWith(".webp")) return "image/webp"; if (path.endsWith(".zip")) return "application/zip"; if (path.endsWith(".psd")) return "image/vnd.adobe.photoshop"; return "application/octet-stream"; }
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
/** 缩略图只承载网格预览：限制在 512px 内并按 EXIF 方向校正，统一转 webp 控制体积。 */
async function renderThumbnail(content: Buffer): Promise<Buffer> {
  return sharp(content).rotate().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
}
async function writeThumbnail(storage: LocalAssetStore, hash: string, content: Buffer): Promise<void> {
  try {
    await storage.putThumbnail(hash, await renderThumbnail(content));
  } catch {
    // 缩略图是派生缓存，入库失败不阻断上传；/files/thumbnails 会在首次访问时重试
  }
}
async function imageDimensions(content: Buffer): Promise<{ width: number | null; height: number | null }> {
  try {
    const metadata = await sharp(content).metadata();
    return { width: metadata.width ?? null, height: metadata.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}
