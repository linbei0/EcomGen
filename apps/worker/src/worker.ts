import { PassThrough } from "node:stream";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import archiver from "archiver";
import sharp from "sharp";
import { writePsdBuffer } from "ag-psd";
import { planImageEdit, planLayerElements, planStoryboard, reviseImagePrompt, writeCopywriting } from "@ecomgen/agent";
import { EcomRepository, EXTERNAL_REQUEST_STARTED, LocalAssetStore, SecretBox, openDatabase, resolveDataDir, type AssetRecord, type EditTurnRecord, type JobRecord, type LayerExportLayerFileRecord, type LayerExportRecord, type LayerPlanRecord, type ProjectRecord } from "@ecomgen/core";
import { compileUserTemplate, getTemplate, type EcomTemplate } from "@ecomgen/ecom-skill";
import { resolveImageSize, userAssetKindForRole, SEGMENTATION_PROTOCOL_CAPABILITIES, isSegmentationProtocol, type CopywritingTarget, type EditExecutionMode, type EditOperation, type ImageAspectRatio, type ImageResolution, type JobType, type PlanningMode } from "@ecomgen/contracts";
import { createJobQueue, createRedisConnection, enqueue, type EcomJobKind, type EcomJobPayload, QUEUE_NAME, RedisProjectEventBus } from "@ecomgen/jobs";
import { GeminiImageProvider, OpenAiCompatibleImageProvider, ProviderError, SeedreamLayerizeProvider, buildReasoningModel, createSegmentationProvider, highInputFidelityForOpenAiImageModel, imageEditCapabilitiesFor } from "@ecomgen/providers";
import { createPsdLayerAccumulator, extractAlpha, invertMask, multiplyAlpha, unionOfMasks } from "./layer-composite.js";
import { assertPixelProtectedInputs, assignImageHandles, imageHandle, selectGenerationAssets, selectVisionAssets, visionAttachmentMetadata, withGenerationAssetRoles } from "./visual-assets.js";
import { VisionDerivativeCache } from "./vision-cache.js";

const masterKey = process.env.ECOMGEN_MASTER_KEY;
if (!masterKey) throw new Error("ECOMGEN_MASTER_KEY must be a base64-encoded 32-byte key");
const projectRoot = resolve(import.meta.dirname, "../../..");
const dataDir = resolveDataDir(process.env.ECOMGEN_DATA_DIR, projectRoot);
const repository = new EcomRepository(openDatabase(resolve(dataDir, "ecomgen.sqlite")));
const storage = new LocalAssetStore(dataDir); await storage.initialize();
const visionCache = new VisionDerivativeCache(dataDir); await visionCache.initialize();
const secrets = new SecretBox(masterKey);
const redis = createRedisConnection(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const events = new RedisProjectEventBus(redis.duplicate(), redis.duplicate());
const recoveryRedis = redis.duplicate();
const recoveryQueue = createJobQueue(recoveryRedis);
const executionRedis = redis.duplicate();
const executionQueue = createJobQueue(executionRedis);
async function cleanupExpiredEditReferences(): Promise<void> {
  for (const asset of repository.listExpiredEditReferenceAssets()) { await storage.delete(asset.storagePath); repository.deleteEditReferenceAsset(asset.id); }
}
await cleanupExpiredEditReferences();
const referenceCleanupTimer = setInterval(() => { void cleanupExpiredEditReferences(); }, 60 * 60 * 1000);
referenceCleanupTimer.unref();
// 进程异常退出后，数据库中的 RUNNING 任务会被重新置为 QUEUED 并再次交给 BullMQ。
for (const recovered of repository.recoverInterruptedJobs()) await enqueue(recoveryQueue, { jobId: recovered.id, kind: queueKindForJobType(recovered.type) });
await recoveryQueue.close();
await recoveryRedis.quit();

const worker = new Worker<EcomJobPayload>(QUEUE_NAME, async (queueJob) => {
  const job = repository.getJob(queueJob.data.jobId); if (!job) throw new Error(`Database job is missing: ${queueJob.data.jobId}`);
  if (job.status === "CANCELLED" || job.cancelRequested) return;
  await updateJob(job, { status: "RUNNING", progress: 5, error: null });
  try {
    if (queueJob.data.kind === "plan") await executePlan(job);
    else if (queueJob.data.kind === "copywrite") await executeCopywriting(job);
    else if (queueJob.data.kind === "generate") await executeGeneration(job);
    else if (queueJob.data.kind === "edit_plan") await executeEditPlan(job);
    else if (queueJob.data.kind === "edit_generate") await executeEditGeneration(job);
    else if (queueJob.data.kind === "layer_plan") await executeLayerPlan(job);
    else if (queueJob.data.kind === "layer_export") await executeLayerExport(job);
    else await executeExport(job);
    // 终态与清空外部请求标记在同一条 UPDATE 内原子完成：标记一旦设置就只在终态消失，
    // 避免终态写入前进程崩溃时恢复层误判任务仍在付费请求窗口内。
    const current = repository.getJob(job.id); if (current?.cancelRequested || current?.status === "CANCELLED") { await updateJob(job, { status: "CANCELLED", progress: current.progress, providerTaskId: null }); } else await updateJob(job, { status: "SUCCEEDED", progress: 100, providerTaskId: null });
  } catch (error) {
    if (error instanceof JobCancelled) { await updateJob(job, { status: "CANCELLED", cancelRequested: true, providerTaskId: null }); return; }
    const message = error instanceof Error ? error.message : String(error);
    if (job.type === "EDIT_PLAN" || job.type === "EDIT_GENERATE") {
      const turnId = typeof job.input.editTurnId === "string" ? job.input.editTurnId : "";
      if (turnId) {
        const turn = repository.updateEditTurn(turnId, { status: "FAILED", error: { message } });
        if (turn) await events.publish(job.projectId, "edit-turn.updated", { turn });
      }
    }
    await updateJob(job, { status: "FAILED", progress: 100, error: { message, providerStatus: error instanceof ProviderError ? error.status : undefined } });
    throw error;
  }
}, { connection: redis, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) });

worker.on("failed", (job, error) => { console.error(`Queue job ${job?.id ?? "unknown"} failed: ${error instanceof Error ? error.message : String(error)}`); });
async function stop(): Promise<void> { clearInterval(referenceCleanupTimer); await worker.close(); await executionQueue.close(); await executionRedis.quit(); await events.close(); await redis.quit(); }
process.once("SIGINT", () => { void stop().then(() => process.exit(0)); });
process.once("SIGTERM", () => { void stop().then(() => process.exit(0)); });

async function executePlan(job: JobRecord): Promise<void> {
  throwIfCancelled(job);
  const project = projectFor(job); const provider = providerFor(project.reasoningProviderId); const model = provider.models.find((candidate) => candidate.id === project.reasoningModelId);
  if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
  await updateJob(job, { progress: 25 });
  const assets = repository.listAssets(project.id);
  const visualAssets = selectVisionAssets(assets);
  const referenceImages = model.supportsVision ? await visionImageContents(visualAssets) : undefined;
  const input = job.input as { planningMode?: PlanningMode; requestedTypes?: string[]; userInstruction?: string; candidatesPerType?: number; targetImageCount?: number; imageResolution?: ImageResolution; imageAspectRatio?: ImageAspectRatio };
  if (input.imageResolution || input.imageAspectRatio || input.candidatesPerType) {
    repository.updateProject(project.id, {
      imageResolution: input.imageResolution ?? project.imageResolution,
      imageAspectRatio: input.imageAspectRatio ?? project.imageAspectRatio,
      candidatesPerType: input.candidatesPerType ?? project.candidatesPerType
    });
  }
  // 模型上下文只出现 P1/R1 短指代；真实素材 ID 不进入任何提示词，映射在代码内完成。
  const imageHandles = assignImageHandles(assets);
  const plannerAssets = visualAssets.map((asset) => ({ id: asset.id, handle: imageHandle(imageHandles, asset.id), role: asset.role, kind: userAssetKindForRole(asset.role), name: asset.originalName, mimeType: asset.mimeType }));
  const webResearch = project.webResearchEnabled ? configuredWebResearch() : undefined;
  repository.createWebResearchAudit(job.id, webResearch ? "AVAILABLE" : project.webResearchEnabled ? "UNAVAILABLE" : "DISABLED");
  const plan = await planStoryboard({
    model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking, supportsStructuredOutput: model.supportsStructuredOutput }),
    apiKey: secrets.decrypt(provider.encryptedApiKey),
    projectName: project.name,
    productCategory: project.category,
    productDescription: project.productDescription,
    verifiedFacts: project.verifiedFacts,
    prohibitedClaims: project.prohibitedClaims,
    brandGuidelines: project.brandGuidelines,
    platformTargets: project.platformTargets,
    targetMarket: project.targetMarket,
    copyLanguage: project.copyLanguage,
    defaultMode: project.defaultMode,
    assets: plannerAssets,
    referenceImages,
    visionAttachments: visionAttachmentMetadata(visualAssets.map((asset) => ({ ...asset, name: asset.originalName })), imageHandles),
    planningMode: input.planningMode ?? "AI",
    requestedTypes: input.requestedTypes,
    userTemplates: compiledUserTemplates(),
    userInstruction: input.userInstruction,
    candidatesPerType: input.candidatesPerType ?? project.candidatesPerType,
    targetImageCount: input.targetImageCount,
    webResearch: webResearch ? {
      ...webResearch,
      audit: {
        onSearchStarted: () => repository.recordWebResearchSearch(job.id),
        onSourceAttempt: (attempt) => repository.recordWebResearchAttempt({ jobId: job.id, ...attempt })
      }
    } : undefined
  });
  throwIfCancelled(job);
  const storyboard = repository.saveStoryboard(project.id, plan.campaignStyleLock, "DRAFT", plan.items.map((item) => ({ ...item, status: "DRAFT", compiledPrompt: null })));
  repository.createPlanningConfigSnapshot({
    projectId: project.id,
    sourceJobId: job.id,
    payload: {
      project: {
        name: project.name, category: project.category, productDescription: project.productDescription,
        verifiedFacts: project.verifiedFacts, prohibitedClaims: project.prohibitedClaims, brandGuidelines: project.brandGuidelines,
        platformTargets: project.platformTargets, targetMarket: project.targetMarket, copyLanguage: project.copyLanguage,
        reasoningProviderId: project.reasoningProviderId, reasoningModelId: project.reasoningModelId,
        imageProviderId: project.imageProviderId, imageModelId: project.imageModelId, defaultMode: project.defaultMode,
        imageResolution: input.imageResolution ?? project.imageResolution, imageAspectRatio: input.imageAspectRatio ?? project.imageAspectRatio,
        candidatesPerType: input.candidatesPerType ?? project.candidatesPerType, webResearchEnabled: project.webResearchEnabled,
      },
      planning: {
        planningMode: input.planningMode ?? "AI", requestedTypes: input.requestedTypes ?? [],
        targetImageCount: input.targetImageCount ?? null, userInstruction: input.userInstruction ?? null,
      },
    },
  });
  await updateJob(job, { progress: 90 }); await events.publish(project.id, "storyboard.updated", { storyboard, items: repository.listStoryboardItems(project.id) });
}

async function executeCopywriting(job: JobRecord): Promise<void> {
  throwIfCancelled(job);
  const project = projectFor(job);
  const provider = providerFor(project.reasoningProviderId);
  const model = provider.models.find((candidate) => candidate.id === project.reasoningModelId);
  if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
  if (!model.supportsVision) throw new Error("Selected reasoning model must support Vision for AI copywriting");
  const assets = selectVisionAssets(repository.listAssets(project.id));
  if (!assets.some((asset) => asset.role === "PRODUCT_TRUTH")) throw new Error("AI copywriting requires at least one product image");
  const target = job.input.target;
  if (target !== "PRODUCT_DESCRIPTION" && target !== "PLANNING_INSTRUCTION") throw new Error("Copywriting job has an invalid target");
  await updateJob(job, { progress: 25 });
  const visualAttachments = await visionImageContents(assets);
  const imageHandles = assignImageHandles(assets);
  const result = await writeCopywriting({
    target: target as CopywritingTarget,
    model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking, supportsStructuredOutput: model.supportsStructuredOutput }),
    apiKey: secrets.decrypt(provider.encryptedApiKey),
    projectName: project.name,
    productCategory: project.category,
    productDescription: project.productDescription,
    verifiedFacts: project.verifiedFacts,
    prohibitedClaims: project.prohibitedClaims,
    platformTargets: project.platformTargets,
    targetMarket: project.targetMarket,
    copyLanguage: project.copyLanguage,
    assets: assets.map((asset) => ({ handle: imageHandle(imageHandles, asset.id), role: asset.role, name: asset.originalName, mimeType: asset.mimeType })),
    referenceImages: visualAttachments,
  });
  throwIfCancelled(job);
  repository.saveCopywritingResult({ jobId: job.id, projectId: project.id, target: result.target, content: result.content });
  await updateJob(job, { progress: 90 });
}

/** 自定义模板按 job 执行时从 DB 实时编译：表极小，无缓存必要，且保证与 API 同一编译口径。 */
function compiledUserTemplates(): EcomTemplate[] {
  return repository.listUserTemplates().map((record) => compileUserTemplate({ id: record.id, name: record.name, prompt: record.prompt, defaultSize: record.defaultSize, supportsImageReference: record.supportsImageReference }));
}

/** 搜索源严格按后台 priority 执行；所有源失败仍由 Pi 使用已有项目上下文完成规划。 */
function configuredWebResearch() {
  const sources = repository.listSearchSources()
    .filter((source) => source.enabled && (source.kind === "searxng" || source.encryptedApiKey))
    .map((source) => ({ id: source.id, name: source.name, kind: source.kind, baseUrl: source.baseUrl, apiKey: source.encryptedApiKey ? secrets.decrypt(source.encryptedApiKey) : undefined }));
  return sources.length ? { sources, maxResults: 3, timeoutMs: 8_000 } : undefined;
}

async function executeGeneration(job: JobRecord): Promise<void> {
  throwIfCancelled(job);
  if (!job.storyboardItemId) throw new Error("Generation job has no storyboard item");
  const project = projectFor(job); const item = repository.getStoryboardItem(job.storyboardItemId); if (!item || item.projectId !== project.id) throw new Error("Storyboard item is missing or belongs to another project");
  const providerId = job.providerId ?? item.imageProviderId;
  const modelId = job.modelId ?? item.imageModelId;
  if (!providerId || !modelId) throw new Error("该项目尚未选择生图模型（Provider 可能已被删除），请在项目设置中重新选择");
  const provider = providerFor(providerId); const model = provider.models.find((candidate) => candidate.id === modelId); if (!model) throw new Error("Configured image model no longer exists in its provider"); if (model.imageApiKind !== "openai_images" && model.imageApiKind !== "gemini") throw new Error("Selected image model has no executable image API");
  const storyboard = repository.getStoryboard(project.id); if (!storyboard) throw new Error("Storyboard is missing"); const template = getTemplate(item.assetType) ?? compiledUserTemplates().find((userTemplate) => userTemplate.id === item.assetType); if (!template) throw new Error(`分镜引用的模板不存在或已被删除（${item.assetType}），无法生成；请删除该分镜或重新规划`);
  const projectAssets = repository.listAssets(project.id);
  const inputs = selectGenerationAssets(projectAssets, item);
  const generationInputs = template.supports_image_reference ? inputs : [];
  if (item.mode === "PIXEL_PROTECTED") assertPixelProtectedInputs(generationInputs);
  const revision = typeof job.input.revision === "string" ? job.input.revision.trim() : "";
  const isRetry = revision === "retry";
  const generationBatchId = typeof job.input.generationBatchId === "string" ? job.input.generationBatchId : job.id;
  const candidateIndex = typeof job.input.candidateIndex === "number" ? job.input.candidateIndex : 1;
  const resolution = (typeof job.input.imageResolution === "string" ? job.input.imageResolution : item.imageResolution) as ImageResolution;
  const aspectRatio = (typeof job.input.imageAspectRatio === "string" ? job.input.imageAspectRatio : item.imageAspectRatio) as ImageAspectRatio;
  const size = resolveImageSize(resolution, aspectRatio, template.defaultSize);
  const basePrompt = item.promptInstruction.trim();
  if (!basePrompt) throw new Error("Storyboard item has no final image prompt; re-plan the storyboard before generating");
  if (/upstream template|template fields|anti-ai guidance|category guidance|promptcontract/i.test(basePrompt)) {
    throw new Error("This storyboard contains an old internal template prompt; re-plan the storyboard before generating");
  }
  const prompt = revision && !isRetry
    ? await reviseGenerationPrompt(project, basePrompt, revision)
    : basePrompt;
  const compiledPrompt = withGenerationAssetRoles(prompt, generationInputs, assignImageHandles(projectAssets));
  const generationKey = generationKeyFor(job.id, candidateIndex);
  const existingOutput = repository.getOutputByGenerationKey(generationKey);
  if (existingOutput) {
    repository.updateStoryboardItem(item.id, { status: "GENERATED" });
    await updateJob(job, { providerTaskId: null });
    await events.publish(project.id, "output.created", { output: existingOutput });
    return;
  }
  repository.updateStoryboardItem(item.id, { status: "GENERATING", compiledPrompt }); await updateJob(job, { progress: 30 });
  const images = await Promise.all(generationInputs.map(async (asset) => ({ data: await storage.read(asset.storagePath), filename: asset.originalName, mimeType: asset.mimeType })));
  const generator = model.imageApiKind === "gemini"
    ? new GeminiImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) })
    : new OpenAiCompatibleImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) });
  await updateJob(job, { providerTaskId: EXTERNAL_REQUEST_STARTED });
  const inputFidelity = model.imageApiKind === "openai_images" && generationInputs.some((asset) => asset.role === "PRODUCT_TRUTH")
    ? highInputFidelityForOpenAiImageModel(model.id)
    : undefined;
  const result = await generator.generate(model.imageApiKind === "gemini"
    ? { model: model.id, prompt: compiledPrompt, imageAspectRatio: aspectRatio, imageResolution: resolution, images: images.length ? images : undefined, idempotencyKey: generationKey }
    : { model: model.id, prompt: compiledPrompt, size, quality: "high", images: images.length ? images : undefined, inputFidelity, idempotencyKey: generationKey });
  throwIfCancelled(job);
  await updateJob(job, { progress: 80, providerTaskId: result.providerTaskId ?? EXTERNAL_REQUEST_STARTED }); const stored = await storage.putOutput(project.id, result.image, extensionForMime(result.mimeType), generationKey);
  throwIfCancelled(job);
  const output = repository.createOutput({
    projectId: project.id,
    storyboardItemId: item.id,
    jobId: job.id,
    candidateIndex,
    generationSnapshot: { providerId, modelId, resolution, aspectRatio, size, candidateIndex, ...(revision ? { revision } : {}) },
    storagePath: stored.path,
    hash: stored.hash,
    generationKey,
    generationBatchId,
  });
  await updateJob(job, { providerTaskId: null });
  repository.updateStoryboardItem(item.id, { status: "GENERATED" }); await events.publish(project.id, "output.created", { output });
}

async function executeEditPlan(job: JobRecord): Promise<void> {
  const turn = editTurnFor(job);
  const project = projectFor(job);
  const config = editGenerationConfigFor(project, turn);
  const provider = providerFor(config.reasoningProviderId);
  const model = provider.models.find((candidate) => candidate.id === config.reasoningModelId);
  if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
  await updateJob(job, { progress: 25 });
  const session = repository.getEditSession(turn.sessionId); if (!session) throw new Error("Edit session is missing");
  const assets = repository.listAssets(project.id);
  const imageProvider = providerFor(config.imageProviderId);
  const imageModel = imageProvider.models.find((candidate) => candidate.id === config.imageModelId);
  const temporaryAssets = repository.listEditReferenceAssets(turn.sessionId).filter((asset) => asset.expiresAt > new Date().toISOString());
  const references = turn.referenceSelections.slice().sort((left, right) => left.order - right.order).flatMap((selection) => {
    const asset = selection.source === "PROJECT" ? assets.find((candidate) => candidate.id === selection.id) : temporaryAssets.find((candidate) => candidate.id === selection.id);
    return asset ? [{ id: asset.id, name: asset.originalName, role: "role" in asset ? asset.role : "TEMPORARY", source: selection.source, purpose: selection.purpose, order: selection.order }] : [];
  });
  const source = repository.getOutput(turn.baseOutputId); if (!source) throw new Error("Edit source output is missing");
  let plan;
  try {
    plan = await planImageEdit({
      model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking, supportsStructuredOutput: model.supportsStructuredOutput }),
      apiKey: secrets.decrypt(provider.encryptedApiKey),
      message: turn.message,
      annotations: turn.annotations,
      hasEditMask: Boolean(turn.editMaskPath),
      hasCanvasExpansion: Boolean((turn.annotations as Record<string, unknown>).canvasExpansion),
      referenceAssets: references,
      memorySummary: effectiveEditMemory(session, turn.baseOutputId),
      projectFacts: project.verifiedFacts,
      imageCapabilities: imageModel ? imageEditCapabilitiesFor(imageModel) ?? undefined : undefined,
      sourceImage: model.supportsVision ? await visionSourceImage(source.storagePath) : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (["REFERENCE_ASSET_REQUIRED", "EDIT_TARGET_REQUIRED", "OUTPAINT_CANVAS_REQUIRED", "EDIT_VISION_REQUIRED"].includes(message)) {
      const updated = repository.updateEditTurn(turn.id, { status: "NEED_INPUT", error: { message } });
      if (updated) await events.publish(project.id, "edit-turn.updated", { turn: updated });
      await updateJob(job, { progress: 90 });
      return;
    }
    throw error;
  }
  throwIfCancelled(job);
  if (plan.executionMode === "NEED_INPUT") {
    const clarification = plan.clarification?.trim() || "请补充编辑目标或保护范围。";
    const updated = repository.updateEditTurn(turn.id, { status: "NEED_INPUT", plan: plan as unknown as Record<string, unknown>, error: { message: clarification } });
    if (updated) await events.publish(project.id, "edit-turn.updated", { turn: updated });
    await updateJob(job, { progress: 90 });
    return;
  }
  const status = plan.requiresConfirmation ? "AWAITING_CONFIRMATION" : "GENERATING";
  repository.updateEditTurn(turn.id, { status, plan: plan as unknown as Record<string, unknown>, error: null });
  await events.publish(project.id, "edit-turn.updated", { turn: repository.getEditTurn(turn.id) });
  if (!plan.requiresConfirmation) {
    const generation = repository.createJob({ id: randomUUID(), projectId: project.id, storyboardItemId: null, type: "EDIT_GENERATE", input: { editTurnId: turn.id }, requestFingerprint: null, providerId: config.imageProviderId, modelId: config.imageModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueue(executionQueue, { jobId: generation.id, kind: "edit_generate" });
  }
  await updateJob(job, { progress: 90 });
}

async function executeEditGeneration(job: JobRecord): Promise<void> {
  const turn = editTurnFor(job);
  const project = projectFor(job);
  const config = editGenerationConfigFor(project, turn);
  const session = repository.getEditSession(turn.sessionId); if (!session) throw new Error("Edit session is missing");
  const source = repository.getOutput(turn.baseOutputId); if (!source || source.projectId !== project.id) throw new Error("Edit source output is missing or belongs to another project");
  const plan = turn.plan as { operation?: string; executionMode?: EditExecutionMode; prompt?: string; compositePolicy?: "MASK_LOCKED" | "NATURAL_BLEND" | "OUTPAINT" | "PROVIDER_RESULT"; targetDescription?: string; targetConfidence?: number; memoryPatch?: { summary?: string; constraints?: string[] } } | null;
  if (!plan?.operation || !plan.executionMode || !plan.prompt || !plan.compositePolicy || plan.executionMode === "NEED_INPUT") throw new Error("Edit turn has no executable plan");
  if (plan.executionMode === "MASKED" && !turn.editMaskPath) throw new Error("EDIT_TARGET_REQUIRED: 局部编辑需要先标记可编辑区域");
  const outpaintExpansion = plan.compositePolicy === "OUTPAINT" ? canvasExpansionFor(turn) : null;
  if (plan.compositePolicy === "OUTPAINT" && !outpaintExpansion) throw new Error("OUTPAINT_CANVAS_REQUIRED");
  if (plan.compositePolicy === "MASK_LOCKED" && !turn.editMaskPath) throw new Error("EDIT_TARGET_REQUIRED");
  const provider = providerFor(config.imageProviderId);
  const model = provider.models.find((candidate) => candidate.id === config.imageModelId);
  if (!model || (model.imageApiKind !== "openai_images" && model.imageApiKind !== "gemini")) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持图像编辑");
  const capabilities = imageEditCapabilitiesFor(model); if (!capabilities) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持图像编辑");
  if (plan.executionMode === "MODEL_DIRECTED" && !capabilities.supportsUnmaskedEdit) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持无蒙版编辑");
  await updateJob(job, { progress: 30 });
  const sourceImage = await storage.read(source.storagePath);
  const mask = turn.editMaskPath ? await storage.read(turn.editMaskPath) : undefined;
  if (mask) await assertMaskDimensions(sourceImage, mask);
  const generator = model.imageApiKind === "gemini"
    ? new GeminiImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) })
    : new OpenAiCompatibleImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) });
  const assets = repository.listAssets(project.id);
  const temporaryAssets = repository.listEditReferenceAssets(turn.sessionId).filter((asset) => asset.expiresAt > new Date().toISOString());
  const references = await Promise.all(turn.referenceSelections.slice().sort((left, right) => left.order - right.order).map(async (selection) => {
    const asset = selection.source === "PROJECT" ? assets.find((candidate) => candidate.id === selection.id) : temporaryAssets.find((candidate) => candidate.id === selection.id);
    if (!asset) throw new Error(`Reference asset is missing: ${selection.id}`);
    return { data: await storage.read(asset.storagePath), filename: asset.originalName, mimeType: asset.mimeType };
  }));
  assertEditCapabilities(capabilities, plan.operation as EditOperation, plan.executionMode, Boolean(mask), references.length);
  const outpaintCanvas = outpaintExpansion ? await createOutpaintCanvas(sourceImage, outpaintExpansion) : null;
  const inputImage = outpaintCanvas?.image ?? sourceImage;
  const providerMask = outpaintCanvas?.mask ?? (plan.executionMode === "MASKED" && mask ? await providerMaskFor(sourceImage, mask, turn.protectMaskPath ? await storage.read(turn.protectMaskPath) : undefined) : undefined);
  const protectedMask = turn.protectMaskPath ? await storage.read(turn.protectMaskPath) : undefined;
  const createdOutputs: Array<ReturnType<typeof repository.createOutput>> = [];
  for (let candidateIndex = 1; candidateIndex <= config.candidateCount; candidateIndex += 1) {
    const generationKey = generationKeyFor(job.id, candidateIndex);
    const existingOutput = repository.getOutputByGenerationKey(generationKey);
    if (existingOutput) {
      createdOutputs.push(existingOutput);
      continue;
    }
    await updateJob(job, { providerTaskId: EXTERNAL_REQUEST_STARTED });
    const editInput = {
      model: model.id,
      prompt: plan.prompt,
      sourceImage: { data: inputImage, filename: "source.png", mimeType: "image/png" },
      referenceImages: references,
      mask: providerMask ? { data: providerMask, filename: "edit-mask.png", mimeType: "image/png" } : undefined,
      operation: plan.operation as EditOperation,
      idempotencyKey: generationKey
    };
    const result = await generator.editImage(model.imageApiKind === "gemini"
      ? { ...editInput, imageAspectRatio: project.imageAspectRatio, imageResolution: config.imageResolution }
      : { ...editInput, quality: "high", size: resolveImageSize(config.imageResolution, project.imageAspectRatio, "1024x1024"), inputFidelity: capabilities.supportsInputFidelity ? "high" : undefined });
    throwIfCancelled(job);
    await updateJob(job, { progress: 30 + Math.round((candidateIndex / config.candidateCount) * 45), providerTaskId: result.providerTaskId ?? EXTERNAL_REQUEST_STARTED });
    const composed = plan.executionMode === "MASKED" && plan.compositePolicy === "MASK_LOCKED" && mask
      ? await compositeMaskedEdit(sourceImage, result.image, mask, protectedMask)
      : plan.executionMode === "MASKED" && plan.compositePolicy === "NATURAL_BLEND"
        ? await compositeNaturalBlend(sourceImage, result.image, mask, protectedMask)
        : outpaintCanvas
          ? await compositeOutpaint(sourceImage, result.image, outpaintCanvas)
          : await sharp(result.image).png().toBuffer();
    const stored = await storage.putOutput(project.id, composed, ".png", generationKey);
    const output = repository.createOutput({ projectId: project.id, storyboardItemId: source.storyboardItemId, jobId: job.id, candidateIndex, generationSnapshot: { providerId: provider.id, modelId: model.id, resolution: config.imageResolution, aspectRatio: project.imageAspectRatio, size: "source", candidateIndex, operation: plan.operation as "PRECISE_INPAINT" | "PRODUCT_REPLACE" | "SCENE_ADJUST" | "NATURAL_FUSION" | "OUTPAINT", executionMode: plan.executionMode, targetDescription: plan.targetDescription, targetConfidence: plan.targetConfidence, sourceOutputId: source.id, maskHash: turn.editMaskHash, protectMaskHash: turn.protectMaskHash, compositePolicy: plan.compositePolicy, referenceSelections: turn.referenceSelections, referenceHashes: Object.fromEntries(turn.referenceSelections.map((selection) => { const asset = selection.source === "PROJECT" ? assets.find((candidate) => candidate.id === selection.id) : temporaryAssets.find((candidate) => candidate.id === selection.id); return [selection.id, asset?.hash ?? null]; })) }, storagePath: stored.path, hash: stored.hash, generationKey, parentOutputId: source.id, rootOutputId: source.rootOutputId ?? source.id, editSessionId: session.id, editTurnId: turn.id });
    await updateJob(job, { providerTaskId: null });
    createdOutputs.push(output);
  }
  const output = createdOutputs.at(-1);
  if (!output) throw new Error("Edit generation produced no outputs");
  await updateJob(job, { providerTaskId: null });
  const inheritedMemory = effectiveEditMemory(session, source.id);
  const nextMemory = { summary: plan.memoryPatch?.summary ?? inheritedMemory.summary, constraints: plan.memoryPatch?.constraints ?? inheritedMemory.constraints };
  const updatedSession = repository.updateEditSession(session.id, { currentOutputId: output.id, memorySummary: { ...session.memorySummary, scopes: { ...(session.memorySummary.scopes ?? {}), [output.id]: nextMemory } } });
  repository.updateEditTurn(turn.id, { status: "SUCCEEDED", error: null });
  if (updatedSession) await events.publish(project.id, "edit-session.updated", { session: updatedSession });
  for (const createdOutput of createdOutputs) await events.publish(project.id, "output.created", { output: createdOutput });
  await events.publish(project.id, "edit-turn.updated", { turn: repository.getEditTurn(turn.id) });
}

async function executeExport(job: JobRecord): Promise<void> {
  throwIfCancelled(job);
  const project = projectFor(job); const outputIds = Array.isArray(job.input.outputIds) ? job.input.outputIds.filter((value): value is string => typeof value === "string") : undefined;
  const outputs = repository.listOutputs(project.id).filter((output) => !outputIds || outputIds.includes(output.id)); if (outputs.length === 0) throw new Error("No outputs are available for export");
  const exportRecord = repository.getExportByJobId(job.id); await updateJob(job, { progress: 25 }); const imageFiles = await Promise.all(outputs.map(async (output, index) => ({ name: exportFileName(project, output, index), content: await storage.read(output.storagePath) })));
  // manifest 让导出包可追溯到事实、模板、Prompt、审核结果和输出内容 hash。
  const manifest = { version: 1, generatedAt: new Date().toISOString(), project: { id: project.id, name: project.name, platforms: project.platformTargets, category: project.category, imageResolution: project.imageResolution, imageAspectRatio: project.imageAspectRatio }, facts: { verified: project.verifiedFacts, prohibited: project.prohibitedClaims, brandGuidelines: project.brandGuidelines }, storyboard: outputs.map((output) => { const item = repository.getStoryboardItem(output.storyboardItemId); return { outputId: output.id, jobId: output.jobId, assetType: item?.assetType ?? null, displayName: item?.displayName ?? null, templateVariant: item?.templateVariant ?? null, mode: item?.mode ?? null, candidateIndex: output.candidateIndex, generationSnapshot: output.generationSnapshot, prompt: item?.compiledPrompt ?? null, sha256: output.hash }; }) };
  const archive = await createZip([...imageFiles, { name: "manifest.json", content: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") }]); const stored = await storage.putExport(project.id, archive);
  const target = exportRecord ?? repository.createExport({ projectId: project.id, jobId: job.id, status: "QUEUED", storagePath: null }); const updated = repository.updateExport(target.id, { status: "SUCCEEDED", storagePath: stored.path }); await events.publish(project.id, "export.updated", { export: updated });
}

async function executeLayerPlan(job: JobRecord): Promise<void> {
  const plan = layerPlanFor(job);
  try {
    const output = repository.getOutput(plan.outputId);
    if (!output || output.projectId !== plan.projectId) throw new Error("Layer plan source output is missing or belongs to another project");
    // 排队时 API 已把推理 Provider/模型写入 input 并计入指纹；执行只认这份快照，指纹与执行配置保持一致。
    const reasoningProviderId = typeof job.input.reasoningProviderId === "string" ? job.input.reasoningProviderId : "";
    const reasoningModelId = typeof job.input.reasoningModelId === "string" ? job.input.reasoningModelId : "";
    if (!reasoningProviderId || !reasoningModelId) throw new Error("Layer plan job is missing its reasoning model snapshot");
    const provider = providerFor(reasoningProviderId);
    const model = provider.models.find((candidate) => candidate.id === reasoningModelId);
    if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
    if (!model.supportsVision) throw new Error("CAPABILITY_UNSUPPORTED: 图层识别需要视觉推理模型");
    await updateJob(job, { progress: 25 });
    // 执行前先落 RUNNING：否则前端在整个识别过程中都只能看到 QUEUED。
    const running = repository.updateLayerPlan(plan.id, { status: "RUNNING", error: null });
    if (running) await events.publish(job.projectId, "layer-plan.updated", { plan: running });
    const image = await visionSourceImage(output.storagePath);
    throwIfCancelled(job);
    // 视觉识别是付费外部请求：标记后崩溃恢复一律按“结果未知”显式失败，不会重新执行已计费的调用。
    await updateJob(job, { providerTaskId: EXTERNAL_REQUEST_STARTED });
    const elements = await planLayerElements({
      model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking, supportsStructuredOutput: model.supportsStructuredOutput }),
      apiKey: secrets.decrypt(provider.encryptedApiKey),
      image
    });
    throwIfCancelled(job);
    // 元素 id 在方案内稳定（el-N）；前端勾选后原样回传，manual 元素由前端自带 id。
    const records = elements.map((element, index) => ({ id: `el-${index + 1}`, name: element.name, promptEn: element.promptEn, source: "auto" as const, bbox: null }));
    const updated = repository.updateLayerPlan(plan.id, { status: "SUCCEEDED", elements: records, error: null });
    if (updated) await events.publish(job.projectId, "layer-plan.updated", { plan: updated });
  } catch (error) {
    // 失败/取消必须同步到方案记录：REST 是状态真相，SSE 只负责通知前端失效重查。
    if (error instanceof JobCancelled) {
      const cancelled = repository.updateLayerPlan(plan.id, { status: "CANCELLED", error: null });
      if (cancelled) await events.publish(job.projectId, "layer-plan.updated", { plan: cancelled });
    } else {
      const updated = repository.updateLayerPlan(plan.id, { status: "FAILED", error: { message: error instanceof Error ? error.message : String(error) } });
      if (updated) await events.publish(job.projectId, "layer-plan.updated", { plan: updated });
    }
    throw error;
  }
  await updateJob(job, { progress: 90 });
}

async function executeLayerExport(job: JobRecord): Promise<void> {
  const record = layerExportFor(job);
  const project = projectFor(job);
  try {
    const output = repository.getOutput(record.outputId);
    if (!output || output.projectId !== project.id) throw new Error("Layer export source output is missing or belongs to another project");
    // planId 为空表示画框/提示词直接分层（无识别方案，不回写实测包围盒）；有 planId 时方案必须已成功。
    const plan = record.planId ? repository.getLayerPlan(record.planId) : undefined;
    if (record.planId && (!plan || plan.status !== "SUCCEEDED")) throw new Error("Layer plan is missing or has not succeeded");
    // 排队时 API 已把分割 Provider/模型/协议写入 input 并计入指纹；执行只认这份快照，
    // 排队后修改项目分割模型或 Provider 的协议声明都不影响本次执行。
    const segmentationProviderId = typeof job.input.segmentationProviderId === "string" ? job.input.segmentationProviderId : "";
    const segmentationModelId = typeof job.input.segmentationModelId === "string" ? job.input.segmentationModelId : "";
    if (!isSegmentationProtocol(job.input.segmentationProtocol)) throw new Error("Layer export job is missing its segmentation snapshot");
    const protocol = job.input.segmentationProtocol;
    if (!segmentationProviderId || !segmentationModelId) throw new Error("Layer export job is missing its segmentation snapshot");
    const provider = providerFor(segmentationProviderId);
    const elements = layerExportElementsFor(job);
    await updateJob(job, { progress: 10 });
    // 执行前先落 RUNNING：否则前端在整段分割过程中都只能看到 QUEUED。
    const running = repository.updateLayerExport(record.id, { status: "RUNNING", error: null });
    if (running) await events.publish(project.id, "layer-export.updated", { layerExport: running });
    const original = await storage.read(output.storagePath);
    const meta = await sharp(original).metadata();
    if (!meta.width || !meta.height) throw new Error("Source image dimensions are unavailable");
    const width = meta.width; const height = meta.height;
    // fal 接受公网 URL 或 data URI；本地产物没有公网地址，直接内联原图。
    const imageUrl = `data:${mimeForStoragePath(output.storagePath)};base64,${original.toString("base64")}`;
    // protocol 是项目配置里的显式字段；grounded_sam 面向国内自部署服务，fal 面向 fal.ai SAM 3，seedream 面向火山方舟图层拆分。
    const apiKey = secrets.decrypt(provider.encryptedApiKey);
    // 两条路径统一产出 {name, mask}：mask 只是选区，元素图层像素一律取自原图（PIXEL_PROTECTED）。
    const cutoutTargets: Array<{ name: string; mask: Buffer }> = [];
    const measuredBboxes = new Map<string, { x: number; y: number; width: number; height: number } | null>();
    // 标记“已发出外部计费请求”：此后标记不再被替换或中途清空，直到终态一次性清掉；
    // 进程在任意时点崩溃时，恢复层据此把任务判为结果未知并显式失败，而不是重新执行已计费的请求。
    await updateJob(job, { providerTaskId: EXTERNAL_REQUEST_STARTED });
    // seedream 返回的补绘底图保持 RGBA，避免“编码 PNG 再解码”这一轮无用往返。
    let inpaintedBackground: Buffer | undefined;
    if (protocol === "seedream_layerize") {
      // 一次调用拆分全部元素：手动框选换算为 0-1000 bbox 标签，自动元素用语义名称。
      const layerizer = new SeedreamLayerizeProvider({ baseUrl: provider.baseUrl, apiKey }, { modelId: segmentationModelId });
      const result = await layerizer.layerize({ imageUrl, prompt: seedreamLayerizePrompt(elements), quality: "auto" });
      throwIfCancelled(job);
      if (result.base) inpaintedBackground = await decodeRgba(result.base.data, width, height);
      for (const layer of result.layers) {
        throwIfCancelled(job);
        const mask = await seedreamLayerMask(layer.png, layer.bbox, width, height);
        // 空白图层是模型漏拆，不能静默跳过后当成成功：明确失败让用户调整描述或画框。
        if (!maskHasForeground(mask)) throw new Error(`Seedream 图层「${layer.name ?? layer.zIndex}」没有有效前景，请调整元素描述或画框后重试`);
        const matched = seedreamMatches(elements, layer);
        if (matched) measuredBboxes.set(matched.id, layer.bbox);
        cutoutTargets.push({ name: matched?.name ?? layer.name ?? `图层 ${layer.zIndex}`, mask });
        await updateJob(job, { progress: 10 + Math.round((cutoutTargets.length / Math.max(1, result.layers.length)) * 50) });
      }
      if (cutoutTargets.length === 0) throw new Error("Seedream 未拆分出任何有效图层，请调整元素描述或画框后重试");
    } else {
      // protocol 是项目配置里的显式字段：文本提示分割协议的差异由适配器各自消化，
      // 业务层只按注册表能力决定是否携带框提示（LSP：SegmentationProviderLike 统一 segment/probe）。
      const segmenter = createSegmentationProvider(protocol, { baseUrl: provider.baseUrl, apiKey });
      // 分割模型 id 允许直接写完整 fal 路径（含 "/"），否则使用适配器默认 fal-ai/sam-3/image。
      const modelPath = protocol === "fal" && segmentationModelId.includes("/") ? segmentationModelId : undefined;
      const supportsBoxPrompts = SEGMENTATION_PROTOCOL_CAPABILITIES[protocol].supportsBoxPrompts;
      for (const [index, element] of elements.entries()) {
        throwIfCancelled(job);
        // 框提示是否可用是协议能力（contracts 注册表声明），不是业务特判；
        // 不支持的协议直接不传框，手动框选元素应改用支持框提示的协议。
        const box = supportsBoxPrompts && element.bbox ? {
          xMin: Math.round(element.bbox.x * width), yMin: Math.round(element.bbox.y * height),
          xMax: Math.round((element.bbox.x + element.bbox.width) * width), yMax: Math.round((element.bbox.y + element.bbox.height) * height)
        } : undefined;
        // 文本提示优先用识别产出的英文 promptEn（部分分割渠道只接受英文），没有则退回元素名；
        // 手动框选直接用画框坐标，不传文本提示。
        const textPrompt = element.source === "manual" ? undefined : element.promptEn?.trim() || element.name;
        const result = await segmenter.segment({ imageUrl, textPrompt, box, modelPath });
        throwIfCancelled(job);
        measuredBboxes.set(element.id, result.bbox);
        const mask = await normalizeMask(result.mask, width, height);
        if (!maskHasForeground(mask)) throw new Error(`SAM 未在「${element.name}」中分割出前景，请调整元素名称或画框后重试`);
        cutoutTargets.push({ name: element.name, mask });
        await updateJob(job, { progress: 10 + Math.round(((index + 1) / elements.length) * 50) });
      }
    }
    throwIfCancelled(job);
    // 把 SAM 实测包围盒回写方案：前端 chips 悬停即可按真实分割区域高亮，而不只是手动画框。
    if (plan) {
      const refreshedElements = plan.elements.map((planElement) => ({ ...planElement, bbox: measuredBboxes.get(planElement.id) ?? planElement.bbox }));
      if (JSON.stringify(refreshedElements) !== JSON.stringify(plan.elements)) {
        const refreshed = repository.updateLayerPlan(plan.id, { elements: refreshedElements });
        if (refreshed) await events.publish(project.id, "layer-plan.updated", { plan: refreshed });
      }
    }
    // mask 只是选区：元素图层像素原样取自原图，不做任何生成，保持 PIXEL_PROTECTED 语义。
    // 原图 RGBA 只解码一次；每层全幅 RGBA 在 PNG 落盘、合成与 PSD 裁剪后即被释放，只保留裁剪副本。
    const originalRgba = await decodeRgba(original, width, height);
    const layerFiles: LayerExportLayerFileRecord[] = [];
    // PSD 组装用累积器：背景先入 children（children[0] 是最底层），元素逐层叠加到同一份合成预览上。
    const psd = createPsdLayerAccumulator(width, height);
    if (record.includeBackground) {
      // 挖空背景语义：原图 alpha ×(1-元素选区并集)，保留原图透明度；软边处元素与背景 alpha 之和略小于 1，
      // 叠加后边缘会轻微变透明，这是“可移动元素”与“逐像素还原原图”不可兼得时的取舍，合成预览如实呈现。
      const backgroundRgba = inpaintedBackground
        ? multiplyAlpha(inpaintedBackground, extractAlpha(originalRgba))
        : multiplyAlpha(originalRgba, invertMask(unionOfMasks(cutoutTargets.map((target) => target.mask), width, height)));
      const stored = await storage.putLayerArtifact(project.id, record.id, "00_背景", await pngFromRgba(backgroundRgba, width, height));
      layerFiles.push({ name: "00_背景.png", kind: "background", storagePath: stored.path, hash: stored.hash });
      psd.append({ name: "背景", rgba: backgroundRgba });
    }
    for (const [index, target] of cutoutTargets.entries()) {
      // 元素选区透明：元素 alpha = 原图 alpha × 选区，保留原图透明度与软边。
      const cutoutRgba = multiplyAlpha(originalRgba, target.mask);
      const label = `${String(index + 1).padStart(2, "0")}_${safeName(target.name)}`;
      const stored = await storage.putLayerArtifact(project.id, record.id, label, await pngFromRgba(cutoutRgba, width, height));
      layerFiles.push({ name: `${label}.png`, kind: "element", storagePath: stored.path, hash: stored.hash });
      psd.append({ name: `${String(index + 1).padStart(2, "0")} ${target.name}`, rgba: cutoutRgba });
    }
    await updateJob(job, { progress: 85 });
    const psdStored = await storage.putLayerArtifact(project.id, record.id, "图层", writePsdBuffer({ width, height, children: psd.children, imageData: { width, height, data: new Uint8ClampedArray(psd.composite) } }), ".psd");
    layerFiles.push({ name: "图层.psd", kind: "composite", storagePath: psdStored.path, hash: psdStored.hash });
    const updated = repository.updateLayerExport(record.id, { status: "SUCCEEDED", psdStoragePath: psdStored.path, layerFiles, error: null });
    if (updated) await events.publish(project.id, "layer-export.updated", { layerExport: updated });
    await updateJob(job, { progress: 95 });
  } catch (error) {
    // EXTERNAL_REQUEST_STARTED 标记保持到终态：付费请求之后的任何时点崩溃，恢复层都会判“结果未知”并显式失败，
    // 不会重跑已计费的分割调用；标记由终态更新一次性清空，不在执行中途改写。
    if (error instanceof JobCancelled) {
      const cancelled = repository.updateLayerExport(record.id, { status: "CANCELLED", error: null });
      if (cancelled) await events.publish(project.id, "layer-export.updated", { layerExport: cancelled });
    } else {
      // 分割已产生外部计费，任何失败都必须显式落到记录上，不允许静默重试掩盖。
      const failed = repository.updateLayerExport(record.id, { status: "FAILED", error: { message: error instanceof Error ? error.message : String(error) } });
      if (failed) await events.publish(project.id, "layer-export.updated", { layerExport: failed });
    }
    throw error;
  }
}

/** Seedream 一次调用拆分全部元素：手动框选换算为 0-1000 归一化 bbox 标签，识别与提示词元素用语义名称。 */
function seedreamLayerizePrompt(elements: Array<{ id: string; name: string; source: "auto" | "manual" | "prompt"; bbox: { x: number; y: number; width: number; height: number } | null }>): string {
  return elements.map((element) => {
    if (element.source !== "manual" || !element.bbox) return element.name;
    const x1 = Math.round(element.bbox.x * 1000);
    const y1 = Math.round(element.bbox.y * 1000);
    const x2 = Math.round((element.bbox.x + element.bbox.width) * 1000);
    const y2 = Math.round((element.bbox.y + element.bbox.height) * 1000);
    return `${element.name}<bbox>${x1} ${y1} ${x2} ${y2}</bbox>`;
  }).join("、");
}

/** Seedream 图层 alpha 只作选区回贴：图层与原图同尺寸直接取 alpha，局部图按 bbox 贴回全幅画布。 */
async function seedreamLayerMask(layerPng: Buffer, bbox: { x: number; y: number; width: number; height: number } | null, width: number, height: number): Promise<Buffer> {
  const meta = await sharp(layerPng).metadata();
  if (!meta.width || !meta.height) throw new Error("Seedream layer image dimensions are unavailable");
  if (meta.width === width && meta.height === height) return sharp(layerPng).ensureAlpha().extractChannel(3).raw().toBuffer();
  const box = bbox ?? { x: 0, y: 0, width: 1, height: 1 };
  const bx = Math.max(0, Math.min(width - 1, Math.round(box.x * width)));
  const by = Math.max(0, Math.min(height - 1, Math.round(box.y * height)));
  const bw = Math.max(1, Math.min(width - bx, Math.round(box.width * width)));
  const bh = Math.max(1, Math.min(height - by, Math.round(box.height * height)));
  const region = await sharp(layerPng).ensureAlpha().extractChannel(3).resize(bw, bh, { fit: "fill" }).raw().toBuffer();
  const canvas = Buffer.alloc(width * height, 0);
  for (let row = 0; row < bh; row += 1) region.copy(canvas, (by + row) * width + bx, row * bw, (row + 1) * bw);
  return canvas;
}

/** 图层与请求元素对齐：manual 按归一化 bbox 重叠（IoU），其余按名称互含；未匹配时保留模型标签。 */
function seedreamMatches(elements: Array<{ id: string; name: string; source: "auto" | "manual" | "prompt"; bbox: { x: number; y: number; width: number; height: number } | null }>, layer: { name: string | null; bbox: { x: number; y: number; width: number; height: number } | null }) {
  for (const element of elements) {
    if (element.source === "manual" && element.bbox && layer.bbox && normalizedIou(element.bbox, layer.bbox) >= 0.4) return element;
  }
  if (layer.name) {
    for (const element of elements) {
      if (element.source === "auto" && (layer.name.includes(element.name) || element.name.includes(layer.name))) return element;
    }
  }
  return null;
}

function normalizedIou(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const x1 = Math.max(a.x, b.x); const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width); const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

function projectFor(job: JobRecord): ProjectRecord { const project = repository.getProject(job.projectId); if (!project) throw new Error(`Project not found for job ${job.id}`); return project; }
// 引用为 null 表示 Provider 被删除后项目尚未重新选择模型；入口虽已拦截，这里兜底给出可读错误
function providerFor(id: string | null) {
  if (!id) throw new Error("该项目尚未选择 Provider（可能已被删除），请在项目设置中重新选择");
  const provider = repository.getProvider(id);
  if (!provider) throw new Error(`Configured provider not found: ${id}`);
  return provider;
}
/** 一个 Job 的每个候选使用独立稳定键，重试不会再次落库或写出另一份文件。 */
function generationKeyFor(jobId: string, candidateIndex: number): string { return `ecomgen:generation:${jobId}:candidate:${candidateIndex}`; }
interface EditGenerationConfig { reasoningProviderId: string; reasoningModelId: string; imageProviderId: string; imageModelId: string; imageResolution: ImageResolution; candidateCount: number; }
function editGenerationConfigFor(project: ProjectRecord, turn: EditTurnRecord): EditGenerationConfig {
  // 编辑链路允许注解覆盖模型，但 fallback 始终依赖项目引用；引用为空时直接失败而不是产出 null 配置
  if (!project.reasoningProviderId || !project.reasoningModelId || !project.imageProviderId || !project.imageModelId) {
    throw new Error("该项目尚未选择推理与图片模型（Provider 可能已被删除），请在项目设置中重新选择");
  }
  const defaults = { reasoningProviderId: project.reasoningProviderId, reasoningModelId: project.reasoningModelId, imageProviderId: project.imageProviderId, imageModelId: project.imageModelId, imageResolution: project.imageResolution, candidateCount: Math.min(4, Math.max(1, Math.round(project.candidatesPerType))) };
  const raw = (turn.annotations as Record<string, unknown>).generationConfig;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const config = raw as Record<string, unknown>;
  const readId = (key: keyof Pick<EditGenerationConfig, "reasoningProviderId" | "reasoningModelId" | "imageProviderId" | "imageModelId">) => typeof config[key] === "string" && config[key] ? config[key] as string : defaults[key];
  const resolution = config.imageResolution === "1K" || config.imageResolution === "2K" || config.imageResolution === "4K" ? config.imageResolution : defaults.imageResolution;
  const candidateCount = typeof config.candidateCount === "number" && Number.isFinite(config.candidateCount) ? Math.min(4, Math.max(1, Math.round(config.candidateCount))) : defaults.candidateCount;
  return { reasoningProviderId: readId("reasoningProviderId"), reasoningModelId: readId("reasoningModelId"), imageProviderId: readId("imageProviderId"), imageModelId: readId("imageModelId"), imageResolution: resolution, candidateCount };
}
function effectiveEditMemory(session: { memorySummary: { summary?: string; constraints?: string[]; scopes?: Record<string, { summary?: string; constraints?: string[] }> } }, outputId: string): { summary?: string; constraints?: string[] } {
  let current = repository.getOutput(outputId);
  while (current) {
    const scoped = session.memorySummary.scopes?.[current.id];
    if (scoped) return scoped;
    current = current.parentOutputId ? repository.getOutput(current.parentOutputId) : undefined;
  }
  const output = repository.getOutput(outputId);
  return output && !output.parentOutputId ? { summary: session.memorySummary.summary, constraints: session.memorySummary.constraints } : {};
}
// 推理模型只做视觉理解，各 Provider 内部也会把图缩到有限分辨率再切 token；
// 上传原图只增加传输体积，且 Pi Agent 多轮工具调用会把全部历史大图成倍重发。
// 生图与像素保护仍读取原始文件，不受此压缩影响。
const VISION_MAX_EDGE = 1024;
const VISION_JPEG_QUALITY = 80;
const VISION_PASSTHROUGH_BYTES = 512 * 1024;

async function compressForVision(buffer: Buffer): Promise<{ data: Buffer; mimeType: string }> {
  const meta = await sharp(buffer).metadata();
  const withinBounds = (meta.width ?? 0) <= VISION_MAX_EDGE && (meta.height ?? 0) <= VISION_MAX_EDGE;
  if (withinBounds && buffer.byteLength <= VISION_PASSTHROUGH_BYTES) {
    const mimeType = meta.format === "png" ? "image/png" : meta.format === "webp" ? "image/webp" : "image/jpeg";
    return { data: buffer, mimeType };
  }
  return { data: await sharp(buffer).resize(VISION_MAX_EDGE, VISION_MAX_EDGE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: VISION_JPEG_QUALITY }).toBuffer(), mimeType: "image/jpeg" };
}

async function visionImageContents(assets: AssetRecord[]): Promise<Array<{ type: "image"; mimeType: string; data: string }>> {
  return Promise.all(assets.map(async (asset) => {
    const original = await storage.read(asset.storagePath);
    const compressed = await cachedCompressForVision(original, asset.hash);
    return { type: "image" as const, mimeType: compressed.mimeType, data: compressed.data.toString("base64") };
  }));
}

async function visionSourceImage(storagePath: string): Promise<{ type: "image"; mimeType: string; data: string }> {
  const original = await storage.read(storagePath);
  const compressed = await cachedCompressForVision(original);
  return { type: "image", mimeType: compressed.mimeType, data: compressed.data.toString("base64") };
}

async function cachedCompressForVision(buffer: Buffer, sourceHash?: string): Promise<{ data: Buffer; mimeType: string }> {
  const hash = sourceHash ?? createHash("sha256").update(buffer).digest("hex");
  const metadata = await sharp(buffer).metadata();
  const passthroughMime = metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : "image/jpeg";
  const withinBounds = (metadata.width ?? 0) <= VISION_MAX_EDGE && (metadata.height ?? 0) <= VISION_MAX_EDGE;
  const outputMimeType = withinBounds && buffer.byteLength <= VISION_PASSTHROUGH_BYTES ? passthroughMime : "image/jpeg";
  return visionCache.getOrCreate({ sourceHash: hash, maxEdge: VISION_MAX_EDGE, jpegQuality: VISION_JPEG_QUALITY, mimeType: outputMimeType }, async () => compressForVision(buffer));
}
async function reviseGenerationPrompt(project: ProjectRecord, prompt: string, revision: string): Promise<string> {
  const provider = providerFor(project.reasoningProviderId);
  const model = provider.models.find((candidate) => candidate.id === project.reasoningModelId);
  if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
  return reviseImagePrompt({
    model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking, supportsStructuredOutput: model.supportsStructuredOutput }),
    apiKey: secrets.decrypt(provider.encryptedApiKey),
    prompt,
    revision
  });
}
async function updateJob(job: JobRecord, patch: Parameters<EcomRepository["updateJob"]>[1]): Promise<void> { const updated = repository.updateJob(job.id, patch); if (updated) await events.publish(job.projectId, "job.updated", updated); }
function queueKindForJobType(type: JobType): EcomJobKind {
  if (type === "PLAN") return "plan";
  if (type === "COPYWRITE") return "copywrite";
  if (type === "GENERATE") return "generate";
  if (type === "EDIT_PLAN") return "edit_plan";
  if (type === "EDIT_GENERATE") return "edit_generate";
  if (type === "LAYER_PLAN") return "layer_plan";
  if (type === "LAYER_EXPORT") return "layer_export";
  return "export";
}
function editTurnFor(job: JobRecord): EditTurnRecord { const turnId = typeof job.input.editTurnId === "string" ? job.input.editTurnId : ""; const turn = repository.getEditTurn(turnId); if (!turn || turn.projectId !== job.projectId) throw new Error("Edit turn is missing or belongs to another project"); return turn; }
function layerPlanFor(job: JobRecord): LayerPlanRecord { const plan = repository.getLayerPlanByJobId(job.id); if (!plan || plan.projectId !== job.projectId) throw new Error("Layer plan is missing or belongs to another project"); return plan; }
function layerExportFor(job: JobRecord): LayerExportRecord { const record = repository.getLayerExportByJobId(job.id); if (!record || record.projectId !== job.projectId) throw new Error("Layer export is missing or belongs to another project"); return record; }
interface LayerExportElementInput { id: string; name: string; promptEn?: string; source: "auto" | "manual" | "prompt"; bbox: { x: number; y: number; width: number; height: number } | null; }
// 导入元素来自 job.input（API 已用契约校验）；这里做最小防御性解析，manual 无 bbox 直接失败。
function layerExportElementsFor(job: JobRecord): LayerExportElementInput[] {
  const raw = Array.isArray(job.input.elements) ? job.input.elements : [];
  const elements = raw.flatMap((entry): LayerExportElementInput[] => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    if (typeof value.id !== "string" || typeof value.name !== "string" || (value.source !== "auto" && value.source !== "manual" && value.source !== "prompt")) return [];
    const promptEn = typeof value.promptEn === "string" && value.promptEn.trim().length > 0 ? value.promptEn : undefined;
    const bboxRaw = value.bbox as Record<string, unknown> | null | undefined;
    const bbox = bboxRaw && typeof bboxRaw.x === "number" && typeof bboxRaw.y === "number" && typeof bboxRaw.width === "number" && typeof bboxRaw.height === "number"
      ? { x: bboxRaw.x, y: bboxRaw.y, width: bboxRaw.width, height: bboxRaw.height }
      : null;
    if (value.source === "manual" && !bbox) throw new Error(`手动元素「${value.name}」缺少画框坐标`);
    return [{ id: value.id, name: value.name, promptEn, source: value.source, bbox }];
  });
  if (elements.length === 0) throw new Error("Layer export has no elements");
  return elements;
}
/**
 * SAM 返回的 mask 可能是编码图片（fal PNG）或裸 8-bit 灰度（Gitee RLE 解码，自带尺寸）：
 * 统一缩放到原图尺寸的灰度选区（亮度=前景）。
 */
async function normalizeMask(mask: { data: Buffer; mimeType: string; width: number | null; height: number | null }, width: number, height: number): Promise<Buffer> {
  const rawWidth = mask.width ?? width;
  const rawHeight = mask.height ?? height;
  const image = mask.mimeType === "raw/gray8" ? sharp(mask.data, { raw: { width: rawWidth, height: rawHeight, channels: 1 } }) : sharp(mask.data);
  return image.greyscale().removeAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer();
}
function maskHasForeground(mask: Buffer): boolean { return mask.some((value) => value > 8); }
// joinChannel 对 Buffer 输入在部分平台触发 libpng 读错误；直接改写 raw RGBA 的 alpha 字节更稳。
async function decodeRgba(image: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(image).ensureAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer();
}
async function pngFromRgba(rgba: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
function mimeForStoragePath(path: string): string { if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"; if (path.endsWith(".webp")) return "image/webp"; return "image/png"; }
function canvasExpansionFor(turn: EditTurnRecord): { top: number; right: number; bottom: number; left: number } | null {
  const value = (turn.annotations as Record<string, unknown>).canvasExpansion;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const expansion = value as Record<string, unknown>;
  const read = (edge: "top" | "right" | "bottom" | "left") => typeof expansion[edge] === "number" && Number.isFinite(expansion[edge]) ? Math.max(0, Math.round(expansion[edge])) : 0;
  const result = { top: read("top"), right: read("right"), bottom: read("bottom"), left: read("left") };
  return result.top || result.right || result.bottom || result.left ? result : null;
}
function assertEditCapabilities(capabilities: { supportsMaskEdit: boolean; supportsUnmaskedEdit: boolean; supportsMultiReference: boolean; supportsOutpaint: boolean; supportsNaturalBlend: boolean }, operation: EditOperation, executionMode: EditExecutionMode, hasMask: boolean, referenceCount: number): void {
  if ((executionMode === "MASKED" || hasMask) && !capabilities.supportsMaskEdit) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持遮罩编辑");
  if (executionMode === "MODEL_DIRECTED" && !capabilities.supportsUnmaskedEdit) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持无蒙版编辑");
  if (referenceCount > 1 && !capabilities.supportsMultiReference) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持多参考图编辑");
  if (operation === "OUTPAINT" && !capabilities.supportsOutpaint) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持扩展画布");
  if (executionMode !== "MODEL_DIRECTED" && ["SCENE_ADJUST", "NATURAL_FUSION"].includes(operation) && !capabilities.supportsNaturalBlend) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持自然融合编辑");
}
async function createOutpaintCanvas(source: Buffer, expansion: { top: number; right: number; bottom: number; left: number }): Promise<{ image: Buffer; mask: Buffer; width: number; height: number; left: number; top: number }> {
  const meta = await sharp(source).metadata(); if (!meta.width || !meta.height) throw new Error("Source image dimensions are unavailable");
  const width = meta.width + expansion.left + expansion.right; const height = meta.height + expansion.top + expansion.bottom;
  const original = await sharp(source).ensureAlpha().png().toBuffer();
  const image = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: original, left: expansion.left, top: expansion.top }]).png().toBuffer();
  const protectedOriginal = await sharp({ create: { width: meta.width, height: meta.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const mask = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: protectedOriginal, left: expansion.left, top: expansion.top }]).png().toBuffer();
  return { image, mask, width, height, left: expansion.left, top: expansion.top };
}
async function assertMaskDimensions(source: Buffer, mask: Buffer): Promise<void> { const [sourceMeta, maskMeta] = await Promise.all([sharp(source).metadata(), sharp(mask).metadata()]); if (!sourceMeta.width || !sourceMeta.height || sourceMeta.width !== maskMeta.width || sourceMeta.height !== maskMeta.height) throw new Error("MASK_DIMENSION_MISMATCH"); }
async function compositeMaskedEdit(source: Buffer, generated: Buffer, editMask: Buffer, protectMask?: Buffer): Promise<Buffer> {
  const sourceMeta = await sharp(source).metadata(); if (!sourceMeta.width || !sourceMeta.height) throw new Error("Source image dimensions are unavailable");
  let mask = sharp(editMask).greyscale().removeAlpha().resize(sourceMeta.width, sourceMeta.height, { fit: "fill" });
  if (protectMask) {
    const [editPixels, protectPixels] = await Promise.all([mask.raw().toBuffer(), sharp(protectMask).greyscale().removeAlpha().resize(sourceMeta.width, sourceMeta.height, { fit: "fill" }).raw().toBuffer()]);
    for (let index = 0; index < editPixels.length; index += 1) editPixels[index] = Math.max(0, editPixels[index]! - protectPixels[index]!);
    mask = sharp(editPixels, { raw: { width: sourceMeta.width, height: sourceMeta.height, channels: 1 } });
  }
  const alphaMask = await mask.png().toBuffer();
  const resized = await sharp(generated).resize(sourceMeta.width, sourceMeta.height, { fit: "fill" }).png().toBuffer();
  const foreground = await sharp(resized).removeAlpha().joinChannel(alphaMask).png().toBuffer();
  return sharp(source).resize(sourceMeta.width, sourceMeta.height, { fit: "fill" }).composite([{ input: foreground }]).png().toBuffer();
}
async function compositeNaturalBlend(source: Buffer, generated: Buffer, editMask?: Buffer, protectMask?: Buffer): Promise<Buffer> {
  const meta = await sharp(source).metadata(); if (!meta.width || !meta.height) throw new Error("Source image dimensions are unavailable");
  let pixels = editMask
    ? await sharp(editMask).greyscale().removeAlpha().resize(meta.width, meta.height, { fit: "fill" }).raw().toBuffer()
    : Buffer.alloc(meta.width * meta.height, 255);
  if (protectMask) {
    const protect = await sharp(protectMask).greyscale().removeAlpha().resize(meta.width, meta.height, { fit: "fill" }).raw().toBuffer();
    pixels = Buffer.from(pixels);
    for (let index = 0; index < pixels.length; index += 1) pixels[index] = Math.max(0, pixels[index]! - protect[index]!);
  }
  const radius = Math.min(48, Math.max(4, Math.round(Math.min(meta.width, meta.height) * 0.01)));
  const alphaMask = await sharp(pixels, { raw: { width: meta.width, height: meta.height, channels: 1 } }).blur(radius).png().toBuffer();
  const resized = await sharp(generated).resize(meta.width, meta.height, { fit: "fill" }).removeAlpha().joinChannel(alphaMask).png().toBuffer();
  return sharp(source).resize(meta.width, meta.height, { fit: "fill" }).composite([{ input: resized }]).png().toBuffer();
}
async function compositeOutpaint(source: Buffer, generated: Buffer, canvas: { width: number; height: number; left: number; top: number }): Promise<Buffer> {
  return sharp(generated).resize(canvas.width, canvas.height, { fit: "fill" }).composite([{ input: await sharp(source).png().toBuffer(), left: canvas.left, top: canvas.top }]).png().toBuffer();
}
async function providerMaskFor(source: Buffer, editMask: Buffer, protectMask?: Buffer): Promise<Buffer> {
  const meta = await sharp(source).metadata(); if (!meta.width || !meta.height) throw new Error("Source image dimensions are unavailable");
  const edit = await sharp(editMask).greyscale().removeAlpha().resize(meta.width, meta.height, { fit: "fill" }).raw().toBuffer();
  const protect = protectMask ? await sharp(protectMask).greyscale().removeAlpha().resize(meta.width, meta.height, { fit: "fill" }).raw().toBuffer() : undefined;
  const rgba = Buffer.alloc(edit.length * 4);
  for (let index = 0; index < edit.length; index += 1) {
    const editable = Math.max(0, edit[index]! - (protect?.[index] ?? 0));
    const target = index * 4; rgba[target] = 0; rgba[target + 1] = 0; rgba[target + 2] = 0; rgba[target + 3] = 255 - editable;
  }
  return sharp(rgba, { raw: { width: meta.width, height: meta.height, channels: 4 } }).png().toBuffer();
}
class JobCancelled extends Error { }
function throwIfCancelled(job: JobRecord): void { const current = repository.getJob(job.id); if (current?.cancelRequested || current?.status === "CANCELLED") throw new JobCancelled(`Job ${job.id} was cancelled`); }
function extensionForMime(mimeType: string): string { return mimeType.includes("webp") ? ".webp" : mimeType.includes("jpeg") ? ".jpg" : ".png"; }
function exportFileName(project: ProjectRecord, output: { storyboardItemId: string; storagePath: string }, index: number): string { const item = repository.getStoryboardItem(output.storyboardItemId); const extension = output.storagePath.slice(output.storagePath.lastIndexOf(".")); return `${safeName(project.name)}_${String(index + 1).padStart(2, "0")}_${safeName(item?.assetType ?? "image")}${extension}`; }
function safeName(value: string): string { return value.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "ecomgen"; }
async function createZip(files: Array<{ name: string; content: Buffer }>): Promise<Buffer> { return new Promise((resolve, reject) => { const output = new PassThrough(); const chunks: Buffer[] = []; output.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk))); output.on("end", () => resolve(Buffer.concat(chunks))); output.on("error", reject); const zip = archiver("zip", { zlib: { level: 9 } }); zip.on("error", reject); zip.pipe(output); files.forEach((file) => zip.append(file.content, { name: file.name })); void zip.finalize(); }); }
