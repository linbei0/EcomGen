import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import sharp from "sharp";
import type { PatternRecord, PrintPackRecord } from "@ecomgen/core";
import type { EcomRepository } from "@ecomgen/core";
import { requestFingerprint, settlePipelineStep } from "@ecomgen/core";
import { defaultPatternName, PATTERN_FORGE_PROMPT_VERSION, PATTERN_VARIANT_PROMPT_VERSION, presetBelongsToAxis } from "@ecomgen/ecom-skill";
import {
  CreatePatternDeriveJobInput,
  CreatePatternForgeJobInput,
  CreatePatternListingJobInput,
  CreatePatternVariantJobInput,
  CreatePrintPackJobInput,
  UpdatePatternInput,
  MAX_PATTERN_BRIEF_LENGTH,
  MAX_PATTERN_NAME_LENGTH,
  MAX_PATTERN_TAG_LENGTH,
  PATTERN_TAGS_MAX,
  POD_MOCKUP_SCENE_VERSION,
  POD_PRINT_SPECS,
  POD_PRINT_SPEC_VERSION,
  TILEABILITY_ALGORITHM_VERSION,
  getPodPrintSpec,
} from "@ecomgen/contracts";
import type { PatternBackgroundMode } from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import {
  assertTransparentBackground,
  contentHash,
  ensurePattern,
  imageDimensions,
  markDomainRecordFailed,
  missing,
  readImageMultipart,
  resolveSegmentationModel,
  reusableFingerprintedJob,
  verifyCopywritingModel,
  verifyModel,
} from "../helpers.js";
import { parseBody } from "../http-input.js";
import { parameter, readOptionalText, readText } from "../input-normalizers.js";
import { readPatternPipelineAnswers, startPatternPipeline, validatePatternPipelineAnswers } from "./patternPipelines.js";

export function publicPattern(record: PatternRecord) {
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

/**
 * 源入口（提取 / 上传）共用的取件：收集规则在 helpers.readImageMultipart，这里只负责本入口要求的
 * 「必须有文件」判定，并把缺失文件名拼进错误信息（如 "source image" / "pattern image"）。
 */
async function readSingleImageMultipart(request: FastifyRequest, fileLabel: string): Promise<{ upload: { filename: string; buffer: Buffer }; fields: Record<string, string> }> {
  const { upload, fields } = await readImageMultipart(request);
  if (!upload) throw new ApiError(400, "VALIDATION_ERROR", `A ${fileLabel} is required`);
  return { upload, fields };
}

/** multipart 字段不走 TypeBox，长度上限必须在这里对齐契约（同 suite-forge 的 boundedText 约定）。 */
function optionalBoundedText(value: string | undefined, maxLength: number, field: string): string | undefined {
  if (value && value.length > maxLength) throw new ApiError(400, "VALIDATION_ERROR", `${field} must be at most ${maxLength} characters`);
  return value;
}

/** multipart 的 tags 字段是 JSON 数组字符串；逐项校验后截断到容量上限。 */
function parsePatternTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ApiError(400, "VALIDATION_ERROR", "tags must be a JSON array of strings"); }
  if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== "string")) throw new ApiError(400, "VALIDATION_ERROR", "tags must be a JSON array of strings");
  const tags = parsed.map((tag) => (tag as string).trim()).filter(Boolean).slice(0, PATTERN_TAGS_MAX);
  if (tags.some((tag) => tag.length > MAX_PATTERN_TAG_LENGTH)) throw new ApiError(400, "VALIDATION_ERROR", `tag exceeds ${MAX_PATTERN_TAG_LENGTH} characters`);
  return tags;
}

export function registerPatternRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, storage, enqueueOrMarkFailed } = ctx;
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
    const { protocol } = resolveSegmentationModel(repository, providerId, modelId, "花型提取", readOptionalText(fields.protocol));
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
      await startPatternPipeline(ctx, { patternId, patternHash: null, answers, sourceJobId: jobId, idempotencyKey });
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
    if (answers) await startPatternPipeline(ctx, { patternId: record.id, patternHash: record.fileHash, answers });
    return reply.code(201).send(publicPattern(record));
  });
  // AI 起稿：主题/风格是入队快照，prompt 由 ecom-skill 的编译函数确定性派生；每张候选独立成花型。
  app.post("/api/v1/patterns/forge-jobs", async (request, reply) => {
    const body = parseBody(CreatePatternForgeJobInput, request.body);
    verifyModel(repository, body.providerId, body.imageModelId, "image");
    const background = body.background ?? "WHITE";
    assertTransparentBackground(repository, body.providerId, body.imageModelId, background);
    const candidateCount = body.candidateCount ?? 1;
    const idempotencyKey = body.idempotencyKey ?? (request.headers["idempotency-key"] as string | undefined) ?? null;
    // background 进指纹：它改的是编译后的提示词，不进指纹就会让"同主题不同底版"的两个请求互相复用。
    const fingerprint = requestFingerprint({ type: "PATTERN_FORGE", providerId: body.providerId, imageModelId: body.imageModelId, theme: body.theme, style: body.style ?? null, category: body.category ?? null, background, candidateCount, name: body.name ?? null, promptVersion: PATTERN_FORGE_PROMPT_VERSION, idempotencyKey });
    const existing = repository.findJobByFingerprint(null, fingerprint);
    // 在途照常复用（起稿的花型随候选完成才落库，不能要求在途已有产物）；产物被删光后同指纹重提必须新建。
    if (existing && reusableFingerprintedJob(existing, repository.hasPatternArtifactsByJobId(existing.id))) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send(existing);
    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: "PATTERN_FORGE", input: { theme: body.theme, style: body.style ?? null, category: body.category ?? null, background, candidateCount, name: body.name ?? null }, requestFingerprint: fingerprint, providerId: body.providerId, modelId: body.imageModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    // 与提取同理：流水线先建好再入队，Worker 找得到 SOURCE 步骤；多候选时由第一张有产物的候选起链。
    if (body.pipeline) await startPatternPipeline(ctx, { patternId: null, patternHash: null, answers: body.pipeline, sourceJobId: job.id, idempotencyKey });
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
    assertTransparentBackground(repository, body.providerId, body.imageModelId, background);
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
}
