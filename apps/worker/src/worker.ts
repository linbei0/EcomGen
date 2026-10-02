import { resolve } from "node:path";
import { Worker } from "bullmq";
import { EcomRepository, LocalAssetStore, SecretBox, SuiteCatalog, nextPipelineStep, openDatabase, resolveDataDir, settlePipelineStep, startPipelineStep, type JobRecord } from "@ecomgen/core";
import { createJobQueue, createRedisConnection, enqueue, queueKindForJobType, type EcomJobPayload, QUEUE_NAME, RedisProjectEventBus } from "@ecomgen/jobs";
import { ProviderError } from "@ecomgen/providers";
import { VisionDerivativeCache } from "./vision-cache.js";
import { createWorkerContext, JobCancelled, projectIdFor, startJobCancellation, type WorkerContext } from "./context.js";
import { executePlan } from "./job-plan.js";
import { executeCopywriting } from "./job-copywrite.js";
import { executeSuiteForge } from "./job-suite-forge.js";
import { executeModelCast } from "./job-model-cast.js";
import { executePatternDerive, executePatternExtract, executePatternForge, executePatternTileCheck, executePatternVariant } from "./job-patterns.js";
import { executePrintPack } from "./job-print-pack.js";
import { executeGeneration } from "./job-generation.js";
import { executeEditGeneration, executeEditPlan } from "./job-edit.js";
import { executeLayerExport, executeLayerPlan } from "./job-layers.js";
import { executeExport } from "./job-export.js";

const masterKey = process.env.ECOMGEN_MASTER_KEY;
if (!masterKey) throw new Error("ECOMGEN_MASTER_KEY must be a base64-encoded 32-byte key");
const projectRoot = resolve(import.meta.dirname, "../../..");
const dataDir = resolveDataDir(process.env.ECOMGEN_DATA_DIR, projectRoot);
const repository = new EcomRepository(openDatabase(resolve(dataDir, "ecomgen.sqlite")));
const suiteCatalog = new SuiteCatalog({ dataDir, repository });
await suiteCatalog.refresh();
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

const ctx: WorkerContext = createWorkerContext({ repository, suiteCatalog, storage, visionCache, secrets, events, executionQueue });

const worker = new Worker<EcomJobPayload>(QUEUE_NAME, async (queueJob) => {
  const job = repository.getJob(queueJob.data.jobId); if (!job) throw new Error(`Database job is missing: ${queueJob.data.jobId}`);
  if (job.status === "CANCELLED" || job.cancelRequested) return;
  await ctx.updateJob(job, { status: "RUNNING", progress: 5, error: null });
  const cancellation = startJobCancellation(repository, job);
  try {
    if (queueJob.data.kind === "plan") await executePlan(ctx, job);
    else if (queueJob.data.kind === "copywrite") await executeCopywriting(ctx, job);
    else if (queueJob.data.kind === "generate") await executeGeneration(ctx, job, cancellation.signal);
    else if (queueJob.data.kind === "edit_plan") await executeEditPlan(ctx, job);
    else if (queueJob.data.kind === "edit_generate") await executeEditGeneration(ctx, job, cancellation.signal);
    else if (queueJob.data.kind === "layer_plan") await executeLayerPlan(ctx, job);
    else if (queueJob.data.kind === "layer_export") await executeLayerExport(ctx, job, cancellation.signal);
    else if (queueJob.data.kind === "suite_forge") await executeSuiteForge(ctx, job);
    else if (queueJob.data.kind === "model_cast") await executeModelCast(ctx, job, cancellation.signal);
    else if (queueJob.data.kind === "pattern_extract") await executePatternExtract(ctx, job, cancellation.signal);
    else if (queueJob.data.kind === "pattern_forge") await executePatternForge(ctx, job, cancellation.signal);
    else if (queueJob.data.kind === "pattern_derive") await executePatternDerive(ctx, job);
    else if (queueJob.data.kind === "pattern_variant") await executePatternVariant(ctx, job, cancellation.signal);
    else if (queueJob.data.kind === "pattern_tile_check") await executePatternTileCheck(ctx, job);
    else if (queueJob.data.kind === "print_pack") await executePrintPack(ctx, job);
    else await executeExport(ctx, job);
    // 终态与清空外部请求标记在同一条 UPDATE 内原子完成：标记一旦设置就只在终态消失，
    // 避免终态写入前进程崩溃时恢复层误判任务仍在付费请求窗口内。
    const current = repository.getJob(job.id);
    if (current?.cancelRequested || current?.status === "CANCELLED") {
      await ctx.updateJob(job, { status: "CANCELLED", progress: current.progress, providerTaskId: null });
      settlePipelineStep(repository, job.id, "CANCELLED", null);
    } else {
      await ctx.updateJob(job, { status: "SUCCEEDED", progress: 100, providerTaskId: null });
      // 推进必须发生在任务终态写入之后：即使推进失败，任务本身已成为"已成功"的真相，不能被改判。
      await advancePatternPipeline(ctx, job);
    }
  } catch (error) {
    if (error instanceof JobCancelled) { await ctx.updateJob(job, { status: "CANCELLED", cancelRequested: true, providerTaskId: null }); return; }
    const message = error instanceof Error ? error.message : String(error);
    if (job.type === "EDIT_PLAN" || job.type === "EDIT_GENERATE") {
      const turnId = typeof job.input.editTurnId === "string" ? job.input.editTurnId : "";
      if (turnId) {
        const turn = repository.updateEditTurn(turnId, { status: "FAILED", error: { message } });
        if (turn) await events.publish(projectIdFor(job), "edit-turn.updated", { turn });
      }
    }
    await ctx.updateJob(job, { status: "FAILED", progress: 100, error: { message, providerStatus: error instanceof ProviderError ? error.status : undefined } });
    settlePipelineStep(repository, job.id, "FAILED", { message });
    throw error;
  } finally {
    cancellation.dispose();
  }
}, { connection: redis, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) });

worker.on("failed", (job, error) => { console.error(`Queue job ${job?.id ?? "unknown"} failed: ${error instanceof Error ? error.message : String(error)}`); });
// 进程存活不等于已在消费：未连接队列时入队的任务只会静默等待。启动日志是 e2e 与运维
// 唯一可观察的就绪信号，Mock E2E 依赖这一行判定可以开始提交任务。
await worker.waitUntilReady();
console.log("ecomgen worker ready");
async function stop(): Promise<void> { clearInterval(referenceCleanupTimer); await worker.close(); await executionQueue.close(); await executionRedis.quit(); await events.close(); await redis.quit(); }
process.once("SIGINT", () => { void stop().then(() => process.exit(0)); });
process.once("SIGTERM", () => { void stop().then(() => process.exit(0)); });

/**
 * 流水线推进：某个步骤的任务成功后，把步骤置成功并按需起跑下一步。
 *
 * 两条不变量：
 * 1) 本函数**绝不抛错**。它跑在任务成功后，抛错只会让调用方把一个已成功的任务改判为失败；
 *    推进本身的问题（找不到花型、入队失败）改写流水线与步骤，用户在工作区能看到原因。
 * 2) 幂等。进程崩溃后 recoverInterruptedJobs 会重新执行同一任务，于是本函数会被再次调用——
 *    已经是 SUCCEEDED 的步骤直接返回，不重复入队下一步。
 *
 * 验缝未通过且版式为满印时**不静默继续**：把风险写进步骤 detail，流水线停在 AWAITING_INPUT
 * 等用户裁决（居中继续 / 换镜像出满印 / 仍出满印）。自动降级成居中会把满印需求偷偷改成单区域印花。
 * 唯一不拦的排列是镜像：重复单元接缝两侧像素恒等，构造性无缝对任意图片成立（ADR-0001）。
 */
async function advancePatternPipeline(ctx: WorkerContext, job: JobRecord): Promise<void> {
  const { repository, executionQueue } = ctx;
  const step = repository.getPatternPipelineStepByJobId(job.id);
  if (!step) return;
  const pipeline = repository.getPatternPipeline(step.pipelineId);
  if (!pipeline) return;
  if (step.status === "SUCCEEDED") return;
  try {
    let patternId = pipeline.patternId;
    let detail: Record<string, unknown> | null = null;
    if (step.step === "SOURCE") {
      // 契约承诺"多候选时从第一张有产物的候选起链"：listPatternsByJobId 按创建时间倒序，
      // 所以取过滤后的最后一个（最早）而不是第一个（最新）。
      const produced = repository.listPatternsByJobId(job.id).filter((entry) => entry.storagePath).pop();
      if (!produced) throw new Error("图案获取步骤已完成，但没有任何花型产物，无法继续成包");
      patternId = produced.id;
      repository.updatePatternPipeline(pipeline.id, { patternId });
    }
    if (step.step === "TILE_CHECK") {
      const pattern = patternId ? repository.getPattern(patternId) : undefined;
      detail = { tileable: pattern?.tileable ?? null, tileableScore: pattern?.tileableScore ?? null, repeatLayout: pipeline.repeatLayout };
      // 镜像豁免闸门：排列的接缝是构造性无缝，验缝结论对它不适用；错位类排列与直排同险，照常拦。
      if (pipeline.layout === "TILE" && pipeline.repeatLayout !== "MIRROR" && pattern?.tileable !== "VERIFIED") {
        repository.updatePatternPipelineStep(step.id, { status: "SUCCEEDED", detail: { ...detail, warning: "验缝未通过：满印会在成品上露出规则接缝；可改用「镜像」排列继续（构造性无缝，图案会上下左右翻转对称）" } });
        repository.updatePatternPipeline(pipeline.id, { status: "AWAITING_INPUT", blockReason: "SEAM_RISK" });
        return;
      }
    }
    repository.updatePatternPipelineStep(step.id, { status: "SUCCEEDED", detail });
    if (!patternId) throw new Error("流水线没有花型，无法继续下一步");
    const next = nextPipelineStep(pipeline.steps, step);
    if (!next) {
      repository.updatePatternPipeline(pipeline.id, { status: "SUCCEEDED", blockReason: null });
      return;
    }
    const started = startPipelineStep(repository, pipeline, next, patternId);
    await enqueue(executionQueue, { jobId: started.job.id, kind: queueKindForJobType(started.jobType) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    repository.updatePatternPipelineStep(step.id, { status: "FAILED", error: { message } });
    repository.updatePatternPipeline(pipeline.id, { status: "FAILED", blockReason: null });
    console.error(`Pattern pipeline ${pipeline.id} could not advance after job ${job.id}: ${message}`);
  }
}
