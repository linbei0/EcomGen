import { PassThrough } from "node:stream";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import archiver from "archiver";
import sharp from "sharp";
import { planImageEdit, planStoryboard, reviseImagePrompt, writeCopywriting } from "@ecomgen/agent";
import { EcomRepository, LocalAssetStore, SecretBox, openDatabase, resolveDataDir, type AssetRecord, type EditTurnRecord, type JobRecord, type ProjectRecord } from "@ecomgen/core";
import { getTemplate } from "@ecomgen/ecom-skill";
import { resolveImageSize, userAssetKindForRole, type CopywritingTarget, type ImageAspectRatio, type ImageResolution, type JobType, type PlanningMode } from "@ecomgen/contracts";
import { createJobQueue, createRedisConnection, enqueue, type EcomJobKind, type EcomJobPayload, QUEUE_NAME, RedisProjectEventBus } from "@ecomgen/jobs";
import { OpenAiCompatibleImageProvider, ProviderError, buildReasoningModel } from "@ecomgen/providers";

const masterKey = process.env.ECOMGEN_MASTER_KEY;
if (!masterKey) throw new Error("ECOMGEN_MASTER_KEY must be a base64-encoded 32-byte key");
const projectRoot = resolve(import.meta.dirname, "../../..");
const dataDir = resolveDataDir(process.env.ECOMGEN_DATA_DIR, projectRoot);
const repository = new EcomRepository(openDatabase(resolve(dataDir, "ecomgen.sqlite")));
const storage = new LocalAssetStore(dataDir); await storage.initialize();
const secrets = new SecretBox(masterKey);
const redis = createRedisConnection(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const events = new RedisProjectEventBus(redis.duplicate(), redis.duplicate());
const recoveryRedis = redis.duplicate();
const recoveryQueue = createJobQueue(recoveryRedis);
const executionRedis = redis.duplicate();
const executionQueue = createJobQueue(executionRedis);
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
    else await executeExport(job);
    const current = repository.getJob(job.id); if (current?.cancelRequested || current?.status === "CANCELLED") { await updateJob(job, { status: "CANCELLED", progress: current.progress }); } else await updateJob(job, { status: "SUCCEEDED", progress: 100 });
  } catch (error) {
    if (error instanceof JobCancelled) { await updateJob(job, { status: "CANCELLED", cancelRequested: true }); return; }
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
async function stop(): Promise<void> { await worker.close(); await executionQueue.close(); await executionRedis.quit(); await events.close(); await redis.quit(); }
process.once("SIGINT", () => { void stop().then(() => process.exit(0)); });
process.once("SIGTERM", () => { void stop().then(() => process.exit(0)); });

async function executePlan(job: JobRecord): Promise<void> {
  throwIfCancelled(job);
  const project = projectFor(job); const provider = providerFor(project.reasoningProviderId); const model = provider.models.find((candidate) => candidate.id === project.reasoningModelId);
  if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
  await updateJob(job, { progress: 25 });
  const assets = repository.listAssets(project.id);
  const productImages = assets.filter((asset) => asset.role === "PRODUCT_TRUTH" && asset.mimeType.startsWith("image/")).slice(0, 4);
  const referenceImages = model.supportsVision ? await Promise.all(productImages.map(async (asset) => ({ type: "image" as const, mimeType: asset.mimeType, data: (await storage.read(asset.storagePath)).toString("base64") }))) : undefined;
  const input = job.input as { planningMode?: PlanningMode; requestedTypes?: string[]; userInstruction?: string; candidatesPerType?: number; targetImageCount?: number; imageResolution?: ImageResolution; imageAspectRatio?: ImageAspectRatio };
  if (input.imageResolution || input.imageAspectRatio || input.candidatesPerType) {
    repository.updateProject(project.id, {
      imageResolution: input.imageResolution ?? project.imageResolution,
      imageAspectRatio: input.imageAspectRatio ?? project.imageAspectRatio,
      candidatesPerType: input.candidatesPerType ?? project.candidatesPerType
    });
  }
  const plannerAssets = assets.map((asset) => ({ id: asset.id, role: asset.role, kind: userAssetKindForRole(asset.role), name: asset.originalName, mimeType: asset.mimeType }));
  const webResearch = project.webResearchEnabled ? configuredWebResearch() : undefined;
  repository.createWebResearchAudit(job.id, webResearch ? "AVAILABLE" : project.webResearchEnabled ? "UNAVAILABLE" : "DISABLED");
  const plan = await planStoryboard({
      model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking }),
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
      planningMode: input.planningMode ?? "AI",
      requestedTypes: input.requestedTypes,
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
  await updateJob(job, { progress: 90 }); await events.publish(project.id, "storyboard.updated", { storyboard, items: repository.listStoryboardItems(project.id) });
}

async function executeCopywriting(job: JobRecord): Promise<void> {
  throwIfCancelled(job);
  const project = projectFor(job);
  const provider = providerFor(project.reasoningProviderId);
  const model = provider.models.find((candidate) => candidate.id === project.reasoningModelId);
  if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
  if (!model.supportsVision) throw new Error("Selected reasoning model must support Vision for AI copywriting");
  const assets = repository.listAssets(project.id).filter((asset) => asset.mimeType.startsWith("image/"));
  if (!assets.some((asset) => asset.role === "PRODUCT_TRUTH")) throw new Error("AI copywriting requires at least one product image");
  const target = job.input.target;
  if (target !== "PRODUCT_DESCRIPTION" && target !== "PLANNING_INSTRUCTION") throw new Error("Copywriting job has an invalid target");
  await updateJob(job, { progress: 25 });
  const visualAttachments = await Promise.all(assets.map(async (asset) => ({
    type: "image" as const,
    mimeType: asset.mimeType,
    data: (await storage.read(asset.storagePath)).toString("base64"),
  })));
  const result = await writeCopywriting({
    target: target as CopywritingTarget,
    model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking }),
    apiKey: secrets.decrypt(provider.encryptedApiKey),
    projectName: project.name,
    productCategory: project.category,
    productDescription: project.productDescription,
    verifiedFacts: project.verifiedFacts,
    prohibitedClaims: project.prohibitedClaims,
    platformTargets: project.platformTargets,
    targetMarket: project.targetMarket,
    copyLanguage: project.copyLanguage,
    assets: assets.map((asset) => ({ id: asset.id, role: asset.role, name: asset.originalName, mimeType: asset.mimeType })),
    referenceImages: visualAttachments,
  });
  throwIfCancelled(job);
  repository.saveCopywritingResult({ jobId: job.id, projectId: project.id, target: result.target, content: result.content });
  await updateJob(job, { progress: 90 });
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
  const provider = providerFor(providerId); const model = provider.models.find((candidate) => candidate.id === modelId); if (!model) throw new Error("Configured image model no longer exists in its provider"); if (model.imageApiKind !== "openai_images") throw new Error("Only OpenAI-compatible Images API models are currently executable");
  const storyboard = repository.getStoryboard(project.id); if (!storyboard) throw new Error("Storyboard is missing"); const template = getTemplate(item.assetType); if (!template) throw new Error(`Storyboard item uses an unknown ecom-details-image template: ${item.assetType}`);
  const inputs = generationAssets(project, item.mode);
  if (item.mode === "PIXEL_PROTECTED" && inputs.length === 0) throw new Error("PIXEL_PROTECTED generation requires a PRODUCT_TRUTH image on the project");
  const revision = typeof job.input.revision === "string" ? job.input.revision.trim() : "";
  const candidateIndex = typeof job.input.candidateIndex === "number" ? job.input.candidateIndex : 1;
  const resolution = (typeof job.input.imageResolution === "string" ? job.input.imageResolution : item.imageResolution) as ImageResolution;
  const aspectRatio = (typeof job.input.imageAspectRatio === "string" ? job.input.imageAspectRatio : item.imageAspectRatio) as ImageAspectRatio;
  const size = resolveImageSize(resolution, aspectRatio, template.defaultSize);
  const basePrompt = item.promptInstruction.trim();
  if (!basePrompt) throw new Error("Storyboard item has no final image prompt; re-plan the storyboard before generating");
  if (/upstream template|template fields|anti-ai guidance|category guidance|promptcontract/i.test(basePrompt)) {
    throw new Error("This storyboard contains an old internal template prompt; re-plan the storyboard before generating");
  }
  const prompt = revision
    ? await reviseGenerationPrompt(project, basePrompt, revision)
    : basePrompt;
  repository.updateStoryboardItem(item.id, { status: "GENERATING", compiledPrompt: prompt }); await updateJob(job, { progress: 30 });
  const images = template.supports_image_reference ? await Promise.all(inputs.map(async (asset) => ({ data: await storage.read(asset.storagePath), filename: asset.originalName, mimeType: asset.mimeType }))) : [];
  const generator = new OpenAiCompatibleImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) }); const result = await generator.generate({ model: model.id, prompt, size, quality: "high", images: images.length ? images : undefined });
  throwIfCancelled(job);
  await updateJob(job, { progress: 80, providerTaskId: result.providerTaskId ?? null }); const stored = await storage.putOutput(project.id, result.image, extensionForMime(result.mimeType));
  throwIfCancelled(job);
  const output = repository.createOutput({
    projectId: project.id,
    storyboardItemId: item.id,
    jobId: job.id,
    candidateIndex,
    generationSnapshot: { providerId, modelId, resolution, aspectRatio, size, candidateIndex },
    storagePath: stored.path,
    hash: stored.hash,
    reviewDecision: "NEEDS_REVIEW",
    reviewNote: null
  });
  repository.updateStoryboardItem(item.id, { status: "GENERATED" }); await events.publish(project.id, "output.created", { output });
}

async function executeEditPlan(job: JobRecord): Promise<void> {
  const turn = editTurnFor(job);
  const project = projectFor(job);
  const provider = providerFor(project.reasoningProviderId);
  const model = provider.models.find((candidate) => candidate.id === project.reasoningModelId);
  if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
  await updateJob(job, { progress: 25 });
  const session = repository.getEditSession(turn.sessionId); if (!session) throw new Error("Edit session is missing");
  const assets = repository.listAssets(project.id);
  const references = assets.filter((asset) => turn.referenceAssetIds.includes(asset.id)).map((asset) => ({ id: asset.id, name: asset.originalName, role: asset.role }));
  const source = repository.getOutput(turn.baseOutputId); if (!source) throw new Error("Edit source output is missing");
  let plan;
  try {
    plan = await planImageEdit({
      model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking }),
      apiKey: secrets.decrypt(provider.encryptedApiKey),
      message: turn.message,
      annotations: turn.annotations,
      hasEditMask: Boolean(turn.editMaskPath),
      hasCanvasExpansion: Boolean((turn.annotations as Record<string, unknown>).canvasExpansion),
      referenceAssets: references,
      memorySummary: session.memorySummary,
      projectFacts: project.verifiedFacts,
      sourceImage: model.supportsVision ? { type: "image", mimeType: mimeForStoredPath(source.storagePath), data: (await storage.read(source.storagePath)).toString("base64") } : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (["REFERENCE_ASSET_REQUIRED", "EDIT_TARGET_REQUIRED", "OUTPAINT_CANVAS_REQUIRED"].includes(message)) {
      const updated = repository.updateEditTurn(turn.id, { status: "NEED_INPUT", error: { message } });
      if (updated) await events.publish(project.id, "edit-turn.updated", { turn: updated });
      await updateJob(job, { progress: 90 });
      return;
    }
    throw error;
  }
  throwIfCancelled(job);
  const status = plan.requiresConfirmation ? "AWAITING_CONFIRMATION" : "GENERATING";
  repository.updateEditTurn(turn.id, { status, plan: plan as unknown as Record<string, unknown>, error: null });
  await events.publish(project.id, "edit-turn.updated", { turn: repository.getEditTurn(turn.id) });
  if (!plan.requiresConfirmation) {
    const generation = repository.createJob({ id: randomUUID(), projectId: project.id, storyboardItemId: null, type: "EDIT_GENERATE", input: { editTurnId: turn.id }, requestFingerprint: null, providerId: project.imageProviderId, modelId: project.imageModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueue(executionQueue, { jobId: generation.id, kind: "edit_generate" });
  }
  await updateJob(job, { progress: 90 });
}

async function executeEditGeneration(job: JobRecord): Promise<void> {
  const turn = editTurnFor(job);
  const project = projectFor(job);
  const session = repository.getEditSession(turn.sessionId); if (!session) throw new Error("Edit session is missing");
  const source = repository.getOutput(turn.baseOutputId); if (!source || source.projectId !== project.id) throw new Error("Edit source output is missing or belongs to another project");
  const plan = turn.plan as { operation?: string; prompt?: string; compositePolicy?: "MASK_LOCKED" | "NATURAL_BLEND" | "OUTPAINT"; memoryPatch?: { summary?: string; constraints?: string[] } } | null;
  if (!plan?.operation || !plan.prompt || !plan.compositePolicy) throw new Error("Edit turn has no executable plan");
  const outpaintExpansion = plan.compositePolicy === "OUTPAINT" ? canvasExpansionFor(turn) : null;
  if (plan.compositePolicy === "OUTPAINT" && !outpaintExpansion) throw new Error("OUTPAINT_CANVAS_REQUIRED");
  if (plan.compositePolicy === "MASK_LOCKED" && !turn.editMaskPath) throw new Error("EDIT_TARGET_REQUIRED");
  const provider = providerFor(project.imageProviderId);
  const model = provider.models.find((candidate) => candidate.id === project.imageModelId);
  if (!model || model.imageApiKind !== "openai_images") throw new Error("CAPABILITY_UNSUPPORTED: selected image model cannot execute masked edits");
  await updateJob(job, { progress: 30 });
  const sourceImage = await storage.read(source.storagePath);
  const mask = turn.editMaskPath ? await storage.read(turn.editMaskPath) : undefined;
  if (mask) await assertMaskDimensions(sourceImage, mask);
  const generator = new OpenAiCompatibleImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) });
  const assets = repository.listAssets(project.id);
  const references = await Promise.all(assets.filter((asset) => turn.referenceAssetIds.includes(asset.id)).map(async (asset) => ({ data: await storage.read(asset.storagePath), filename: asset.originalName, mimeType: asset.mimeType })));
  const outpaintCanvas = outpaintExpansion ? await createOutpaintCanvas(sourceImage, outpaintExpansion) : null;
  const inputImage = outpaintCanvas?.image ?? sourceImage;
  const providerMask = outpaintCanvas?.mask ?? (mask ? await providerMaskFor(sourceImage, mask, turn.protectMaskPath ? await storage.read(turn.protectMaskPath) : undefined) : undefined);
  const result = await generator.generate({ model: model.id, prompt: plan.prompt, quality: "high", images: [{ data: inputImage, filename: "source.png", mimeType: "image/png" }, ...references], mask: providerMask ? { data: providerMask, filename: "edit-mask.png", mimeType: "image/png" } : undefined, inputFidelity: "high" });
  throwIfCancelled(job);
  await updateJob(job, { progress: 75, providerTaskId: result.providerTaskId ?? null });
  const protectedMask = turn.protectMaskPath ? await storage.read(turn.protectMaskPath) : undefined;
  const composed = plan.compositePolicy === "MASK_LOCKED" && mask ? await compositeMaskedEdit(sourceImage, result.image, mask, protectedMask) : outpaintCanvas ? await sharp(result.image).resize(outpaintCanvas.width, outpaintCanvas.height, { fit: "fill" }).png().toBuffer() : await sharp(result.image).png().toBuffer();
  const stored = await storage.putOutput(project.id, composed, ".png");
  const output = repository.createOutput({ projectId: project.id, storyboardItemId: source.storyboardItemId, jobId: job.id, candidateIndex: 1, generationSnapshot: { providerId: provider.id, modelId: model.id, resolution: project.imageResolution, aspectRatio: project.imageAspectRatio, size: "source", candidateIndex: 1, operation: plan.operation as "PRECISE_INPAINT" | "PRODUCT_REPLACE" | "SCENE_ADJUST" | "NATURAL_FUSION" | "OUTPAINT", sourceOutputId: source.id, maskHash: turn.editMaskHash, protectMaskHash: turn.protectMaskHash, compositePolicy: plan.compositePolicy }, storagePath: stored.path, hash: stored.hash, reviewDecision: "NEEDS_REVIEW", reviewNote: null, parentOutputId: source.id, rootOutputId: source.rootOutputId ?? source.id, editSessionId: session.id, editTurnId: turn.id });
  const updatedSession = repository.updateEditSession(session.id, { currentOutputId: output.id, memorySummary: { summary: plan.memoryPatch?.summary ?? session.memorySummary.summary, constraints: plan.memoryPatch?.constraints ?? session.memorySummary.constraints } });
  repository.updateEditTurn(turn.id, { status: "SUCCEEDED", error: null });
  if (updatedSession) await events.publish(project.id, "edit-session.updated", { session: updatedSession });
  await events.publish(project.id, "output.created", { output });
  await events.publish(project.id, "edit-turn.updated", { turn: repository.getEditTurn(turn.id) });
}

async function executeExport(job: JobRecord): Promise<void> {
  throwIfCancelled(job);
  const project = projectFor(job); const outputIds = Array.isArray(job.input.outputIds) ? job.input.outputIds.filter((value): value is string => typeof value === "string") : undefined;
  const outputs = repository.listOutputs(project.id).filter((output) => !outputIds || outputIds.includes(output.id)); if (outputs.length === 0) throw new Error("No outputs are available for export");
  const exportRecord = repository.getExportByJobId(job.id); await updateJob(job, { progress: 25 }); const imageFiles = await Promise.all(outputs.map(async (output, index) => ({ name: exportFileName(project, output, index), content: await storage.read(output.storagePath) })));
  // manifest 让导出包可追溯到事实、模板、Prompt、审核结果和输出内容 hash。
  const manifest = { version: 1, generatedAt: new Date().toISOString(), project: { id: project.id, name: project.name, platforms: project.platformTargets, category: project.category, imageResolution: project.imageResolution, imageAspectRatio: project.imageAspectRatio }, facts: { verified: project.verifiedFacts, prohibited: project.prohibitedClaims, brandGuidelines: project.brandGuidelines }, storyboard: outputs.map((output) => { const item = repository.getStoryboardItem(output.storyboardItemId); return { outputId: output.id, jobId: output.jobId, assetType: item?.assetType ?? null, displayName: item?.displayName ?? null, templateVariant: item?.templateVariant ?? null, mode: item?.mode ?? null, candidateIndex: output.candidateIndex, generationSnapshot: output.generationSnapshot, prompt: item?.compiledPrompt ?? null, reviewDecision: output.reviewDecision, sha256: output.hash }; }) };
  const archive = await createZip([...imageFiles, { name: "manifest.json", content: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") }]); const stored = await storage.putExport(project.id, archive);
  const target = exportRecord ?? repository.createExport({ projectId: project.id, jobId: job.id, status: "QUEUED", storagePath: null }); const updated = repository.updateExport(target.id, { status: "SUCCEEDED", storagePath: stored.path }); await events.publish(project.id, "export.updated", { export: updated });
}

function projectFor(job: JobRecord): ProjectRecord { const project = repository.getProject(job.projectId); if (!project) throw new Error(`Project not found for job ${job.id}`); return project; }
function providerFor(id: string) { const provider = repository.getProvider(id); if (!provider) throw new Error(`Configured provider not found: ${id}`); return provider; }
function generationAssets(project: ProjectRecord, mode: string): AssetRecord[] {
  const all = repository.listAssets(project.id).filter((asset) => asset.role === "PRODUCT_TRUTH" && asset.mimeType.startsWith("image/"));
  return mode === "PIXEL_PROTECTED" ? all : all.slice(0, 4);
}
async function reviseGenerationPrompt(project: ProjectRecord, prompt: string, revision: string): Promise<string> {
  const provider = providerFor(project.reasoningProviderId);
  const model = provider.models.find((candidate) => candidate.id === project.reasoningModelId);
  if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
  return reviseImagePrompt({
    model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking }),
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
  return "export";
}
function editTurnFor(job: JobRecord): EditTurnRecord { const turnId = typeof job.input.editTurnId === "string" ? job.input.editTurnId : ""; const turn = repository.getEditTurn(turnId); if (!turn || turn.projectId !== job.projectId) throw new Error("Edit turn is missing or belongs to another project"); return turn; }
function canvasExpansionFor(turn: EditTurnRecord): { top: number; right: number; bottom: number; left: number } | null {
  const value = (turn.annotations as Record<string, unknown>).canvasExpansion;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const expansion = value as Record<string, unknown>;
  const read = (edge: "top" | "right" | "bottom" | "left") => typeof expansion[edge] === "number" && Number.isFinite(expansion[edge]) ? Math.max(0, Math.round(expansion[edge])) : 0;
  const result = { top: read("top"), right: read("right"), bottom: read("bottom"), left: read("left") };
  return result.top || result.right || result.bottom || result.left ? result : null;
}
async function createOutpaintCanvas(source: Buffer, expansion: { top: number; right: number; bottom: number; left: number }): Promise<{ image: Buffer; mask: Buffer; width: number; height: number }> {
  const meta = await sharp(source).metadata(); if (!meta.width || !meta.height) throw new Error("Source image dimensions are unavailable");
  const width = meta.width + expansion.left + expansion.right; const height = meta.height + expansion.top + expansion.bottom;
  const original = await sharp(source).ensureAlpha().png().toBuffer();
  const image = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: original, left: expansion.left, top: expansion.top }]).png().toBuffer();
  const protectedOriginal = await sharp({ create: { width: meta.width, height: meta.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const mask = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: protectedOriginal, left: expansion.left, top: expansion.top }]).png().toBuffer();
  return { image, mask, width, height };
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
function mimeForStoredPath(path: string): string { return path.endsWith(".jpg") || path.endsWith(".jpeg") ? "image/jpeg" : path.endsWith(".webp") ? "image/webp" : "image/png"; }
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
class JobCancelled extends Error {}
function throwIfCancelled(job: JobRecord): void { const current = repository.getJob(job.id); if (current?.cancelRequested || current?.status === "CANCELLED") throw new JobCancelled(`Job ${job.id} was cancelled`); }
function extensionForMime(mimeType: string): string { return mimeType.includes("webp") ? ".webp" : mimeType.includes("jpeg") ? ".jpg" : ".png"; }
function exportFileName(project: ProjectRecord, output: { storyboardItemId: string; storagePath: string }, index: number): string { const item = repository.getStoryboardItem(output.storyboardItemId); const extension = output.storagePath.slice(output.storagePath.lastIndexOf(".")); return `${safeName(project.name)}_${String(index + 1).padStart(2, "0")}_${safeName(item?.assetType ?? "image")}${extension}`; }
function safeName(value: string): string { return value.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "ecomgen"; }
async function createZip(files: Array<{ name: string; content: Buffer }>): Promise<Buffer> { return new Promise((resolve, reject) => { const output = new PassThrough(); const chunks: Buffer[] = []; output.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk))); output.on("end", () => resolve(Buffer.concat(chunks))); output.on("error", reject); const zip = archiver("zip", { zlib: { level: 9 } }); zip.on("error", reject); zip.pipe(output); files.forEach((file) => zip.append(file.content, { name: file.name })); void zip.finalize(); }); }
