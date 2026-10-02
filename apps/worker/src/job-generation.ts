import type { JobRecord } from "@ecomgen/core";
import { EXTERNAL_REQUEST_STARTED } from "@ecomgen/core";
import { resolveImageSize } from "@ecomgen/contracts";
import type { ImageAspectRatio, ImageResolution } from "@ecomgen/contracts";
import { getTemplate } from "@ecomgen/ecom-skill";
import { highInputFidelityForOpenAiImageModel } from "@ecomgen/providers";
import { assertPixelProtectedInputs, selectGenerationAssets, withGenerationAssetRoles, assignImageHandles } from "./visual-assets.js";
import { extensionForMime, generationKeyFor, outputDerivatives } from "./context.js";
import type { WorkerContext } from "./context.js";

export async function executeGeneration(ctx: WorkerContext, job: JobRecord, signal: AbortSignal): Promise<void> {
  const { repository, storage, suiteCatalog, events, updateJob, throwIfCancelled, projectFor, providerFor, imageGeneratorFor, compiledUserTemplates, reviseGenerationPrompt } = ctx;
  throwIfCancelled(job);
  if (!job.storyboardItemId) throw new Error("Generation job has no storyboard item");
  const project = projectFor(job); const item = repository.getStoryboardItem(job.storyboardItemId); if (!item || item.projectId !== project.id) throw new Error("Storyboard item is missing or belongs to another project");
  const providerId = job.providerId ?? item.imageProviderId;
  const modelId = job.modelId ?? item.imageModelId;
  if (!providerId || !modelId) throw new Error("该项目尚未选择生图模型（Provider 可能已被删除），请在项目设置中重新选择");
  const provider = providerFor(providerId); const model = provider.models.find((candidate) => candidate.id === modelId); if (!model) throw new Error("Configured image model no longer exists in its provider"); if (model.imageApiKind !== "openai_images" && model.imageApiKind !== "gemini") throw new Error("Selected image model has no executable image API");
  const storyboard = repository.getStoryboard(project.id); if (!storyboard) throw new Error("Storyboard is missing");
  // 分镜可能引用单图模板或套图分镜（assetType 为 <suiteId>::<shotId>）；两者都查不到时显式报错，不做静默降级。
  const template = getTemplate(item.assetType) ?? compiledUserTemplates().find((userTemplate) => userTemplate.id === item.assetType);
  const suiteShot = template ? undefined : suiteCatalog.resolveShot(item.assetType);
  if (!template && !suiteShot) throw new Error(`分镜引用的模板或套图分镜不存在或已被删除（${item.assetType}），无法生成；请删除该分镜或重新规划`);
  const supportsImageReference = template ? template.supports_image_reference : suiteShot?.shot.supportsImageReference !== false;
  const fallbackDefaultSize = template ? template.defaultSize : "1024x1536";
  const projectAssets = repository.listAssets(project.id);
  const inputs = selectGenerationAssets(projectAssets, item);
  const generationInputs = supportsImageReference ? inputs : [];
  if (item.mode === "PIXEL_PROTECTED") assertPixelProtectedInputs(generationInputs);
  const revision = typeof job.input.revision === "string" ? job.input.revision.trim() : "";
  const isRetry = revision === "retry";
  const generationBatchId = typeof job.input.generationBatchId === "string" ? job.input.generationBatchId : job.id;
  const candidateIndex = typeof job.input.candidateIndex === "number" ? job.input.candidateIndex : 1;
  const resolution = (typeof job.input.imageResolution === "string" ? job.input.imageResolution : item.imageResolution) as ImageResolution;
  const aspectRatio = (typeof job.input.imageAspectRatio === "string" ? job.input.imageAspectRatio : item.imageAspectRatio) as ImageAspectRatio;
  // 套图分镜自带期望比例：仅当项目/分镜未指定（AUTO）时采用，避免覆盖用户的显式选择。
  const effectiveAspectRatio = aspectRatio === "AUTO" && suiteShot?.shot.aspectRatio ? (suiteShot.shot.aspectRatio as ImageAspectRatio) : aspectRatio;
  const size = resolveImageSize(resolution, effectiveAspectRatio, fallbackDefaultSize);
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
  const generator = imageGeneratorFor(provider, model);
  await updateJob(job, { providerTaskId: EXTERNAL_REQUEST_STARTED });
  const inputFidelity = model.imageApiKind === "openai_images" && generationInputs.some((asset) => asset.role === "PRODUCT_TRUTH")
    ? highInputFidelityForOpenAiImageModel(model.id)
    : undefined;
  const result = await generator.generate(model.imageApiKind === "gemini"
    ? { model: model.id, prompt: compiledPrompt, imageAspectRatio: aspectRatio, imageResolution: resolution, images: images.length ? images : undefined, idempotencyKey: generationKey, signal }
    : { model: model.id, prompt: compiledPrompt, size, quality: "high", images: images.length ? images : undefined, inputFidelity, idempotencyKey: generationKey, signal });
  throwIfCancelled(job);
  await updateJob(job, { progress: 80, providerTaskId: result.providerTaskId ?? EXTERNAL_REQUEST_STARTED }); const stored = await storage.putOutput(project.id, result.image, extensionForMime(result.mimeType), generationKey);
  throwIfCancelled(job);
  const { width, height } = await outputDerivatives(storage, stored.hash, result.image);
  const output = repository.createOutput({
    projectId: project.id,
    storyboardItemId: item.id,
    jobId: job.id,
    candidateIndex,
    generationSnapshot: { providerId, modelId, resolution, aspectRatio: effectiveAspectRatio, size, candidateIndex, ...(revision ? { revision } : {}) },
    storagePath: stored.path,
    hash: stored.hash,
    width,
    height,
    generationKey,
    generationBatchId,
  });
  await updateJob(job, { providerTaskId: null });
  repository.updateStoryboardItem(item.id, { status: "GENERATED" }); await events.publish(project.id, "output.created", { output });
}
