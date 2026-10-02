import type { FastifyInstance } from "fastify";
import type { EcomRepository, PatternPipelineWithSteps } from "@ecomgen/core";
import {
  nextPipelineStep,
  pipelineStepPlan,
  requestFingerprint,
  resetPipelineStepsFrom,
  settlePipelineStep,
  startPipelineStep,
} from "@ecomgen/core";
import { queueKindForJobType } from "@ecomgen/jobs";
import {
  ContinuePatternPipelineInput,
  CreatePatternPipelineInput,
  PatternPipelineAnswers,
  PATTERN_PIPELINE_STEPS,
  POD_PRINT_SPEC_VERSION,
  getPodPrintSpec,
} from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import { ensurePattern, ensurePatternPipeline, missing, verifyCopywritingModel } from "../helpers.js";
import { parseBody } from "../http-input.js";
import { enumValue, parameter, readOptionalText } from "../input-normalizers.js";

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
export async function startPatternPipeline(ctx: ApiContext, input: {
  patternId: string | null;
  patternHash: string | null;
  answers: PatternPipelineAnswers;
  sourceJobId?: string;
  idempotencyKey?: string | null;
}): Promise<{ pipeline: PatternPipelineWithSteps; reused: boolean }> {
  const { repository, enqueueOrMarkFailed } = ctx;
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

/**
 * 成包答案的校验：规格必须存在，文案模型必须是支持视觉的推理模型（文案步骤要读花型图）。
 *
 * 与建链分开是因为源入口要在**写任何文件或行之前**先失败：一个 400 请求不该留下半个花型。
 * 返回解析出的规格，供调用方避免二次查表。
 */
export function validatePatternPipelineAnswers(repository: EcomRepository, answers: PatternPipelineAnswers) {
  const spec = getPodPrintSpec(answers.specId);
  if (!spec) throw new ApiError(400, "VALIDATION_ERROR", `未知的印刷规格：${answers.specId}`);
  if (answers.repeatLayout && (answers.layout ?? "CENTERED") !== "TILE") {
    throw new ApiError(400, "VALIDATION_ERROR", "平铺排列仅在满印（TILE）版式下生效");
  }
  verifyCopywritingModel(repository, answers.listingProviderId, answers.listingModelId);
  return spec;
}

/**
 * multipart 里的成包答案：多段表单只能传字符串，所以这一项是 JSON 文本。
 * 解析失败与字段缺失必须给不同口径的错误——把"没填"和"填错了"混成同一句，用户改不动。
 */
export function readPatternPipelineAnswers(raw: string | null | undefined): PatternPipelineAnswers | undefined {
  const text = readOptionalText(raw);
  if (!text) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ApiError(400, "VALIDATION_ERROR", "pipeline 必须是 JSON 对象"); }
  return parseBody(PatternPipelineAnswers, parsed);
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

export function registerPatternPipelineRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, enqueueOrMarkFailed, requestJobCancellation } = ctx;
  // ---- 成包流水线（三问一跑）：花型 × 规格 × 平台一次串起「验缝 → 规格包 → 文案」。 ----
  // 编排不是用户要学的东西：步骤顺序内建，用户只回答问题；每一步仍可单独重跑（见 steps/:step/retry）。
  app.post("/api/v1/patterns/:patternId/pipelines", async (request, reply) => {
    const pattern = ensurePattern(repository, parameter(request, "patternId"));
    if (!pattern.storagePath) throw new ApiError(409, "CONFLICT", "该花型还没有可用的图稿产物，无法成包");
    const body = parseBody(CreatePatternPipelineInput, request.body);
    const { pipeline, reused } = await startPatternPipeline(ctx, {
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
}
