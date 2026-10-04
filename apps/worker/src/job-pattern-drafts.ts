import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { DraftBatchRecord, DraftCandidateRecord, JobRecord, PatternDraftRecord } from "@ecomgen/core";
import { EXTERNAL_REQUEST_STARTED } from "@ecomgen/core";
import {
  DRAFT_SEAM_BAND_MAX,
  TILEABILITY_ALGORITHM_VERSION,
  isSegmentationProtocol,
  DEFAULT_IMAGE_QUALITY,
  resolveOpenAiImageSize,
} from "@ecomgen/contracts";
import type {
  DraftBatchOperation,
  DraftSeamEdge,
  ImageAspectRatio,
  ImageQuality,
  ImageResolution,
  SegmentationProtocol,
} from "@ecomgen/contracts";
import { compileDraftEditPrompt, compileDraftGeneratePrompt } from "@ecomgen/ecom-skill";
import { assertEditCapabilities, paintOverImage } from "./edit-imaging.js";
import { applyRecolor, type RecolorParams } from "./pattern-derive.js";
import { hasTransparentPixels, resolvePatternBackground, verifyPatternBackground } from "./pattern-background.js";
import { applySeamEdit, buildSeamCanvas, compileSeamEditPrompt } from "./seam-edit.js";
import { verifyTileableDetailed } from "./tile-verify.js";
import { decodeRgba, maskHasForeground, normalizeMask, pngFromRgba } from "./mask-utils.js";
import { multiplyAlpha } from "./layer-composite.js";
import { createSegmentationProvider, highInputFidelityForOpenAiImageModel, imageEditCapabilitiesFor } from "@ecomgen/providers";
import { JobCancelled, generationKeyFor, mimeForStoragePath, outputDerivatives } from "./context.js";
import { openAiImageRequestParams, qualityFromSnapshot, resolutionFromSnapshot } from "./image-params.js";
import type { WorkerContext } from "./context.js";

/**
 * AI 起稿工作台的 Worker 执行器。
 *
 * 与正式花型彻底分开：这里只产出「创作候选」，绝不写 patterns；定稿是 API 的显式动作。
 * 付费纪律与 pattern_forge 一致：每次付费调用前写 EXTERNAL_REQUEST_STARTED，失败不自动重跑；
 * 槽位是稳定序号，重试只领取失败槽位，已成功候选保持不动。
 *
 * 部分成功语义：整批只要有槽位失败，任务以 FAILED 收尾（让用户看到真实失败），但已落盘的候选与
 * 已成功槽位原样保留；批次展示由槽位聚合，不引入含混的 PARTIAL 全局状态。
 */

interface DraftSnapshotReference {
  /** 参考图的引用编号，与提示词里的 `@图N` 对应；缺失只可能出现在该字段引入之前的老快照上。 */
  ordinal?: number | null;
  storagePath: string;
  mimeType: string;
  notes?: string | null;
}

interface DraftSnapshot {
  operation: DraftBatchOperation;
  providerId: string | null;
  imageModelId: string | null;
  candidateCount: number;
  theme?: string;
  aspectRatio?: ImageAspectRatio;
  /** 生成批次的分辨率档位与质量；仅 GENERATE 消费（改稿/接缝必须保持父候选几何）。 */
  imageResolution?: ImageResolution;
  quality?: ImageQuality;
  background?: "WHITE" | "TRANSPARENT";
  instruction?: string;
  recolor?: RecolorParams;
  seam?: { edge: DraftSeamEdge; band: number };
  references?: DraftSnapshotReference[];
  /** 用户画在源图上的改稿笔迹；缺失表示这次是对整张图改稿。 */
  annotation?: { storagePath: string; mimeType: string } | null;
  parentCandidateId?: string | null;
  segmentation?: { providerId: string; modelId: string; protocol: SegmentationProtocol } | null;
}

interface DraftBatchJobInput {
  draftId?: unknown;
  batchId?: unknown;
  slots?: unknown;
  task?: unknown;
  candidateId?: unknown;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value) throw new Error(message);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 一次付费图像调用的固定前后动作：先落 EXTERNAL_REQUEST_STARTED（恢复与重试据此判断"已经发过请求"），
 * 再发请求，返回前检查取消。这三步散在各分支里手写，漏掉任意一步都会让重试或取消语义失真。
 */
async function runPaidDraftCall<T>(ctx: WorkerContext, job: JobRecord, call: () => Promise<T>): Promise<T> {
  await ctx.updateJob(job, { providerTaskId: EXTERNAL_REQUEST_STARTED });
  const result = await call();
  ctx.throwIfCancelled(job);
  return result;
}

function readSnapshot(batch: DraftBatchRecord): DraftSnapshot {
  const snapshot = batch.snapshot as unknown as DraftSnapshot;
  return { ...snapshot, operation: batch.operation, candidateCount: batch.candidateCount };
}

/** 归一化为 PNG 存储：候选一律以支持 alpha 的容器落盘，"要求透明却拿到不透明"由校验负责，不由容器负责。 */
async function storeDraftCandidate(ctx: WorkerContext, batch: DraftBatchRecord, slotIndex: number, image: Buffer, parentCandidateId: string | null): Promise<DraftCandidateRecord> {
  // 编码时一并取回宽高：再单独解一次图只为量尺寸，等于把同一张图多解码一遍。
  const { data: png, info } = await sharp(image).png().toBuffer({ resolveWithObject: true });
  const hasAlpha = await hasTransparentPixels(png);
  const candidateId = randomUUID();
  const stored = await ctx.storage.putDraftCandidate(batch.draftId, candidateId, png);
  const { width, height } = await outputDerivatives(ctx.storage, stored.hash, png);
  return ctx.repository.createDraftCandidate({
    id: candidateId,
    draftId: batch.draftId,
    batchId: batch.id,
    slotIndex,
    parentCandidateId,
    storagePath: stored.path,
    fileHash: stored.hash,
    mimeType: "image/png",
    width: width ?? info.width ?? null,
    height: height ?? info.height ?? null,
    transform: batch.operation,
    hasAlpha,
  });
}

interface SlotWorkResult {
  image: Buffer;
  /** 产物已保留但要求未被满足（例如要透明底却拿到不透明）；记在槽位上供界面如实展示。 */
  warning?: string;
  /** 落候选后的补充写入（如接缝复检结论），在候选行存在之后调用。 */
  afterStore?: (candidateId: string) => void;
}

/**
 * 遍历目标槽位并落候选。已成功的槽位跳过（断点续跑），单个槽位失败不打断其余槽位；
 * 取消时把未完成槽位记为 CANCELLED 并向上抛出，交由 worker 主流程把任务置为 CANCELLED。
 */
async function runDraftSlots(ctx: WorkerContext, job: JobRecord, batch: DraftBatchRecord, snapshot: DraftSnapshot, work: (slotIndex: number) => Promise<SlotWorkResult>): Promise<void> {
  const { repository, updateJob } = ctx;
  const targetSlots = Array.isArray(job.input.slots) ? (job.input.slots as unknown[]).filter((value): value is number => typeof value === "number" && Number.isInteger(value)) : [];
  const done = new Set(repository.listDraftCandidateSlotIndices(batch.id));
  const pending = targetSlots.filter((index) => !done.has(index));
  const failures: string[] = [];
  for (let position = 0; position < pending.length; position += 1) {
    const slotIndex = pending[position]!;
    try {
      ctx.throwIfCancelled(job);
      repository.updateDraftSlot(batch.id, slotIndex, { status: "RUNNING" });
      const result = await work(slotIndex);
      const candidate = await storeDraftCandidate(ctx, batch, slotIndex, result.image, snapshot.parentCandidateId ?? null);
      result.afterStore?.(candidate.id);
      repository.updateDraftSlot(batch.id, slotIndex, { status: "SUCCEEDED", error: result.warning ? { warning: result.warning } : null });
      await updateJob(job, { progress: 10 + Math.round(((position + 1) / Math.max(1, pending.length)) * 85), providerTaskId: null });
    } catch (error) {
      if (error instanceof JobCancelled) {
        for (const remaining of pending.slice(position)) repository.updateDraftSlot(batch.id, remaining, { status: "CANCELLED" });
        throw error;
      }
      const message = errorMessage(error);
      repository.updateDraftSlot(batch.id, slotIndex, { status: "FAILED", error: { message } });
      failures.push(`候选 #${slotIndex}：${message}`);
    }
  }
  if (failures.length) throw new Error(`部分候选生成失败：${failures.join("；")}`);
}

async function loadBatchContext(ctx: WorkerContext, job: JobRecord): Promise<{ batch: DraftBatchRecord; draft: PatternDraftRecord; snapshot: DraftSnapshot }> {
  const input = job.input as DraftBatchJobInput;
  const draftId = requireString(input.draftId, "Draft batch job is missing its draft snapshot");
  const batchId = requireString(input.batchId, "Draft batch job is missing its batch id");
  const draft = ctx.repository.getPatternDraft(draftId);
  const batch = ctx.repository.getDraftBatch(batchId);
  if (!draft) throw new Error(`Pattern draft ${draftId} is missing for batch ${batchId}`);
  if (!batch || batch.draftId !== draftId) throw new Error(`Draft batch ${batchId} is missing or belongs to another draft`);
  return { batch, draft, snapshot: readSnapshot(batch) };
}

async function readReferences(ctx: WorkerContext, snapshot: DraftSnapshot): Promise<Array<{ data: Buffer; filename: string; mimeType: string }>> {
  const references = snapshot.references ?? [];
  return Promise.all(references.map(async (reference, index) => ({
    data: await ctx.storage.read(reference.storagePath),
    filename: `reference-${index + 1}.png`,
    mimeType: reference.mimeType || mimeForStoragePath(reference.storagePath),
  })));
}

/**
 * 交给提示词编译层的参考图清单，顺序与真正下发的一致。
 *
 * 编号缺省的只有本字段引入前的老快照，用下标兜底即可——那些批次的文本里不可能出现 `@图N`。
 */
function referenceHints(snapshot: DraftSnapshot): Array<{ ordinal: number; notes?: string }> {
  return (snapshot.references ?? []).map((reference, index) => ({
    ordinal: typeof reference.ordinal === "number" ? reference.ordinal : index + 1,
    notes: reference.notes ?? undefined,
  }));
}

/** 把验缝判定连同当前算法版本写回候选；判定是本地确定性计算，各执行器在拿到新像素后调用。 */
function writeTileableVerdict(repository: WorkerContext["repository"], candidateId: string, verdict: Awaited<ReturnType<typeof verifyTileableDetailed>>): void {
  repository.setDraftCandidateTileable(candidateId, { status: verdict.status, score: verdict.score, horizontal: verdict.horizontal, vertical: verdict.vertical, algorithmVersion: TILEABILITY_ALGORITHM_VERSION });
}

/**
 * REPEAT 草稿下，任何生成式改稿都可能破坏平铺几何，所以结论必须跟着这一张新候选重新得出，
 * 而不是让用户在"未检测"与上一张的通过状态之间自己猜；判定是本地计算，不产生费用。
 * 非 REPEAT 草稿不写结论，新候选保持"未检测"的默认值。
 */
async function tileVerdictAfterStore(ctx: WorkerContext, draft: PatternDraftRecord, image: Buffer): Promise<SlotWorkResult["afterStore"]> {
  if (draft.composeType !== "REPEAT") return undefined;
  const verdict = await verifyTileableDetailed(image);
  return (candidateId) => writeTileableVerdict(ctx.repository, candidateId, verdict);
}

/** 起稿生成：按主题 + 多用途参考生成候选。参考确实作为图像输入下发；用途同时进入 Prompt 与快照。 */
export async function executeDraftGenerate(ctx: WorkerContext, job: JobRecord, signal: AbortSignal): Promise<void> {
  const { imageModelForJob, imageGeneratorFor, throwIfCancelled } = ctx;
  const { batch, draft, snapshot } = await loadBatchContext(ctx, job);
  throwIfCancelled(job);
  const { provider, model } = imageModelForJob(job);
  const generator = imageGeneratorFor(provider, model);
  const background = snapshot.background === "TRANSPARENT" ? "TRANSPARENT" : "WHITE";
  // 能力判定必须在第一次付费调用之前完成：不支持透明底的模型直接拒绝，用户不为注定被拒的请求付费。
  const backgroundPlan = resolvePatternBackground({ mode: background, model });
  const references = await readReferences(ctx, snapshot);
  // 能力判定必须在第一次付费调用之前完成：多参考图不被模型支持时直接拒绝，
  // 不静默只发第一张——那会让用户以为其余参考图参与了，实际没有。
  const capabilities = imageEditCapabilitiesFor(model);
  if (references.length > 1 && capabilities && !capabilities.supportsMultiReference) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持多参考图");
  const prompt = compileDraftGeneratePrompt({
    theme: snapshot.theme ?? "",
    composeType: draft.composeType,
    background,
    references: referenceHints(snapshot),
  });
  const aspectRatio = snapshot.aspectRatio ?? "1:1";
  const resolution = resolutionFromSnapshot(snapshot.imageResolution);
  const quality = qualityFromSnapshot(snapshot.quality) ?? DEFAULT_IMAGE_QUALITY;
  const size = resolveOpenAiImageSize(model.id, resolution, aspectRatio, "1024x1024");
  await runDraftSlots(ctx, job, batch, snapshot, async (slotIndex) => {
    const result = await runPaidDraftCall(ctx, job, () => generator.generate(model.imageApiKind === "gemini"
      ? { model: model.id, prompt, ...(references.length ? { images: references } : {}), imageAspectRatio: (aspectRatio === "AUTO" ? "1:1" : aspectRatio) as ImageAspectRatio, imageResolution: resolution, idempotencyKey: generationKeyFor(job.id, slotIndex), signal }
      : { model: model.id, prompt, ...openAiImageRequestParams(model.id, resolution, aspectRatio, "1024x1024", { quality }), ...(references.length ? { images: references } : {}), ...(backgroundPlan.transparent ?? {}), idempotencyKey: generationKeyFor(job.id, slotIndex), signal }));
    let warning: string | undefined;
    try { await verifyPatternBackground(backgroundPlan, result.image, "起稿"); } catch (error) { warning = errorMessage(error); }
    return { image: result.image, warning };
  });
}

/** 生成式改稿：改稿（可带选区）/ 接缝，基于父候选产生新候选并保留父候选。 */
export async function executeDraftEdit(ctx: WorkerContext, job: JobRecord, signal: AbortSignal): Promise<void> {
  const { imageModelForJob, imageGeneratorFor, throwIfCancelled, repository, storage } = ctx;
  const { batch, draft, snapshot } = await loadBatchContext(ctx, job);
  throwIfCancelled(job);
  const parentId = snapshot.parentCandidateId ?? (typeof job.input.parentCandidateId === "string" ? job.input.parentCandidateId : "");
  const parent = repository.getDraftCandidate(parentId);
  if (!parent) throw new Error("Draft edit job has no parent candidate snapshot");
  const parentImage = await storage.read(parent.storagePath);
  const { provider, model } = imageModelForJob(job);
  const generator = imageGeneratorFor(provider, model);
  const capabilities = imageEditCapabilitiesFor(model);
  if (!capabilities) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持图像编辑");
  const references = await readReferences(ctx, snapshot);
  const parentTransparent = await hasTransparentPixels(parentImage);
  const background = snapshot.background ?? (parentTransparent ? "TRANSPARENT" : "WHITE");
  const backgroundPlan = resolvePatternBackground({ mode: background, model, sourceTransparent: parentTransparent });
  const inputFidelity = highInputFidelityForOpenAiImageModel(model.id);
  const common = {
    model: model.id,
    // 分辨率/质量只在生成（executeDraftGenerate）消费：改稿与接缝的结果要叠回父候选做校验与合成，
    // 画布尺寸必须跟随父候选，贸然换档位会让坐标与验缝全部失配。
    ...(model.imageApiKind === "gemini" ? { imageAspectRatio: "1:1" as ImageAspectRatio, imageResolution: "1K" as ImageResolution } : {}),
    ...(inputFidelity ? { inputFidelity } : {}),
    ...(backgroundPlan.transparent ?? {}),
    signal,
  };

  if (batch.operation === "EDIT") {
    /*
     * 有笔迹就叠成源图，没有就对父候选本身改稿——这是"整图"与"按笔迹"唯一的区别。
     *
     * 两者曾在契约里是不同的操作，但除了"下发哪张源图"这一点之外行为完全一致，分开只会让两边
     * 各自漂移：改稿说明的措辞、参考图下发、候选数、REPEAT 验缝原本就已经共用同一套逻辑。
     */
    const annotationPath = snapshot.annotation?.storagePath;
    const sourceImage = annotationPath ? await paintOverImage(parentImage, await storage.read(annotationPath)) : parentImage;
    const prompt = compileDraftEditPrompt({
      annotated: Boolean(annotationPath),
      instruction: snapshot.instruction ?? "",
      // 底色要求和起稿走同一个来源：原色板提示词里那句写死的"保持透明"，现在由这里如实表达。
      background,
      references: referenceHints(snapshot),
    });

    assertEditCapabilities(capabilities, "SCENE_ADJUST", "MODEL_DIRECTED", false, references.length);
    await runDraftSlots(ctx, job, batch, snapshot, async (slotIndex) => {
      const result = await runPaidDraftCall(ctx, job, () => generator.editImage({ ...common, prompt, sourceImage: { data: sourceImage, filename: "candidate.png", mimeType: "image/png" }, ...(references.length ? { referenceImages: references } : {}), idempotencyKey: generationKeyFor(job.id, slotIndex) }));
      // 合成无从兜底：整张图都交给了模型，背景究竟有没有守住透明，只能靠这次校验如实报出来。
      let warning: string | undefined;
      try { await verifyPatternBackground(backgroundPlan, result.image, "衍生"); } catch (error) { warning = errorMessage(error); }
      return { image: result.image, warning, afterStore: await tileVerdictAfterStore(ctx, draft, result.image) };
    });
    return;
  }

  if (batch.operation === "SEAM_EDIT") {
    const edge = snapshot.seam?.edge === "TOP_BOTTOM" ? "TOP_BOTTOM" : "LEFT_RIGHT";
    const band = typeof snapshot.seam?.band === "number" && Number.isFinite(snapshot.seam.band) ? snapshot.seam.band : 48;
    const context = await buildSeamCanvas(parentImage, edge, band, DRAFT_SEAM_BAND_MAX);
    const prompt = compileSeamEditPrompt(edge, snapshot.instruction);
    await runDraftSlots(ctx, job, batch, snapshot, async (slotIndex) => {
      const result = await runPaidDraftCall(ctx, job, () => generator.editImage({ ...common, prompt, sourceImage: { data: context.canvas, filename: "seam-context.png", mimeType: "image/png" }, idempotencyKey: generationKeyFor(job.id, slotIndex) }));
      const repaired = await applySeamEdit(parentImage, result.image, context);
      // 每次修复都重新检测，且不继承原候选的通过状态；检测结论写在新候选上。
      const verdict = await verifyTileableDetailed(repaired);
      return { image: repaired, afterStore: (candidateId) => writeTileableVerdict(repository, candidateId, verdict) };
    });
    return;
  }

  // 这个执行器只接 EDIT 与 SEAM_EDIT（见 API 的 DRAFT_JOB_BY_OPERATION）。落到这里说明任务被派错了队列，
  // 明确报错而不是静默什么都不做——静默会让一个错误的映射看起来像"生成没出结果"。
  throw new Error(`UNSUPPORTED_OPERATION: 改稿执行器不支持 ${batch.operation}`);
}

/** 真实去底：用分割模型得到主体蒙版，像素取自父候选本身（PIXEL_PROTECTED），输出真实 alpha。 */
export async function executeDraftCutout(ctx: WorkerContext, job: JobRecord, signal: AbortSignal): Promise<void> {
  const { throwIfCancelled, repository, storage, providerFor, secrets } = ctx;
  const { batch, snapshot } = await loadBatchContext(ctx, job);
  throwIfCancelled(job);
  const segmentation = snapshot.segmentation;
  if (!segmentation || !isSegmentationProtocol(segmentation.protocol)) throw new Error("去底任务缺少分割模型快照");
  if (segmentation.protocol === "seedream_layerize") throw new Error("去底不支持 seedream_layerize 图层拆分协议");
  const parentId = snapshot.parentCandidateId ?? "";
  const parent = repository.getDraftCandidate(parentId);
  if (!parent) throw new Error("去底任务缺少父候选");
  const source = await storage.read(parent.storagePath);
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) throw new Error("Source image dimensions are unavailable");
  const provider = providerFor(segmentation.providerId);
  const imageUrl = `data:${mimeForStoragePath(parent.storagePath)};base64,${source.toString("base64")}`;
  const segmenter = createSegmentationProvider(segmentation.protocol, { baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) });
  const modelPath = segmentation.protocol === "fal" && segmentation.modelId.includes("/") ? segmentation.modelId : undefined;
  await runDraftSlots(ctx, job, batch, snapshot, async () => {
    const result = await runPaidDraftCall(ctx, job, () => segmenter.segment({ imageUrl, textPrompt: "the printed graphic artwork: the complete decorative pattern itself, not the product body, hardware, shadows or background", box: undefined, modelPath, signal }));
    const mask = await normalizeMask(result.mask, meta.width, meta.height);
    if (!maskHasForeground(mask)) throw new Error("未能在该候选上分割出图案主体，请更换参考或改用生成式去底");
    const rgba = await decodeRgba(source, meta.width, meta.height);
    // 保留原始画布尺寸（不 trim）：去底不应改变候选坐标，否则重复预览与蒙版坐标会失配。
    const cutout = await pngFromRgba(multiplyAlpha(rgba, mask), meta.width, meta.height);
    return { image: cutout };
  });
}

/** 本地确定性处理：调色（生成新候选）与验缝（只写判定，不改像素）。 */
export async function executeDraftProcess(ctx: WorkerContext, job: JobRecord): Promise<void> {
  const { throwIfCancelled, repository, storage, updateJob } = ctx;
  const input = job.input as DraftBatchJobInput & { candidateId?: unknown };
  throwIfCancelled(job);
  if (input.task === "TILE_CHECK") {
    const candidateId = requireString(input.candidateId, "Tile check job is missing its candidate id");
    const candidate = repository.getDraftCandidate(candidateId);
    if (!candidate) throw new Error(`Draft candidate ${candidateId} is missing for tile check`);
    const source = await storage.read(candidate.storagePath);
    await updateJob(job, { progress: 40 });
    const verdict = await verifyTileableDetailed(source);
    writeTileableVerdict(repository, candidate.id, verdict);
    await updateJob(job, { progress: 95 });
    return;
  }
  const { batch, snapshot } = await loadBatchContext(ctx, job);
  if (batch.operation !== "RECOLOR") throw new Error(`Unsupported draft process operation: ${batch.operation}`);
  const parentId = snapshot.parentCandidateId ?? "";
  const parent = repository.getDraftCandidate(parentId);
  if (!parent) throw new Error("调色任务缺少父候选");
  const parentImage = await storage.read(parent.storagePath);
  await runDraftSlots(ctx, job, batch, snapshot, async () => {
    await updateJob(job, { progress: 40 });
    const recolored = await applyRecolor(parentImage, snapshot.recolor ?? {});
    return { image: recolored };
  });
}
