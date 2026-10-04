import type { JobRecord } from "@ecomgen/core";
import { EXTERNAL_REQUEST_STARTED } from "@ecomgen/core";
import { MODEL_CAST_CANDIDATES_MAX } from "@ecomgen/contracts";
import type { ImageAspectRatio, ModelSpec } from "@ecomgen/contracts";
import { compileModelCastPrompt } from "@ecomgen/ecom-skill";
import { extensionForMime, generationKeyFor, mimeForStoragePath, outputDerivatives } from "./context.js";
import { openAiImageRequestParams, normalizeOutputFormat, outputFormatFromSnapshot, qualityFromSnapshot, resolutionFromSnapshot } from "./image-params.js";
import type { WorkerContext } from "./context.js";

/**
 * 模特选角：按入队时快照的 spec 与参考脸确定性编译定妆照 prompt，产出 candidateCount 张候选。
 * 参考脸是唯一身份基准：有图时前置身份锚点并附参考图；候选按 (jobId, candidateIndex) 幂等，
 * 重跑只补缺失的候选。全局模特库无项目 SSE 通道，前端依赖轮询任务状态。
 */
export async function executeModelCast(ctx: WorkerContext, job: JobRecord, signal: AbortSignal): Promise<void> {
  const { repository, storage, updateJob, throwIfCancelled, imageModelForJob, imageGeneratorFor } = ctx;
  throwIfCancelled(job);
  const input = job.input as { modelId?: unknown; aspectRatio?: unknown; imageResolution?: unknown; quality?: unknown; outputFormat?: unknown; candidateCount?: unknown; spec?: unknown; notes?: unknown; referenceFacePath?: unknown };
  const castModel = repository.getModel(typeof input.modelId === "string" ? input.modelId : "");
  if (!castModel) throw new Error(`Model not found for job ${job.id}`);
  // spec 使用入队快照而非当前库值：用户改 spec 不影响已在排队的任务，重试可复现同一 prompt
  if (!input.spec || typeof input.spec !== "object") throw new Error(`Job ${job.id} has no model spec snapshot`);
  const spec = input.spec as ModelSpec;
  const notes = typeof input.notes === "string" ? input.notes : "";
  const candidateCount = typeof input.candidateCount === "number" ? Math.min(MODEL_CAST_CANDIDATES_MAX, Math.max(1, Math.round(input.candidateCount))) : 1;
  const aspectRatio = (typeof input.aspectRatio === "string" ? input.aspectRatio : "AUTO") as ImageAspectRatio;
  const resolution = resolutionFromSnapshot(input.imageResolution);
  const quality = qualityFromSnapshot(input.quality);
  const outputFormat = outputFormatFromSnapshot(input.outputFormat);
  const { provider, model } = imageModelForJob(job);
  const generator = imageGeneratorFor(provider, model);
  // 参考脸也取快照：任务指纹按入队时的参考脸 hash 计算，读实时库值会让实发 prompt 与指纹脱钩
  // （入队后换脸会用新脸生成，重试还会因换脸产出与前次不同的身份基准）。
  const referenceFacePath = typeof input.referenceFacePath === "string" ? input.referenceFacePath : null;
  const referenceFace = referenceFacePath
    ? { data: await storage.read(referenceFacePath), filename: "reference-face.png", mimeType: mimeForStoragePath(referenceFacePath) }
    : undefined;
  const prompt = compileModelCastPrompt(spec, notes, Boolean(referenceFace));
  const completed = repository.listModelPortraits(castModel.id).filter((portrait) => portrait.jobId === job.id).length;
  for (let candidateIndex = completed + 1; candidateIndex <= candidateCount; candidateIndex += 1) {
    throwIfCancelled(job);
    await updateJob(job, { providerTaskId: EXTERNAL_REQUEST_STARTED, progress: 20 + Math.round(((candidateIndex - 1) / candidateCount) * 60) });
    const idempotencyKey = generationKeyFor(job.id, candidateIndex);
    const images = referenceFace ? [referenceFace] : undefined;
    const result = await generator.generate(model.imageApiKind === "gemini"
      ? { model: model.id, prompt, imageAspectRatio: aspectRatio, imageResolution: resolution, images, idempotencyKey, signal }
      : { model: model.id, prompt, ...openAiImageRequestParams(model.id, resolution, aspectRatio, "1024x1536", { quality, outputFormat }), images, idempotencyKey, signal });
    throwIfCancelled(job);
    // 渠道没兑现 output_format 时本地转码兜底，保证落盘格式与用户选择一致。
    const normalized = await normalizeOutputFormat(result.image, outputFormat, result.mimeType);
    const stored = await storage.putModelPortrait(castModel.id, job.id, normalized.image, extensionForMime(normalized.mimeType));
    const { width, height } = await outputDerivatives(storage, stored.hash, normalized.image);
    repository.createModelPortrait({ modelId: castModel.id, jobId: job.id, storagePath: stored.path, hash: stored.hash, width, height, providerId: provider.id, imageModelId: model.id, aspectRatio });
    await updateJob(job, { progress: 20 + Math.round((candidateIndex / candidateCount) * 60), providerTaskId: result.providerTaskId ?? EXTERNAL_REQUEST_STARTED });
  }
  await updateJob(job, { providerTaskId: null });
}
