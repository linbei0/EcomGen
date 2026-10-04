import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import type { DraftBatchRecord, DraftCandidateRecord, DraftMediaRecord, DraftSlotRecord, JobRecord, PatternDraftRecord } from "@ecomgen/core";
import type { EcomRepository, LocalAssetStore } from "@ecomgen/core";
import type { EcomJobKind } from "@ecomgen/jobs";
import { DRAFT_PROMPT_VERSION } from "@ecomgen/ecom-skill";
import {
  DRAFT_BATCH_OPERATIONS,
  DRAFT_COMPOSE_TYPES,
  DRAFT_MEDIA_ROLES,
  DRAFT_MEDIA_SOURCES,
  DRAFT_SEAM_BAND_MAX,
  DRAFT_SEAM_EDGES,
  MAX_DRAFT_INSTRUCTION_LENGTH,
  MAX_DRAFT_MEDIA_NOTES_LENGTH,
  MAX_PATTERN_BRIEF_LENGTH,
  MAX_PATTERN_DRAFT_NAME_LENGTH,
  PATTERN_DRAFT_CANDIDATES_MAX,
  PATTERN_DRAFT_ANNOTATIONS_MAX,
  PATTERN_DRAFT_REFERENCES_MAX,
  CreateDraftBatchInput,
  CreatePatternDraftInput,
  FinalizeDraftCandidateInput,
  UpdatePatternDraftInput,
  danglingDraftReferenceOrdinals,
  dispatchedReferenceOrdinals,
  findDraftReferences,
} from "@ecomgen/contracts";
import type {
  CreateDraftBatchResponse,
  DraftBatch,
  DraftBatchOperation,
  DraftCandidate,
  DraftComposeType,
  DraftConditions,
  DraftJobRef,
  DraftMedia,
  DraftSlot,
  FinalizeDraftCandidateResponse,
  PatternDraft,
  SegmentationProtocol,
} from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import { assertTransparentBackground, contentHash, missing, readImageMultipart, resolveSegmentationModel, sendStored, verifyModel } from "../helpers.js";
import { parseBody } from "../http-input.js";
import { enumValue, parameter, readObject, readOptionalText, readPatchText, readText } from "../input-normalizers.js";
import { publicPattern } from "./patterns.js";

/** 批次操作 → 任务类型与队列 kind；映射必须完整，否则新操作会静默落到错误队列。 */
const DRAFT_JOB_BY_OPERATION: Record<DraftBatchOperation, { type: "PATTERN_DRAFT_GENERATE" | "PATTERN_DRAFT_EDIT" | "PATTERN_DRAFT_CUTOUT" | "PATTERN_DRAFT_PROCESS"; kind: EcomJobKind }> = {
  GENERATE: { type: "PATTERN_DRAFT_GENERATE", kind: "pattern_draft_generate" },
  EDIT: { type: "PATTERN_DRAFT_EDIT", kind: "pattern_draft_edit" },
  SEAM_EDIT: { type: "PATTERN_DRAFT_EDIT", kind: "pattern_draft_edit" },
  CUTOUT: { type: "PATTERN_DRAFT_CUTOUT", kind: "pattern_draft_cutout" },
  RECOLOR: { type: "PATTERN_DRAFT_PROCESS", kind: "pattern_draft_process" },
};

function defaultDraftName(): string {
  return `未命名草稿 · ${new Date().toISOString().slice(0, 10)}`;
}

function defaultConditions(): DraftConditions {
  return { theme: "", aspectRatio: "1:1", background: "WHITE", candidateCount: 1 };
}

/**
 * 条件来自前端表单，由 parseBody 按契约校验过枚举与上限；这里只做契约不负责的两件事：
 * 把省略字段补成可用默认值（TypeBox 的 Check 不物化 default），以及把候选数取整。
 */
function normalizeConditions(input: DraftConditions): DraftConditions {
  const bounded = (value: string | undefined, max: number, field: string): string => {
    const text = value ?? "";
    if (text.length > max) throw new ApiError(400, "VALIDATION_ERROR", `${field} must be at most ${max} characters`);
    return text;
  };
  const candidateCount = Math.round(Number(input.candidateCount));
  if (!Number.isInteger(candidateCount) || candidateCount < 1 || candidateCount > PATTERN_DRAFT_CANDIDATES_MAX) {
    throw new ApiError(400, "VALIDATION_ERROR", `conditions.candidateCount must be between 1 and ${PATTERN_DRAFT_CANDIDATES_MAX}`);
  }
  return {
    theme: bounded(input.theme, MAX_PATTERN_BRIEF_LENGTH, "conditions.theme"),
    aspectRatio: input.aspectRatio,
    ...(input.imageResolution ? { imageResolution: input.imageResolution } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    background: input.background,
    candidateCount,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.imageModelId ? { imageModelId: input.imageModelId } : {}),
    ...(input.repeatLayout ? { repeatLayout: input.repeatLayout } : {}),
  };
}

function candidateUrl(draftId: string, candidateId: string): string {
  return `/api/v1/files/pattern-drafts/${draftId}/candidates/${candidateId}`;
}

function publicDraft(record: PatternDraftRecord, summary?: { count: number; latest: DraftCandidateRecord }): PatternDraft {
  return {
    id: record.id,
    name: record.name,
    composeType: record.composeType,
    conditions: record.conditions as DraftConditions,
    revision: record.revision,
    selectedCandidateId: record.selectedCandidateId,
    compareCandidateId: record.compareCandidateId,
    archivedAt: record.archivedAt,
    candidateCount: summary?.count ?? 0,
    // 列表卡片只显示小图；候选的原始像素仍走 candidateUrl。
    previewUrl: summary ? thumbnailUrl(summary.latest.fileHash) : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** 单份草稿的预览摘要；草稿新建或尚无候选时返回 undefined（视图落成 0 / null）。 */
function draftSummary(repository: EcomRepository, draftId: string): { count: number; latest: DraftCandidateRecord } | undefined {
  return repository.summarizeDraftCandidates([draftId]).get(draftId);
}

function mediaUrl(draftId: string, mediaId: string): string {
  return `/api/v1/files/pattern-drafts/${draftId}/media/${mediaId}`;
}

/** 缩略图按内容 hash 寻址：列表与轨道只需小图，避免每张卡都拉全分辨率 PNG。 */
function thumbnailUrl(fileHash: string): string {
  return `/api/v1/files/thumbnails/${fileHash}`;
}

function publicMedia(record: DraftMediaRecord): DraftMedia {
  return {
    id: record.id,
    draftId: record.draftId,
    role: record.role,
    source: record.source,
    sourcePatternId: record.sourcePatternId,
    ordinal: record.ordinal,
    url: mediaUrl(record.draftId, record.id),
    thumbUrl: thumbnailUrl(record.fileHash),
    fileName: record.originalName,
    mimeType: record.mimeType,
    width: record.width,
    height: record.height,
    notes: record.notes,
    createdAt: record.createdAt,
  };
}

function publicCandidate(record: DraftCandidateRecord): DraftCandidate {
  return {
    id: record.id,
    draftId: record.draftId,
    batchId: record.batchId,
    slotIndex: record.slotIndex,
    parentCandidateId: record.parentCandidateId,
    url: candidateUrl(record.draftId, record.id),
    thumbUrl: thumbnailUrl(record.fileHash),
    width: record.width,
    height: record.height,
    mimeType: record.mimeType,
    transform: record.transform,
    hasAlpha: record.hasAlpha,
    tileable: {
      status: record.tileable,
      score: record.tileableScore,
      algorithmVersion: record.tileableCheckedWith,
      horizontal: record.tileableHorizontal,
      vertical: record.tileableVertical,
    },
    createdAt: record.createdAt,
  };
}

function publicJobRef(job: JobRecord): DraftJobRef {
  return { id: job.id, type: job.type, status: job.status, progress: job.progress };
}

function publicBatch(batch: DraftBatchRecord, slots: DraftSlotRecord[], candidates: DraftCandidateRecord[], jobs: ReadonlyMap<string, JobRecord>): DraftBatch {
  const candidateBySlot = new Map(candidates.map((candidate) => [candidate.slotIndex, candidate]));
  const latest = latestSlotJob(slots, jobs);
  const publicSlots: DraftSlot[] = slots.map((slot) => ({
    index: slot.index,
    status: slot.status,
    attempt: slot.attempt,
    jobId: slot.jobId,
    candidateId: candidateBySlot.get(slot.index)?.id ?? null,
    error: slot.error,
    updatedAt: slot.updatedAt,
  }));
  return {
    id: batch.id,
    draftId: batch.draftId,
    operation: batch.operation,
    parentCandidateId: batch.parentCandidateId,
    providerId: batch.providerId,
    imageModelId: batch.imageModelId,
    candidateCount: batch.candidateCount,
    instruction: batch.instruction,
    estimatedCost: latest?.estimatedCost ?? null,
    actualCost: latest?.actualCost ?? null,
    snapshot: batch.snapshot,
    createdAt: batch.createdAt,
    slots: publicSlots,
  };
}

function ensureDraft(repository: EcomRepository, id: string): PatternDraftRecord {
  const draft = repository.getPatternDraft(id);
  if (!draft) missing("pattern draft", id);
  return draft;
}

function ensureDraftBatch(repository: EcomRepository, draftId: string, batchId: string): DraftBatchRecord {
  const batch = repository.getDraftBatch(batchId);
  if (!batch || batch.draftId !== draftId) missing("draft batch", batchId);
  return batch;
}

function ensureDraftCandidate(repository: EcomRepository, draftId: string, candidateId: string): DraftCandidateRecord {
  const candidate = repository.getDraftCandidate(candidateId);
  if (!candidate || candidate.draftId !== draftId) missing("draft candidate", candidateId);
  return candidate;
}

function ensureDraftMedia(repository: EcomRepository, draftId: string, mediaId: string): DraftMediaRecord {
  const media = repository.getDraftMedia(mediaId);
  if (!media || media.draftId !== draftId) missing("draft media", mediaId);
  return media;
}

interface DraftReferenceRow {
  media: DraftMediaRecord;
  ordinal: number;
}

/**
 * 草稿内全部可被引用的参考图。
 *
 * 参考图在创建时就拿到引用编号（笔迹不参与引用、编号为 null），缺失说明数据异常；
 * 这里宁可拒绝也不静默少发——少发一张，提示词里的 Image 号就和界面上的「图N」对不上了。
 */
function draftReferenceRows(repository: EcomRepository, draft: PatternDraftRecord): DraftReferenceRow[] {
  return repository.listDraftMedia(draft.id).flatMap((media) => {
    if (media.role !== "REFERENCE") return [];
    if (media.ordinal === null) throw new ApiError(409, "CONFLICT", `参考图 ${media.originalName} 缺少引用编号，请重新上传后再提交`);
    return [{ media, ordinal: media.ordinal }];
  });
}

/**
 * 收掉已经用不到的改稿笔迹。
 *
 * 笔迹是提交一次改稿的中间物，界面上既看不到也删不掉，额度就只能自己回收——否则改到第 N 次
 * 用户会撞上一句"最多保留 N 张"，却没有任何办法腾出位置。
 *
 * 判据是"还有没有任务会读它"：批次槽位全部走到 SUCCEEDED/CANCELLED 之后，补偿只领 FAILED 槽位，
 * 这张笔迹不会再被任何一次重跑读到，可以从磁盘上撤走。反过来，只要有槽位在跑或还能补偿，
 * 文件就必须留在原地——删了它，那次补偿会以"文件不存在"失败。
 * 还没有任何批次引用的上传（提交失败留下的残留）同样收掉：界面上重试会重新上传一张。
 *
 * 这与媒体删除路由的「被快照引用就不删」是有意的分工：参考图是重跑的输入必须留，
 * 笔迹是一次性中间物，批次全部终态后继续留着只会吃满改稿额度。
 */
async function pruneDraftAnnotations(repository: EcomRepository, storage: LocalAssetStore, draftId: string): Promise<void> {
  const annotations = repository.listDraftMedia(draftId).filter((media) => media.role === "ANNOTATION");
  if (!annotations.length) return;
  const pendingPaths = new Set<string>();
  for (const batch of repository.listDraftBatches(draftId)) {
    const path = (batch.snapshot as { annotation?: { storagePath?: string } | null }).annotation?.storagePath;
    if (!path) continue;
    const stillNeeded = repository.listDraftSlots(batch.id).some((slot) => slot.status === "QUEUED" || slot.status === "RUNNING" || slot.status === "FAILED");
    if (stillNeeded) pendingPaths.add(path);
  }
  for (const media of annotations) {
    if (pendingPaths.has(media.storagePath)) continue;
    repository.deleteDraftMedia(media.id);
    await storage.delete(media.storagePath);
  }
}

/**
 * 参考快照：本轮实际下发的参考图，由操作与文本推导，调用方不参与选择。
 *
 * 顺序按编号升序，客户端传参顺序不参与——模型看到的 Image 号必须和界面上的「图N」对得上，
 * 否则同一份输入换个提交顺序就会得到不同的提示词。引用编号在草稿里不存在时拒绝整次提交，
 * 而不是静默丢弃，理由同上；一次下发超过上限也拒绝，因为按编号取舍等于替用户挑图。
 */
function resolveDispatchedReferences(rows: DraftReferenceRow[], body: CreateDraftBatchInput, operation: DraftBatchOperation): Array<{ mediaId: string; ordinal: number; storagePath: string; mimeType: string; notes: string | null }> {
  const byOrdinal = new Map(rows.map((row) => [row.ordinal, row.media]));
  const ordinals = dispatchedReferenceOrdinals({
    operation,
    instruction: body.instruction,
    availableOrdinals: rows.map((row) => row.ordinal),
  });
  if (ordinals.length > PATTERN_DRAFT_REFERENCES_MAX) {
    // 起稿下发的就是全部参考图，超限只能删图；改稿超限是说明里 @ 得太多，删图没有用。
    const hint = operation === "EDIT" ? "请减少改稿说明里引用的参考图" : "请先删除多余的参考图";
    throw new ApiError(400, "VALIDATION_ERROR", `一次最多下发 ${PATTERN_DRAFT_REFERENCES_MAX} 张参考图，${hint}`);
  }
  return ordinals.map((ordinal) => {
    const media = byOrdinal.get(ordinal);
    if (!media) throw new ApiError(400, "VALIDATION_ERROR", `引用的参考图不存在：@图${ordinal}，请从参考图列表里重新选择`);
    return { mediaId: media.id, ordinal, storagePath: media.storagePath, mimeType: media.mimeType, notes: media.notes };
  });
}

/**
 * 提交前的引用校验：文本里出现的 `@图N` 必须在草稿里真实存在。
 *
 * 只在提交时校验，不在自动保存时校验——用户打出 `@图` 到从下拉里选完之间存在半成品状态，
 * 那时拒绝会让输入框没法用。这里失败要指名道姓说是哪个编号，用户才能改对。
 */
function assertReferenceText(text: string | null | undefined, availableOrdinals: readonly number[]): void {
  const dangling = danglingDraftReferenceOrdinals(text ?? "", availableOrdinals);
  if (dangling.length) {
    throw new ApiError(400, "VALIDATION_ERROR", `引用的参考图不存在：${dangling.map((ordinal) => `@图${ordinal}`).join("、")}，请从参考图列表里重新选择`);
  }
}

/**
 * 尊重"候选数"滑杆的操作。
 *
 * 生成式改稿与起稿一样有随机性，多给几张才有得挑；RECOLOR 是确定性 HSL 调制、CUTOUT 是分割，
 * 出 N 张等于同一张，固定 1 张，不做无谓的付费调用。
 */
const REPEATABLE_OPERATIONS = new Set<DraftBatchOperation>(["GENERATE", "EDIT", "SEAM_EDIT"]);

/** 备注会逐条进提示词，长度必须与改稿指令一样有界；上限与前端计数器共用同一个常量。 */
function assertNotesLength(notes: string | null): void {
  if (notes && notes.length > MAX_DRAFT_MEDIA_NOTES_LENGTH) throw new ApiError(400, "VALIDATION_ERROR", `notes must be at most ${MAX_DRAFT_MEDIA_NOTES_LENGTH} characters`);
}

/**
 * 校验批次的操作级必填项；不做能力猜测，只拒绝结构上不可能成立的组合。
 *
 * 父候选按**解析后**的值判断：改稿路由的父候选来自路径参数，只查 body 会让那条路由
 * 依赖前端把 id 再抄一份进 body 才能通过，抄漏了就报"需要指定父候选"。
 */
function validateOperationInput(body: CreateDraftBatchInput, parentCandidateId: string | null): void {
  if (body.operation !== "GENERATE" && !parentCandidateId) throw new ApiError(400, "VALIDATION_ERROR", `${body.operation} 需要指定父候选`);
  // 笔迹是**可选**的：不给就是对整张图改稿，也就是过去的"整图修改"。曾经的 EDIT_WHOLE/EDIT_LOCAL
  // 两个操作除这一点外行为一致，拆开只会让两侧各自漂移，所以合并成一个 EDIT。
  if (body.operation === "EDIT" && !body.instruction?.trim()) throw new ApiError(400, "VALIDATION_ERROR", "改稿需要一句说明");
  // 只有改稿读笔迹；其他操作带着它只会静默无效，快照里还会留一份误导性记录。
  if (body.annotationMediaId && body.operation !== "EDIT") throw new ApiError(400, "VALIDATION_ERROR", "只有改稿操作接受笔迹，其他操作不会读取它");
  if (body.operation === "SEAM_EDIT" && !body.seam) throw new ApiError(400, "VALIDATION_ERROR", "接缝改稿需要指定目标边与带宽");
  if (body.seam && body.seam.band > DRAFT_SEAM_BAND_MAX) throw new ApiError(400, "VALIDATION_ERROR", `接缝带宽不能超过 ${DRAFT_SEAM_BAND_MAX}px`);
  if (body.instruction && body.instruction.length > MAX_DRAFT_INSTRUCTION_LENGTH) throw new ApiError(400, "VALIDATION_ERROR", `instruction must be at most ${MAX_DRAFT_INSTRUCTION_LENGTH} characters`);
  if (body.operation === "GENERATE" && !body.theme?.trim()) throw new ApiError(400, "VALIDATION_ERROR", "起稿需要一个创作主题");
  const generative = body.operation !== "RECOLOR";
  if (generative && (!body.providerId || !body.imageModelId)) throw new ApiError(400, "VALIDATION_ERROR", "生成式操作需要选择模型");
}

export function registerPatternDraftRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, storage, enqueueOrMarkFailed } = ctx;

  // ---- 草稿生命周期 ----
  app.get("/api/v1/pattern-drafts", async (request) => {
    const includeArchived = (request.query as Record<string, unknown> | undefined)?.archived !== undefined;
    const drafts = repository.listPatternDrafts(includeArchived);
    const summaries = repository.summarizeDraftCandidates(drafts.map((draft) => draft.id));
    return { items: drafts.map((draft) => publicDraft(draft, summaries.get(draft.id))) };
  });

  app.post("/api/v1/pattern-drafts", async (request, reply) => {
    const body = parseBody(CreatePatternDraftInput, request.body ?? {});
    const composeType: DraftComposeType = body.composeType ?? "PLACEMENT";
    enumValue(composeType, DRAFT_COMPOSE_TYPES, "composeType");
    const name = body.name === undefined ? defaultDraftName() : readText(body.name, "name");
    if (name.length > MAX_PATTERN_DRAFT_NAME_LENGTH) throw new ApiError(400, "VALIDATION_ERROR", `name must be at most ${MAX_PATTERN_DRAFT_NAME_LENGTH} characters`);
    const draft = repository.createPatternDraft({ name, composeType, conditions: defaultConditions() });
    return reply.code(201).send(publicDraft(draft));
  });

  app.get("/api/v1/pattern-drafts/:draftId", async (request) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    return publicDraft(draft, draftSummary(repository, draft.id));
  });

  app.patch("/api/v1/pattern-drafts/:draftId", async (request) => {
    const current = ensureDraft(repository, parameter(request, "draftId"));
    const body = parseBody(UpdatePatternDraftInput, request.body);
    const patch: Partial<Pick<PatternDraftRecord, "name" | "conditions" | "selectedCandidateId" | "compareCandidateId" | "archivedAt">> = {};
    if (body.name !== undefined) {
      const name = readText(body.name, "name");
      if (name.length > MAX_PATTERN_DRAFT_NAME_LENGTH) throw new ApiError(400, "VALIDATION_ERROR", `name must be at most ${MAX_PATTERN_DRAFT_NAME_LENGTH} characters`);
      patch.name = name;
    }
    if (body.conditions !== undefined) patch.conditions = normalizeConditions(body.conditions);
    if (body.selectedCandidateId !== undefined) {
      if (body.selectedCandidateId !== null) ensureDraftCandidate(repository, current.id, body.selectedCandidateId);
      patch.selectedCandidateId = body.selectedCandidateId;
    }
    if (body.compareCandidateId !== undefined) {
      if (body.compareCandidateId !== null) ensureDraftCandidate(repository, current.id, body.compareCandidateId);
      patch.compareCandidateId = body.compareCandidateId;
    }
    if (body.archived !== undefined) patch.archivedAt = body.archived ? new Date().toISOString() : null;
    const result = repository.updatePatternDraft(current.id, patch, body.expectedRevision);
    if (result.status === "missing") missing("pattern draft", current.id);
    // 冲突带服务端版本号：前端据此保留未保存内容并提示重新加载/合并，而不是静默覆盖。
    if (result.status === "conflict") throw new ApiError(409, "CONFLICT", `草稿已在别处更新（服务端版本 ${result.draft.revision}）`, [{ path: "expectedRevision", reason: `server revision is ${result.draft.revision}` }]);
    return publicDraft(result.draft, draftSummary(repository, result.draft.id));
  });

  app.delete("/api/v1/pattern-drafts/:draftId", async (request, reply) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    const activeJobs = activeDraftJobs(repository, draft.id);
    if (activeJobs.length) {
      // 删除先在途任务：请求取消后不阻塞等待终态，返回 409 让前端稍后重试；草稿数据此时保持完整。
      for (const job of activeJobs) await ctx.requestJobCancellation(job.id);
      throw new ApiError(409, "CONFLICT", "草稿仍有在途任务，已请求取消，请稍后重试删除");
    }
    // 先删数据库行（级联清空批次/槽位/候选/媒体），再清理目录；顺序反过来会让记录指向已删文件。
    repository.deletePatternDraft(draft.id);
    await storage.deleteDraft(draft.id);
    return reply.code(204).send();
  });

  // ---- 参考与笔迹媒体 ----
  app.get("/api/v1/pattern-drafts/:draftId/media", async (request) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    return { items: repository.listDraftMedia(draft.id).map(publicMedia) };
  });

  app.post("/api/v1/pattern-drafts/:draftId/media", async (request, reply) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    const { upload, fields } = await readImageMultipart(request);
    const role = enumValue(fields.role, DRAFT_MEDIA_ROLES, "role");
    const source = fields.source === undefined ? "UPLOAD" : enumValue(fields.source, DRAFT_MEDIA_SOURCES, "source");
    const notes = readOptionalText(fields.notes) ?? null;
    assertNotesLength(notes);
    if (role === "REFERENCE" && repository.countDraftMedia(draft.id, "REFERENCE") >= PATTERN_DRAFT_REFERENCES_MAX) {
      throw new ApiError(400, "VALIDATION_ERROR", `草稿最多保留 ${PATTERN_DRAFT_REFERENCES_MAX} 张参考图`);
    }
    if (role === "ANNOTATION") {
      await pruneDraftAnnotations(repository, storage, draft.id);
      if (repository.countDraftMedia(draft.id, "ANNOTATION") >= PATTERN_DRAFT_ANNOTATIONS_MAX) {
        throw new ApiError(400, "VALIDATION_ERROR", `草稿最多保留 ${PATTERN_DRAFT_ANNOTATIONS_MAX} 张改稿笔迹`);
      }
    }

    let content: Buffer;
    let originalName: string;
    let mimeType: string;
    let sourcePatternId: string | null = null;
    if (source === "PATTERN") {
      const patternId = readText(fields.patternId, "patternId");
      const pattern = repository.getPattern(patternId);
      if (!pattern) missing("pattern", patternId);
      if (!pattern.storagePath) throw new ApiError(409, "CONFLICT", "该花型还没有可用的图稿，无法作为参考");
      sourcePatternId = pattern.id;
      content = await storage.read(pattern.storagePath);
      originalName = `${pattern.name}.png`;
      mimeType = "image/png";
    } else {
      if (!upload) throw new ApiError(400, "VALIDATION_ERROR", "需要上传文件或引用已有花型");
      content = upload.buffer;
      originalName = upload.filename;
      mimeType = upload.mimetype;
    }
    // 统一归一化为 PNG：笔迹坐标与后续解码依赖可预测的容器，客户端声明的 mime 不可信。
    // 一次编码顺手取回宽高：再单独解一次图只为量尺寸，等于把同一张图解码两遍。
    const { data: png, info } = await sharp(content).png().toBuffer({ resolveWithObject: true });
    const stored = await storage.putDraftMedia(draft.id, role, originalName, png);
    const media = repository.createDraftMedia({ draftId: draft.id, role, source, sourcePatternId, storagePath: stored.path, fileHash: stored.hash, mimeType: "image/png", width: info.width ?? null, height: info.height ?? null, originalName, notes });
    return reply.code(201).send(publicMedia(media));
  });

  app.patch("/api/v1/pattern-drafts/:draftId/media/:mediaId", async (request) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    const media = ensureDraftMedia(repository, draft.id, parameter(request, "mediaId"));
    const body = readObject(request.body ?? {}, "body");
    const patch: { notes?: string | null } = {};
    if (body.notes !== undefined) {
      const notes = readPatchText(body.notes, "notes") ?? null;
      assertNotesLength(notes);
      patch.notes = notes;
    }
    const updated = repository.updateDraftMedia(media.id, patch);
    if (!updated) missing("draft media", media.id);
    return publicMedia(updated);
  });

  app.delete("/api/v1/pattern-drafts/:draftId/media/:mediaId", async (request, reply) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    const media = ensureDraftMedia(repository, draft.id, parameter(request, "mediaId"));
    // 被任何已提交批次快照引用过的文件不在这里物理删除：在途批次的重跑或补偿要重读它，
    // 历史回放也要能重现当时下发的输入。笔迹额外的回收（批次全部终态后）由上传路由的
    // pruneDraftAnnotations 负责，那是一次性中间物的额度回收，与这条规则是有意的分工。
    const referenced = repository.isDraftStoragePathReferenced(draft.id, media.storagePath);
    repository.deleteDraftMedia(media.id);
    if (!referenced) await storage.delete(media.storagePath);
    return reply.code(204).send();
  });

  // ---- 批次、候选、改稿 ----
  app.get("/api/v1/pattern-drafts/:draftId/batches", async (request) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    const batches = repository.listDraftBatches(draft.id).map((batch) => ({ batch, slots: repository.listDraftSlots(batch.id) }));
    const jobs = repository.listJobsByIds(batches.flatMap(({ slots }) => slots.flatMap((slot) => (slot.jobId ? [slot.jobId] : []))));
    const items = batches.map(({ batch, slots }) => publicBatch(batch, slots, repository.listDraftCandidatesByBatch(batch.id), jobs));
    return { items };
  });

  app.get("/api/v1/pattern-drafts/:draftId/candidates", async (request) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    return { items: repository.listDraftCandidates(draft.id).map(publicCandidate) };
  });

  /**
   * 删除单个候选：候选是探索结果，允许用户清理不要的那几张。
   *
   * 有两条硬约束：所属批次还在跑时拒绝（重跑会把删掉的槽位重新生成，等于替用户付费）；
   * 被在途批次当父图引用时拒绝（worker 正要读它的像素）。已定稿的正式花型是独立拷贝，不受影响。
   */
  app.delete("/api/v1/pattern-drafts/:draftId/candidates/:candidateId", async (request, reply) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    const candidate = ensureDraftCandidate(repository, draft.id, parameter(request, "candidateId"));
    const activeSlot = repository.listDraftSlots(candidate.batchId).some((slot) => slot.status === "QUEUED" || slot.status === "RUNNING");
    if (activeSlot) throw new ApiError(409, "CONFLICT", "本批仍在生成中，等本批结束后再删除候选");
    const activeParent = repository.listDraftParentBatches(draft.id, candidate.id)
      .some((batchId) => repository.listDraftSlots(batchId).some((slot) => slot.status === "QUEUED" || slot.status === "RUNNING"));
    if (activeParent) throw new ApiError(409, "CONFLICT", "该候选正被一轮进行中的改稿使用，等它结束后再删除");
    const storedPath = candidate.storagePath;
    if (!repository.deleteDraftCandidate(candidate.id)) missing("draft candidate", candidate.id);
    // 候选可以物理删除：快照里候选只以 id 出现（parentCandidateId），从不携带它的存储路径，
    // 且父候选行已随之删除，worker 改稿时查不到父候选就会直接失败，保留像素没有任何读取方。
    await storage.delete(storedPath);
    return reply.code(204).send();
  });

  app.post("/api/v1/pattern-drafts/:draftId/batches", async (request, reply) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    const body = parseBody(CreateDraftBatchInput, request.body);
    const outcome = await submitDraftBatch(draft, body, undefined);
    return reply.code(202).send(outcome);
  });

  app.post("/api/v1/pattern-drafts/:draftId/batches/:batchId/retry-failed", async (request, reply) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    const batch = ensureDraftBatch(repository, draft.id, parameter(request, "batchId"));
    const allSlots = repository.listDraftSlots(batch.id);
    const failed = allSlots.filter((slot) => slot.status === "FAILED");
    const allJobs = slotJobs(repository, allSlots);
    const activeJob = allSlots
      .map((slot) => (slot.jobId ? allJobs.get(slot.jobId) : undefined))
      .find((job) => job?.status === "QUEUED" || job?.status === "RUNNING");
    if (!failed.length) {
      // 重复点击时失败槽位已被上一次补偿排入队列：复用同一在途任务，绝不新建第二次付费调用。
      if (activeJob) return reply.code(202).send({ batch: publicBatch(batch, allSlots, repository.listDraftCandidatesByBatch(batch.id), allJobs), job: publicJobRef(activeJob), reused: true });
      throw new ApiError(409, "CONFLICT", "该批次没有失败槽位");
    }
    const mapping = DRAFT_JOB_BY_OPERATION[batch.operation];
    const slots = failed.map((slot) => slot.index);
    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: mapping.type, input: { draftId: draft.id, batchId: batch.id, slots, task: "BATCH", retry: true }, requestFingerprint: null, providerId: batch.providerId, modelId: batch.imageModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    repository.assignDraftSlotsToJob(batch.id, slots, job.id, true);
    await enqueueOrMarkFailed(job, mapping.kind, { onFail: (jobId) => markDraftSlotsFailed(repository, batch.id, slots, jobId) });
    // 槽位刚被重新指派到新任务，读回最新的 jobId 再组装响应。
    const updatedSlots = repository.listDraftSlots(batch.id);
    return reply.code(202).send({ batch: publicBatch(batch, updatedSlots, repository.listDraftCandidatesByBatch(batch.id), slotJobs(repository, updatedSlots)), job: publicJobRef(job), reused: false });
  });

  // 改稿：与批次同语义，只是父候选由路径参数固定，避免前端漏传/错传。
  app.post("/api/v1/pattern-drafts/:draftId/candidates/:candidateId/edits", async (request, reply) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    const candidate = ensureDraftCandidate(repository, draft.id, parameter(request, "candidateId"));
    const body = parseBody(CreateDraftBatchInput, request.body);
    const outcome = await submitDraftBatch(draft, body, candidate.id);
    return reply.code(202).send(outcome);
  });

  // 验缝：本地确定性任务，只写判定与逐轴证据，不改候选像素。
  app.post("/api/v1/pattern-drafts/:draftId/candidates/:candidateId/tile-check", async (request, reply) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    const candidate = ensureDraftCandidate(repository, draft.id, parameter(request, "candidateId"));
    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: "PATTERN_DRAFT_PROCESS", input: { draftId: draft.id, candidateId: candidate.id, task: "TILE_CHECK" }, requestFingerprint: null, providerId: null, modelId: null, estimatedCost: null });
    await enqueueOrMarkFailed(job, "pattern_draft_process");
    return reply.code(202).send(publicJobRef(job));
  });

  // 定稿：把用户明确选定的候选复制为正式花型；幂等、不启动任何生产流水线。
  app.post("/api/v1/pattern-drafts/:draftId/candidates/:candidateId/finalize", async (request, reply) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    const candidate = ensureDraftCandidate(repository, draft.id, parameter(request, "candidateId"));
    const body = parseBody(FinalizeDraftCandidateInput, request.body);
    const existing = repository.getPatternByDraftCandidateId(candidate.id);
    if (existing) return reply.code(200).send({ pattern: publicPattern(existing), reused: true } satisfies FinalizeDraftCandidateResponse);
    const name = body.name === undefined ? `${draft.name} 定稿` : readText(body.name, "name");
    if (name.length > MAX_PATTERN_DRAFT_NAME_LENGTH) throw new ApiError(400, "VALIDATION_ERROR", `name must be at most ${MAX_PATTERN_DRAFT_NAME_LENGTH} characters`);
    const bytes = await storage.read(candidate.storagePath);
    // 读文件期间草稿可能被删除：落库前再确认候选仍在，且中间不 await，避免引用已删候选。
    if (!repository.getDraftCandidate(candidate.id)) throw new ApiError(409, "CONFLICT", "候选已被删除，无法定稿");
    const patternId = randomUUID();
    const stored = await storage.putPatternArtifact(patternId, "pattern", bytes);
    const latestJobId = repository.listDraftSlots(candidate.batchId).map((slot) => slot.jobId).filter((id): id is string => Boolean(id)).at(-1) ?? null;
    const pattern = repository.createPattern({
      id: patternId,
      name,
      sourceType: "GENERATED",
      sourceJobId: latestJobId,
      sourceAssetHash: candidate.fileHash,
      parentPatternId: null,
      storagePath: stored.path,
      fileHash: stored.hash,
      width: candidate.width,
      height: candidate.height,
      tags: [],
      // 定稿保留真实接缝状态：未通过也不伪装成合格，是否放行生产由独立流程判断。
      sourceDraftCandidateId: candidate.id,
      tileable: candidate.tileable,
      tileableScore: candidate.tileableScore,
      tileableCheckedWith: candidate.tileableCheckedWith,
    });
    repository.setPatternDraftSelectedCandidate(draft.id, candidate.id);
    return reply.code(201).send({ pattern: publicPattern(pattern), reused: false } satisfies FinalizeDraftCandidateResponse);
  });

  // ---- 文件 ----
  app.get("/api/v1/files/pattern-drafts/:draftId/candidates/:candidateId", async (request, reply) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    const candidate = ensureDraftCandidate(repository, draft.id, parameter(request, "candidateId"));
    return sendStored(request, reply, storage, { storagePath: candidate.storagePath, mimeType: candidate.mimeType, hash: candidate.fileHash }, "draft candidate", candidate.id, { filename: `${draft.name}-候选${candidate.slotIndex}.png` });
  });

  app.get("/api/v1/files/pattern-drafts/:draftId/media/:mediaId", async (request, reply) => {
    const draft = ensureDraft(repository, parameter(request, "draftId"));
    const media = ensureDraftMedia(repository, draft.id, parameter(request, "mediaId"));
    return sendStored(request, reply, storage, { storagePath: media.storagePath, mimeType: media.mimeType, hash: media.fileHash }, "draft media", media.id, { filename: media.originalName });
  });

  /** 提交批次：批次、槽位、任务与入队要么一起成立，要么在参数校验阶段就失败（不落半个批次）。 */
  async function submitDraftBatch(draft: PatternDraftRecord, body: CreateDraftBatchInput, parentOverride: string | undefined): Promise<CreateDraftBatchResponse> {
    const operation = enumValue(body.operation, DRAFT_BATCH_OPERATIONS, "operation");
    const parentCandidateId = parentOverride ?? body.parentCandidateId ?? null;
    validateOperationInput(body, parentCandidateId);
    if (parentCandidateId) ensureDraftCandidate(repository, draft.id, parentCandidateId);
    const requestedCount = typeof body.candidateCount === "number" && Number.isFinite(body.candidateCount) ? body.candidateCount : 1;
    const candidateCount = REPEATABLE_OPERATIONS.has(operation) ? Math.min(PATTERN_DRAFT_CANDIDATES_MAX, Math.max(1, Math.round(requestedCount))) : 1;
    const generative = operation !== "RECOLOR";
    let segmentation: { providerId: string; modelId: string; protocol: SegmentationProtocol } | null = null;
    if (operation === "CUTOUT") {
      segmentation = resolveSegmentationModel(repository, body.providerId, body.imageModelId, "去底");
    } else if (generative) {
      // 模型必须真实存在且声明了 images 接口，否则任务只会在 Worker 里失败；入队前就拒绝。
      verifyModel(repository, body.providerId ?? null, body.imageModelId ?? null, "image");
      assertTransparentBackground(repository, body.providerId, body.imageModelId, body.background);
    }
    const referenceRows = draftReferenceRows(repository, draft);
    const annotation = body.annotationMediaId ? (() => {
      const media = ensureDraftMedia(repository, draft.id, body.annotationMediaId!);
      if (media.role !== "ANNOTATION") throw new ApiError(400, "VALIDATION_ERROR", "改稿的笔迹必须是笔迹类型媒体");
      return { mediaId: media.id, storagePath: media.storagePath, mimeType: media.mimeType };
    })() : null;
    const references = resolveDispatchedReferences(referenceRows, body, operation);
    /*
     * 文本校验按操作分开：起稿看主题；RECOLOR / CUTOUT 不使用文本，不校验。
     *
     * 改稿不需要再查：它唯一的下发规则是"说明里 @ 到的"，悬空编号在解析下发集时
     * （resolveDispatchedReferences）就已经拒绝，这里重查只会得到同一条件的第二次报错。
     * 接缝改稿仍要单独拦一道：它走的是包裹画布，从不下发参考图，那里的 @图N 会写进提示词却
     * 对应不上任何一张图。
     *
     * 配色不再有单独的校验：色值就是 `#d9a441` 这样的文本，写不成合法的十六进制就压根不是 token，
     * 没有"写坏了的 token"这种中间状态可拒绝（见 draft-palettes.ts）。
     */
    if (operation === "GENERATE") {
      assertReferenceText(body.theme, referenceRows.map((row) => row.ordinal));
    } else if (operation === "SEAM_EDIT" && findDraftReferences(body.instruction ?? "").length) {
      throw new ApiError(400, "VALIDATION_ERROR", "接缝改稿不下发参考图，改稿说明不能引用 @图N");
    }
    const snapshot = {
      operation,
      promptVersion: DRAFT_PROMPT_VERSION,
      providerId: body.providerId ?? null,
      imageModelId: body.imageModelId ?? null,
      candidateCount,
      theme: body.theme ?? null,
      aspectRatio: body.aspectRatio ?? "1:1",
      imageResolution: body.imageResolution ?? null,
      quality: body.quality ?? null,
      background: body.background ?? "WHITE",
      repeatLayout: body.repeatLayout ?? null,
      instruction: body.instruction ?? null,
      recolor: body.recolor ?? null,
      seam: body.seam ?? null,
      references,
      annotation,
      parentCandidateId,
      segmentation,
    };
    const snapshotHash = contentHash(Buffer.from(JSON.stringify(snapshot)));
    const existing = repository.getDraftBatchByClientKey(draft.id, body.clientKey);
    if (existing) {
      if ((existing.snapshot as Record<string, unknown>)._hash !== snapshotHash) {
        throw new ApiError(409, "CONFLICT", "同一提交 key 已用于不同的输入；请更换 key 后重新提交");
      }
      const slots = repository.listDraftSlots(existing.id);
      const jobs = slotJobs(repository, slots);
      const latest = latestSlotJob(slots, jobs);
      return { batch: publicBatch(existing, slots, repository.listDraftCandidatesByBatch(existing.id), jobs), job: latest ? publicJobRef(latest) : null, reused: true };
    }

    const mapping = DRAFT_JOB_BY_OPERATION[operation];
    const stored = repository.createDraftBatch({ draftId: draft.id, operation, parentCandidateId, providerId: segmentation?.providerId ?? body.providerId ?? null, imageModelId: segmentation?.modelId ?? body.imageModelId ?? null, candidateCount, instruction: body.instruction ?? null, snapshot: { ...snapshot, _hash: snapshotHash }, clientKey: body.clientKey });
    const slots = stored.slots.map((slot) => slot.index);
    const job = repository.createJob({
      id: randomUUID(),
      projectId: null,
      storyboardItemId: null,
      type: mapping.type,
      input: { draftId: draft.id, batchId: stored.batch.id, slots, task: "BATCH", snapshotHash },
      requestFingerprint: null,
      providerId: segmentation?.providerId ?? body.providerId ?? null,
      modelId: segmentation?.modelId ?? body.imageModelId ?? null,
      estimatedCost: operation === "RECOLOR" ? null : { status: "UNKNOWN", unit: "provider-defined" },
    });
    repository.assignDraftSlotsToJob(stored.batch.id, slots, job.id, false);
    await enqueueOrMarkFailed(job, mapping.kind, { onFail: (jobId) => markDraftSlotsFailed(repository, stored.batch.id, slots, jobId) });
    const storedSlots = repository.listDraftSlots(stored.batch.id);
    return { batch: publicBatch(stored.batch, storedSlots, repository.listDraftCandidatesByBatch(stored.batch.id), slotJobs(repository, storedSlots)), job: publicJobRef(job), reused: false };
  }
}

/** 槽位批次共用的任务查询：一次批量取回，避免逐槽 getJob 造成 N+1。 */
function slotJobs(repository: EcomRepository, slots: DraftSlotRecord[]): Map<string, JobRecord> {
  return repository.listJobsByIds(slots.flatMap((slot) => (slot.jobId ? [slot.jobId] : [])));
}

/**
 * 批次内最近创建的任务：成本展示与"复用哪个在途任务"统一按这个口径取。
 *
 * 按槽位取而不是遍历整张 jobs 表——列表接口会把整份草稿的任务一次查回来复用，
 * 若在这里遍历整张表，早先批次的成本会显示成最新批次任务的数字。
 */
function latestSlotJob(slots: DraftSlotRecord[], jobs: ReadonlyMap<string, JobRecord>): JobRecord | undefined {
  return slots
    .flatMap((slot) => (slot.jobId ? [jobs.get(slot.jobId)] : []))
    .filter((job): job is JobRecord => Boolean(job))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1);
}

function activeDraftJobs(repository: EcomRepository, draftId: string): JobRecord[] {
  const slots = repository.listDraftBatches(draftId).flatMap((batch) => repository.listDraftSlots(batch.id));
  return [...slotJobs(repository, slots).values()].filter((job) => job.status === "QUEUED" || job.status === "RUNNING");
}

function markDraftSlotsFailed(repository: EcomRepository, batchId: string, indices: number[], jobId: string): void {
  // 槽位先读一次再改：放在循环里逐轮重查同一批槽位是平方级查询。
  const slots = repository.listDraftSlots(batchId);
  for (const index of indices) {
    const slot = slots.find((entry) => entry.index === index);
    if (slot && slot.jobId === jobId && slot.status === "QUEUED") repository.updateDraftSlot(batchId, index, { status: "FAILED", error: { code: "QUEUE_UNAVAILABLE", message: "任务已创建但队列暂不可用，请稍后重试" } });
  }
}
