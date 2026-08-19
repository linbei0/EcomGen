import { PassThrough } from "node:stream";
import { resolve } from "node:path";
import { Worker } from "bullmq";
import archiver from "archiver";
import { planStoryboard, reviseImagePrompt } from "@ecomgen/agent";
import { EcomRepository, LocalAssetStore, SecretBox, openDatabase, resolveDataDir, type AssetRecord, type JobRecord, type ProjectRecord } from "@ecomgen/core";
import { getTemplate } from "@ecomgen/ecom-skill";
import { resolveImageSize, userAssetKindForRole, type ImageAspectRatio, type ImageResolution, type PlanningMode } from "@ecomgen/contracts";
import { createJobQueue, createRedisConnection, enqueue, type EcomJobPayload, QUEUE_NAME, RedisProjectEventBus } from "@ecomgen/jobs";
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
// 进程异常退出后，数据库中的 RUNNING 任务会被重新置为 QUEUED 并再次交给 BullMQ。
for (const recovered of repository.recoverInterruptedJobs()) await enqueue(recoveryQueue, { jobId: recovered.id, kind: recovered.type.toLowerCase() as "plan" | "generate" | "export" });
await recoveryQueue.close();
await recoveryRedis.quit();

const worker = new Worker<EcomJobPayload>(QUEUE_NAME, async (queueJob) => {
  const job = repository.getJob(queueJob.data.jobId); if (!job) throw new Error(`Database job is missing: ${queueJob.data.jobId}`);
  if (job.status === "CANCELLED" || job.cancelRequested) return;
  await updateJob(job, { status: "RUNNING", progress: 5, error: null });
  try {
    if (queueJob.data.kind === "plan") await executePlan(job);
    else if (queueJob.data.kind === "generate") await executeGeneration(job);
    else await executeExport(job);
    const current = repository.getJob(job.id); if (current?.cancelRequested || current?.status === "CANCELLED") { await updateJob(job, { status: "CANCELLED", progress: current.progress }); } else await updateJob(job, { status: "SUCCEEDED", progress: 100 });
  } catch (error) {
    if (error instanceof JobCancelled) { await updateJob(job, { status: "CANCELLED", cancelRequested: true }); return; }
    const message = error instanceof Error ? error.message : String(error);
    await updateJob(job, { status: "FAILED", progress: 100, error: { message, providerStatus: error instanceof ProviderError ? error.status : undefined } });
    throw error;
  }
}, { connection: redis, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) });

worker.on("failed", (job, error) => { console.error(`Queue job ${job?.id ?? "unknown"} failed: ${error instanceof Error ? error.message : String(error)}`); });
async function stop(): Promise<void> { await worker.close(); await events.close(); await redis.quit(); }
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
  const input = job.input as { planningMode?: PlanningMode; requestedTypes?: string[]; userInstruction?: string; candidatesPerType?: number; imageResolution?: ImageResolution; imageAspectRatio?: ImageAspectRatio };
  if (input.imageResolution || input.imageAspectRatio || input.candidatesPerType) {
    repository.updateProject(project.id, {
      imageResolution: input.imageResolution ?? project.imageResolution,
      imageAspectRatio: input.imageAspectRatio ?? project.imageAspectRatio,
      candidatesPerType: input.candidatesPerType ?? project.candidatesPerType
    });
  }
  const plannerAssets = assets.map((asset) => ({ id: asset.id, role: asset.role, kind: userAssetKindForRole(asset.role), name: asset.originalName, mimeType: asset.mimeType }));
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
      defaultMode: project.defaultMode,
      assets: plannerAssets,
      referenceImages,
      planningMode: input.planningMode ?? "AI",
      requestedTypes: input.requestedTypes,
      userInstruction: input.userInstruction,
      candidatesPerType: input.candidatesPerType ?? project.candidatesPerType
    });
  throwIfCancelled(job);
  const storyboard = repository.saveStoryboard(project.id, plan.campaignStyleLock, "DRAFT", plan.items.map((item) => ({ ...item, status: "DRAFT", compiledPrompt: null })));
  await updateJob(job, { progress: 90 }); await events.publish(project.id, "storyboard.updated", { storyboard, items: repository.listStoryboardItems(project.id) });
}

async function executeGeneration(job: JobRecord): Promise<void> {
  throwIfCancelled(job);
  if (!job.storyboardItemId) throw new Error("Generation job has no storyboard item");
  const project = projectFor(job); const item = repository.getStoryboardItem(job.storyboardItemId); if (!item || item.projectId !== project.id) throw new Error("Storyboard item is missing or belongs to another project");
  const provider = providerFor(project.imageProviderId); const model = provider.models.find((candidate) => candidate.id === project.imageModelId); if (!model) throw new Error("Configured image model no longer exists in its provider"); if (model.imageApiKind !== "openai_images") throw new Error("Only OpenAI-compatible Images API models are currently executable");
  const storyboard = repository.getStoryboard(project.id); if (!storyboard) throw new Error("Storyboard is missing"); const template = getTemplate(item.assetType); if (!template) throw new Error(`Storyboard item uses an unknown ecom-details-image template: ${item.assetType}`);
  const inputs = generationAssets(project, item.mode);
  if (item.mode === "PIXEL_PROTECTED" && inputs.length === 0) throw new Error("PIXEL_PROTECTED generation requires a PRODUCT_TRUTH image on the project");
  const revision = typeof job.input.revision === "string" ? job.input.revision.trim() : "";
  const candidateIndex = typeof job.input.candidateIndex === "number" ? job.input.candidateIndex : 1;
  const resolution = (typeof job.input.imageResolution === "string" ? job.input.imageResolution : project.imageResolution) as ImageResolution;
  const aspectRatio = (typeof job.input.imageAspectRatio === "string" ? job.input.imageAspectRatio : project.imageAspectRatio) as ImageAspectRatio;
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
    generationSnapshot: { resolution, aspectRatio, size, candidateIndex },
    storagePath: stored.path,
    hash: stored.hash,
    reviewDecision: "NEEDS_REVIEW",
    reviewNote: null
  });
  repository.updateStoryboardItem(item.id, { status: "GENERATED" }); await events.publish(project.id, "output.created", { output });
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
class JobCancelled extends Error {}
function throwIfCancelled(job: JobRecord): void { const current = repository.getJob(job.id); if (current?.cancelRequested || current?.status === "CANCELLED") throw new JobCancelled(`Job ${job.id} was cancelled`); }
function extensionForMime(mimeType: string): string { return mimeType.includes("webp") ? ".webp" : mimeType.includes("jpeg") ? ".jpg" : ".png"; }
function exportFileName(project: ProjectRecord, output: { storyboardItemId: string; storagePath: string }, index: number): string { const item = repository.getStoryboardItem(output.storyboardItemId); const extension = output.storagePath.slice(output.storagePath.lastIndexOf(".")); return `${safeName(project.name)}_${String(index + 1).padStart(2, "0")}_${safeName(item?.assetType ?? "image")}${extension}`; }
function safeName(value: string): string { return value.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "ecomgen"; }
async function createZip(files: Array<{ name: string; content: Buffer }>): Promise<Buffer> { return new Promise((resolve, reject) => { const output = new PassThrough(); const chunks: Buffer[] = []; output.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk))); output.on("end", () => resolve(Buffer.concat(chunks))); output.on("error", reject); const zip = archiver("zip", { zlib: { level: 9 } }); zip.on("error", reject); zip.pipe(output); files.forEach((file) => zip.append(file.content, { name: file.name })); void zip.finalize(); }); }
