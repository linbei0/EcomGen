import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { JobRecord } from "@ecomgen/core";
import { EXTERNAL_REQUEST_STARTED } from "@ecomgen/core";
import {
  PATTERN_FORGE_CANDIDATES_MAX,
  PATTERN_VARIANT_CANDIDATES_MAX,
  POD_PRINT_CATEGORIES,
  PATTERN_VARIANT_PRESET_IDS,
  TILEABILITY_ALGORITHM_VERSION,
  isSegmentationProtocol,
  DEFAULT_IMAGE_QUALITY,
  resolveOpenAiImageSize,
} from "@ecomgen/contracts";
import type {
  ImageAspectRatio,
  ImageResolution,
  PatternBackgroundMode,
  PatternVariantAxis,
  PatternVariantPreset,
  PodPrintCategory,
  SegmentationProtocol,
} from "@ecomgen/contracts";
import {
  compilePatternExtractPrompt,
  compilePatternForgePrompt,
  compilePatternGenerateExtractPrompt,
  compilePatternVariantPrompt,
  defaultPatternName,
  defaultVariantName,
  presetBelongsToAxis,
} from "@ecomgen/ecom-skill";
import { highInputFidelityForOpenAiImageModel, createSegmentationProvider } from "@ecomgen/providers";
import { hasTransparentPixels, resolvePatternBackground, verifyPatternBackground } from "./pattern-background.js";
import { applyRecolor, type RecolorParams } from "./pattern-derive.js";
import { verifyTileable } from "./tile-verify.js";
import { decodeRgba, maskHasForeground, normalizeMask, pngFromRgba } from "./mask-utils.js";
import { mimeForStoragePath, outputDerivatives, generationKeyFor } from "./context.js";
import { openAiEditSize, openAiImageQuality, openAiImageRequestParams, resolutionFromSnapshot } from "./image-params.js";
import { multiplyAlpha } from "./layer-composite.js";
import type { WorkerContext } from "./context.js";

export async function executePatternExtract(ctx: WorkerContext, job: JobRecord, signal: AbortSignal): Promise<void> {
  const { repository, storage, secrets, updateJob, throwIfCancelled, providerFor, imageModelForJob, imageGeneratorFor } = ctx;
  throwIfCancelled(job);
  // 提取快照与源图路径都在入队时写入 input；执行只认快照，排队后改配置不影响本次执行。
  // mode 缺省按 SEGMENT 处理：与契约的缺省语义一致。
  const input = job.input as { patternId?: unknown; sourcePath?: unknown; brief?: unknown; mode?: unknown; background?: unknown; imageResolution?: unknown; protocol?: unknown; segmentationProviderId?: unknown; segmentationModelId?: unknown };
  const pattern = repository.getPattern(typeof input.patternId === "string" ? input.patternId : "");
  if (!pattern) throw new Error(`Pattern record missing for extract job ${job.id}`);
  const sourcePath = typeof input.sourcePath === "string" ? input.sourcePath : "";
  if (!sourcePath) throw new Error("Pattern extract job has no source image snapshot");
  const source = await storage.read(sourcePath);

  if (input.mode === "GENERATE") {
    /*
     * 生成式提取：生图模型把商品上的图案摊平重绘成图稿。
     *
     * 与分割提取的关键差异在产物语义——这里不再有"像素取自原图"的 PIXEL_PROTECTED 承诺，
     * 模型重绘正是本路径存在的理由（透视/褶皱/光影重的实拍分割给不了干净图稿）；
     * 铁律只剩一条：底版承诺必须校验，透明底丢失不可见但会污染下游成包。
     */
    const { provider, model } = imageModelForJob(job);
    const generator = imageGeneratorFor(provider, model);
    const background = input.background === "WHITE" ? "WHITE" : "TRANSPARENT";
    const backgroundPlan = resolvePatternBackground({ mode: background, model });
    // 提取重绘是编辑类调用：gpt-image 按源图自适应尺寸（不下发 size），Seedream 显式下发档位像素。
    const resolution = resolutionFromSnapshot(input.imageResolution);
    const editSize = openAiEditSize(model.id, resolution, "1:1", undefined);
    const inputFidelity = highInputFidelityForOpenAiImageModel(model.id);
    const prompt = compilePatternGenerateExtractPrompt({ brief: typeof input.brief === "string" ? input.brief : undefined, background });
    await updateJob(job, { progress: 15, providerTaskId: EXTERNAL_REQUEST_STARTED });
    const result = await generator.editImage({
      model: model.id,
      prompt,
      sourceImage: { data: source, filename: "product.png", mimeType: mimeForStoragePath(sourcePath) },
      ...(model.imageApiKind === "gemini" ? { imageAspectRatio: "1:1" as ImageAspectRatio, imageResolution: resolution } : {}),
      ...(editSize ? { size: editSize } : {}),
      ...(inputFidelity ? { inputFidelity } : {}),
      ...(backgroundPlan.transparent ?? {}),
      idempotencyKey: generationKeyFor(job.id, 1),
      signal,
    });
    throwIfCancelled(job);
    // 与起稿/衍生同一条纪律：产物先落盘（钱已花出去，图留在库里至少还能用），承诺未兑现再让任务失败。
    const stored = await storage.putPatternArtifact(pattern.id, "pattern", result.image);
    const { width, height } = await outputDerivatives(storage, stored.hash, result.image);
    const updated = repository.setPatternArtifact(pattern.id, { storagePath: stored.path, fileHash: stored.hash, width, height });
    if (!updated) throw new Error(`Pattern record disappeared for extract job ${job.id}`);
    await verifyPatternBackground(backgroundPlan, result.image, "提取");
    await updateJob(job, { progress: 95 });
    return;
  }

  if (!isSegmentationProtocol(input.protocol)) throw new Error("Pattern extract job is missing its segmentation snapshot");
  const protocol: SegmentationProtocol = input.protocol;
  // seedream_layerize 是多元素图层拆分，与单主体提取语义不符：快照若带该协议直接显式失败。
  if (protocol === "seedream_layerize") throw new Error("Pattern extraction does not support the seedream_layerize protocol");
  const segmentationProviderId = typeof input.segmentationProviderId === "string" ? input.segmentationProviderId : "";
  const segmentationModelId = typeof input.segmentationModelId === "string" ? input.segmentationModelId : "";
  if (!segmentationProviderId || !segmentationModelId) throw new Error("Pattern extract job is missing its segmentation snapshot");
  const provider = providerFor(segmentationProviderId);
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) throw new Error("Source image dimensions are unavailable");
  await updateJob(job, { progress: 15 });
  // fal 接受公网 URL 或 data URI；本地上传图没有公网地址，直接内联。
  const imageUrl = `data:${mimeForStoragePath(sourcePath)};base64,${source.toString("base64")}`;
  const segmenter = createSegmentationProvider(protocol, { baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) });
  const modelPath = protocol === "fal" && segmentationModelId.includes("/") ? segmentationModelId : undefined;
  await updateJob(job, { providerTaskId: EXTERNAL_REQUEST_STARTED });
  const result = await segmenter.segment({ imageUrl, textPrompt: compilePatternExtractPrompt(typeof input.brief === "string" ? input.brief : undefined), box: undefined, modelPath, signal });
  throwIfCancelled(job);
  const mask = await normalizeMask(result.mask, meta.width, meta.height);
  if (!maskHasForeground(mask)) throw new Error("未在商品图中分割出印花图案，请补充更具体的描述或更换图片后重试");
  // mask 只是选区：像素一律取自原图（PIXEL_PROTECTED 纪律），随后裁掉全透明边缘得到可入库花型。
  const originalRgba = await decodeRgba(source, meta.width, meta.height);
  const cutoutPng = await pngFromRgba(multiplyAlpha(originalRgba, mask), meta.width, meta.height);
  const trimmed = await sharp(cutoutPng).trim().png().toBuffer();
  const stored = await storage.putPatternArtifact(pattern.id, "pattern", trimmed);
  const { width, height } = await outputDerivatives(storage, stored.hash, trimmed);
  const updated = repository.setPatternArtifact(pattern.id, { storagePath: stored.path, fileHash: stored.hash, width, height });
  if (!updated) throw new Error(`Pattern record disappeared for extract job ${job.id}`);
  await updateJob(job, { progress: 95 });
}


/**
 * AI 起稿：确定性编译 prompt 后按候选幂等生成，每张候选直接成为独立花型。
 * 与选角同构：入队快照 + generationKey 断点续跑，不自动重跑已计费请求。
 *
 * 候选行在产物落盘后才创建（同 executeModelCast），因此"行存在 ⇒ 图稿存在"是一条真不变量：
 * 先建行会让失败候选留下 storagePath=null 的幽灵行，而断点计数若把它算作已完成，重试就会静默
 * 跳过该候选——少出一张且没有任何地方说明为什么少。代价是极端情况下（落盘后、建行前进程退出）
 * 会留下 patterns/<uuid>/ 下的孤儿文件：不可见且不阻塞任何流程，比幽灵行安全。
 */
/** 生成式候选的血缘：起稿无源（GENERATED），衍生指向源花型（DERIVED）。 */
interface PatternCandidateLineage {
  sourceType: "GENERATED" | "DERIVED";
  sourceAssetHash: string | null;
  parentPatternId: string | null;
  tags: string[];
}

/**
 * 生成式候选的落盘尾段（起稿 / 衍生共用）：目录名先于数据库行确定，产物落盘后才建行，
 * 保证"行存在 ⇒ 图稿存在"。两条链路的差异只在血缘字段与"编译 prompt + 选 generate/editImage"，
 * 这段尾段逐行同构——收成一份，不变量只在一处注释。
 */
async function storePatternCandidate(ctx: WorkerContext, job: JobRecord, image: Buffer, naming: { baseName: string; index: number; total: number }, lineage: PatternCandidateLineage): Promise<void> {
  const { storage, repository } = ctx;
  const patternId = randomUUID();
  const stored = await storage.putPatternArtifact(patternId, "pattern", image);
  const { width, height } = await outputDerivatives(storage, stored.hash, image);
  repository.createPattern({
    id: patternId,
    name: naming.total > 1 ? `${naming.baseName} #${naming.index}` : naming.baseName,
    sourceType: lineage.sourceType,
    sourceJobId: job.id,
    sourceAssetHash: lineage.sourceAssetHash,
    parentPatternId: lineage.parentPatternId,
    storagePath: stored.path,
    fileHash: stored.hash,
    width,
    height,
    tags: lineage.tags,
  });
}

/** 断点续跑的完成计数：只有已落产物的候选才算完成；旧数据残留的无产物行必须被重算而不是被跳过。 */
function completedPatternCandidates(ctx: WorkerContext, job: JobRecord): number {
  return ctx.repository.listPatternsByJobId(job.id).filter((entry) => entry.storagePath && entry.fileHash).length;
}

export async function executePatternForge(ctx: WorkerContext, job: JobRecord, signal: AbortSignal): Promise<void> {
  const { repository, storage, updateJob, throwIfCancelled, imageModelForJob, imageGeneratorFor } = ctx;
  throwIfCancelled(job);
  const input = job.input as { theme?: unknown; style?: unknown; category?: unknown; background?: unknown; imageResolution?: unknown; candidateCount?: unknown; name?: unknown };
  const theme = typeof input.theme === "string" ? input.theme.trim() : "";
  if (!theme) throw new Error("Pattern forge job has no theme snapshot");
  const category = typeof input.category === "string" && (POD_PRINT_CATEGORIES as readonly string[]).includes(input.category) ? (input.category as PodPrintCategory) : undefined;
  // 上限与 API 的 schema 同源（limits.ts）：常量调大后两端必须一起放行，worker 静默截半就是少出图且无解释。
  const candidateCount = typeof input.candidateCount === "number" ? Math.min(PATTERN_FORGE_CANDIDATES_MAX, Math.max(1, Math.round(input.candidateCount))) : 1;
  const baseName = typeof input.name === "string" && input.name.trim() ? input.name.trim() : defaultPatternName(theme);
  const { provider, model } = imageModelForJob(job);
  const generator = imageGeneratorFor(provider, model);
  // 起稿没有源图，底版只有白底/透明底两种；能力判定与拒绝都在 resolvePatternBackground 里，
  // 发生在第一次付费调用之前——用户不该为一次注定被拒的请求付费。
  const background: Exclude<PatternBackgroundMode, "SOURCE"> = input.background === "TRANSPARENT" ? "TRANSPARENT" : "WHITE";
  const backgroundPlan = resolvePatternBackground({ mode: background, model });
  const prompt = compilePatternForgePrompt({ theme, style: typeof input.style === "string" && input.style.trim() ? input.style.trim() : undefined, category, background });
  const resolution = resolutionFromSnapshot(input.imageResolution);
  const completed = completedPatternCandidates(ctx, job);
  for (let candidateIndex = completed + 1; candidateIndex <= candidateCount; candidateIndex += 1) {
    throwIfCancelled(job);
    await updateJob(job, { providerTaskId: EXTERNAL_REQUEST_STARTED, progress: 20 + Math.round(((candidateIndex - 1) / candidateCount) * 60) });
    const idempotencyKey = generationKeyFor(job.id, candidateIndex);
    const result = await generator.generate(model.imageApiKind === "gemini"
      ? { model: model.id, prompt, imageAspectRatio: "1:1" as ImageAspectRatio, imageResolution: resolution, idempotencyKey, signal }
      : { model: model.id, prompt, ...openAiImageRequestParams(model.id, resolution, "1:1", "1024x1024", { quality: DEFAULT_IMAGE_QUALITY }), ...(backgroundPlan.transparent ?? {}), idempotencyKey, signal });
    throwIfCancelled(job);
    await storePatternCandidate(ctx, job, result.image, { baseName, index: candidateIndex, total: candidateCount }, { sourceType: "GENERATED", sourceAssetHash: null, parentPatternId: null, tags: [] });
    // 产物先入库再裁决：钱已经花出去了，图就留着；但"要了透明却拿到不透明"必须当场说清楚，
    // 否则一张白底（更糟：模型画出来的棋盘格底纹）会静默流进成包流程，印在成品上才发现。
    await verifyPatternBackground(backgroundPlan, result.image, "起稿");
    await updateJob(job, { progress: 20 + Math.round((candidateIndex / candidateCount) * 60), providerTaskId: result.providerTaskId ?? EXTERNAL_REQUEST_STARTED });
  }
  await updateJob(job, { providerTaskId: null });
}

/**
 * 花型衍生：确定性本地改色（HSL 调制），产出一 new 花型（sourceType DERIVED、
 * parentPatternId 指向源），源花型永不被改写。
 * BullMQ 自动重试会产生同 jobId 的第二次执行：先查本任务已落的花型行，避免重试产出重复卡。
 */
export async function executePatternDerive(ctx: WorkerContext, job: JobRecord): Promise<void> {
  const { repository, storage, updateJob, throwIfCancelled } = ctx;
  throwIfCancelled(job);
  const input = job.input as { patternId?: unknown; hueShift?: unknown; saturationPct?: unknown; brightnessPct?: unknown };
  const source = repository.getPattern(typeof input.patternId === "string" ? input.patternId : "");
  if (!source?.storagePath || !source.fileHash) throw new Error("Derive source pattern artwork is missing");
  const boundedNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  const hueShift = boundedNumber(input.hueShift) ?? 0;
  const recolorParams: RecolorParams = { hueShift, saturationPct: boundedNumber(input.saturationPct), brightnessPct: boundedNumber(input.brightnessPct) };
  const sourcePng = await storage.read(source.storagePath);
  await updateJob(job, { progress: 20 });
  const image = await applyRecolor(sourcePng, recolorParams);
  await updateJob(job, { progress: 70 });
  const derived = repository.listPatternsByJobId(job.id).find((entry) => entry.sourceType === "DERIVED")
    ?? repository.createPattern({
      name: `${source.name} · 改色 ${hueShift >= 0 ? "+" : ""}${hueShift}`,
      sourceType: "DERIVED",
      sourceJobId: job.id,
      sourceAssetHash: source.fileHash,
      parentPatternId: source.id,
      storagePath: null,
      fileHash: null,
      width: null,
      height: null,
      tags: source.tags,
    });
  const stored = await storage.putPatternArtifact(derived.id, "pattern", image);
  const { width, height } = await outputDerivatives(storage, stored.hash, image);
  repository.setPatternArtifact(derived.id, { storagePath: stored.path, fileHash: stored.hash, width, height });
  await updateJob(job, { progress: 95 });
}

/**
 * 生成式衍生（画风 / 构图）：源花型作为参考图走 images/edits，Prompt 由 ecom-skill 的固化模板派生。
 * 每张候选各自成为独立花型（sourceType DERIVED、parentPatternId 指向源），源花型永不被改写。
 *
 * 与起稿同构：入队快照 + generationKey 断点续跑 + 产物落盘后才建行；付费生图不自动重跑。
 * 定位是快速铺款筛选：API 无法锁 seed/风格向量，所以不承诺候选之间的一致性。
 */
export async function executePatternVariant(ctx: WorkerContext, job: JobRecord, signal: AbortSignal): Promise<void> {
  const { repository, storage, updateJob, throwIfCancelled, imageModelForJob, imageGeneratorFor } = ctx;
  throwIfCancelled(job);
  const input = job.input as { patternId?: unknown; axis?: unknown; preset?: unknown; extra?: unknown; background?: unknown; imageResolution?: unknown; candidateCount?: unknown; name?: unknown };
  const source = repository.getPattern(typeof input.patternId === "string" ? input.patternId : "");
  if (!source?.storagePath || !source.fileHash) throw new Error("Variant source pattern artwork is missing");
  const axis: PatternVariantAxis | null = input.axis === "STYLE" || input.axis === "COMPOSITION" ? input.axis : null;
  const preset = typeof input.preset === "string" && (PATTERN_VARIANT_PRESET_IDS as readonly string[]).includes(input.preset) ? (input.preset as PatternVariantPreset) : null;
  if (!axis || !preset) throw new Error("Pattern variant job has no axis/preset snapshot");
  if (!presetBelongsToAxis(axis, preset)) throw new Error(`Pattern variant preset does not belong to axis: ${axis}/${preset}`);
  const candidateCount = typeof input.candidateCount === "number" ? Math.min(PATTERN_VARIANT_CANDIDATES_MAX, Math.max(1, Math.round(input.candidateCount))) : 1;
  const baseName = typeof input.name === "string" && input.name.trim() ? input.name.trim() : defaultVariantName(source.name, axis, preset);
  const { provider, model } = imageModelForJob(job);
  const generator = imageGeneratorFor(provider, model);
  const sourceImage = await storage.read(source.storagePath);
  // 源图本身是不是透明底要解码判定，不能按用户声明；`SOURCE` 模式据此决定"要不要发透明参数"：
  // 源不透明时模型倾向照源铺底，要透明多半白要一次；源透明却重新铺白底，则等于把一张能直印的
  // 花型降级成需要再抠一次的白底图。判定必须发生在编译提示词之前——护栏要按它选。
  const sourceTransparent = await hasTransparentPixels(sourceImage);
  const background: PatternBackgroundMode = input.background === "WHITE" || input.background === "TRANSPARENT" || input.background === "SOURCE" ? input.background : "SOURCE";
  const backgroundPlan = resolvePatternBackground({ mode: background, model, sourceTransparent });
  const prompt = compilePatternVariantPrompt({
    axis,
    preset,
    extra: typeof input.extra === "string" && input.extra.trim() ? input.extra.trim() : undefined,
    background,
  });
  // 衍生是编辑类调用：gpt-image 按源图自适应尺寸（不下发 size），Seedream 显式下发档位像素。
  const resolution = resolutionFromSnapshot(input.imageResolution);
  const completed = completedPatternCandidates(ctx, job);
  for (let candidateIndex = completed + 1; candidateIndex <= candidateCount; candidateIndex += 1) {
    throwIfCancelled(job);
    await updateJob(job, { providerTaskId: EXTERNAL_REQUEST_STARTED, progress: 20 + Math.round(((candidateIndex - 1) / candidateCount) * 60) });
    const editSize = openAiEditSize(model.id, resolution, "1:1", undefined);
    const inputFidelity = highInputFidelityForOpenAiImageModel(model.id);
    const result = await generator.editImage({
      model: model.id,
      prompt,
      sourceImage: { data: sourceImage, filename: "pattern.png", mimeType: "image/png" },
      ...(model.imageApiKind === "gemini" ? { imageAspectRatio: "1:1" as ImageAspectRatio, imageResolution: resolution } : {}),
      ...(editSize ? { size: editSize } : {}),
      ...(inputFidelity ? { inputFidelity } : {}),
      ...(backgroundPlan.transparent ?? {}),
      idempotencyKey: generationKeyFor(job.id, candidateIndex),
      signal,
    });
    throwIfCancelled(job);
    await storePatternCandidate(ctx, job, result.image, { baseName, index: candidateIndex, total: candidateCount }, { sourceType: "DERIVED", sourceAssetHash: source.fileHash, parentPatternId: source.id, tags: source.tags });
    // 与起稿同一条纪律：产物留下，但源是透明底而结果不是，必须当场说清楚（透明底的丢失不可见，
    // 但成包时会把白底或棋盘格底纹一起印上去）。
    await verifyPatternBackground(backgroundPlan, result.image, "衍生");
    await updateJob(job, { progress: 20 + Math.round((candidateIndex / candidateCount) * 60), providerTaskId: result.providerTaskId ?? EXTERNAL_REQUEST_STARTED });
  }
  await updateJob(job, { providerTaskId: null });
}

/**
 * 验缝：本地确定性判定，只写判定、不改动花型像素。
 * 花型图内容不可变，所以同一算法对同一花型的结果恒定——唯一需要重跑的情形是验缝算法版本升级
 * （判定里记录的算法版本与当前不一致时，重跑会把同一花型重新判定一次）。
 */
export async function executePatternTileCheck(ctx: WorkerContext, job: JobRecord): Promise<void> {
  const { repository, storage, updateJob, throwIfCancelled } = ctx;
  throwIfCancelled(job);
  const patternId = typeof job.input.patternId === "string" ? job.input.patternId : "";
  const pattern = repository.getPattern(patternId);
  if (!pattern?.storagePath) throw new Error("Pattern artwork is missing for this tileability check");
  const source = await storage.read(pattern.storagePath);
  await updateJob(job, { progress: 40 });
  const verdict = await verifyTileable(source);
  const updated = repository.setPatternTileable(pattern.id, { status: verdict.status, score: verdict.score, algorithmVersion: TILEABILITY_ALGORITHM_VERSION });
  if (!updated) throw new Error(`Pattern record disappeared for tile check job ${job.id}`);
  await updateJob(job, { progress: 95 });
}
