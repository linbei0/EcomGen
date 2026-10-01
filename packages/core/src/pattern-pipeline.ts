import { randomUUID } from "node:crypto";
import type { JobType } from "@ecomgen/contracts";
import type { EcomRepository, JobRecord, PatternPipelineRecord, PatternPipelineStepRecord } from "./repository.js";

/**
 * 成包流水线的领域逻辑：步骤编排 + 「某一步要创建什么任务」。
 *
 * 放在 core 而不是 api/worker：流水线的第一步由 API 起链后创建，后续步骤由 Worker 在任务完成后
 * 推进创建——两处必须对"同一步骤要什么任务"给出一致答案，分开写就一定会漂移。
 * 本模块只建任务行与领域记录，不负责入队：入队要用各自的 Queue 句柄（API 用请求期队列、Worker 用
 * 常驻的 executionQueue），所以把 jobType 交回调用方做 kind 映射。
 */

export type PatternPipelineStepKind = PatternPipelineStepRecord["step"];

/** SOURCE 只在从花型墙的来源动作起链时存在；从既有花型起链时第一问已被入口回答，步骤表里没有它。 */
export function pipelineStepPlan(fromSource: boolean): Array<{ step: PatternPipelineStepKind; position: number }> {
  const steps: PatternPipelineStepKind[] = fromSource ? ["SOURCE", "TILE_CHECK", "PRINT_PACK", "LISTING"] : ["TILE_CHECK", "PRINT_PACK", "LISTING"];
  return steps.map((step, position) => ({ step, position }));
}

export interface CreatedStepJob {
  job: JobRecord;
  jobType: JobType;
}

/**
 * 为某个步骤创建任务行（含规格包领域记录），并把任务挂到步骤上。
 *
 * 步骤任务不带请求指纹：流水线本身就是用户显式发起的一次执行，不复用旧任务——否则"成包"在第二次
 * 点按时会静默无事发生。代价是同一花型同规格重复成包会留下多条记录（本地零费用；文案步骤则是用户
 * 显式再付一次），这是显式历史而不是重复计费。
 *
 * SOURCE 步骤不在本函数范围内：它的任务是来源入口（提取/起稿/上传）创建的，本函数只负责后续步骤。
 */
export function createPipelineStepJob(repository: EcomRepository, pipeline: PatternPipelineRecord, step: PatternPipelineStepRecord, patternId: string): CreatedStepJob {
  const base = { id: randomUUID(), projectId: null, storyboardItemId: null, requestFingerprint: null };
  if (step.step === "TILE_CHECK") {
    const job = repository.createJob({ ...base, type: "PATTERN_TILE_CHECK", input: { patternId }, estimatedCost: { status: "UNKNOWN", unit: "local-storage" } });
    repository.updatePatternPipelineStep(step.id, { jobId: job.id });
    return { job, jobType: "PATTERN_TILE_CHECK" };
  }
  if (step.step === "PRINT_PACK") {
    const job = repository.createJob({ ...base, type: "PRINT_PACK", input: { patternId, specId: pipeline.specId, specVersion: pipeline.specVersion, layout: pipeline.layout }, estimatedCost: { status: "UNKNOWN", unit: "local-storage" } });
    repository.createPrintPack({ patternId, jobId: job.id, specId: pipeline.specId, specVersion: pipeline.specVersion, status: "QUEUED" });
    repository.updatePatternPipelineStep(step.id, { jobId: job.id });
    return { job, jobType: "PRINT_PACK" };
  }
  if (step.step === "LISTING") {
    const job = repository.createJob({
      ...base,
      type: "COPYWRITE",
      input: { target: "LISTING", patternId, platform: pipeline.listingPlatform, sellingPoints: pipeline.listingHints.sellingPoints, mustIncludeWords: null, bannedWords: pipeline.listingHints.bannedWords },
      providerId: pipeline.listingProviderId,
      modelId: pipeline.listingModelId,
      estimatedCost: { status: "UNKNOWN", unit: "provider-defined" },
    });
    repository.updatePatternPipelineStep(step.id, { jobId: job.id });
    return { job, jobType: "COPYWRITE" };
  }
  throw new Error(`SOURCE 步骤的任务由来源入口创建，不由流水线创建（pipeline ${pipeline.id}）`);
}

/** 按 position 取下一步；没有下一步表示流水线走完了。 */
export function nextPipelineStep(steps: PatternPipelineStepRecord[], current: PatternPipelineStepRecord): PatternPipelineStepRecord | null {
  const ordered = [...steps].sort((left, right) => left.position - right.position);
  const index = ordered.findIndex((entry) => entry.id === current.id);
  if (index < 0) return null;
  return ordered[index + 1] ?? null;
}

/** 起跑一个步骤：建任务 → 步骤置 QUEUED → 流水线转 RUNNING。入队由调用方用自己的 Queue 完成。 */
export function startPipelineStep(repository: EcomRepository, pipeline: PatternPipelineRecord, step: PatternPipelineStepRecord, patternId: string): CreatedStepJob {
  const created = createPipelineStepJob(repository, pipeline, step, patternId);
  repository.updatePatternPipelineStep(step.id, { status: "QUEUED", error: null });
  repository.updatePatternPipeline(pipeline.id, { status: "RUNNING", blockReason: null });
  return created;
}

/**
 * 任务落终态时把步骤与流水线一起落定。除了 worker 的失败回调，入队失败（onFail）也必须走这里——
 * 否则流水线会永远停在 RUNNING，而用户看不到任何原因。
 */
export function settlePipelineStep(repository: EcomRepository, jobId: string, status: "FAILED" | "CANCELLED", error: Record<string, unknown> | null): void {
  const step = repository.getPatternPipelineStepByJobId(jobId);
  if (!step) return;
  repository.updatePatternPipelineStep(step.id, { status, error });
  // 取消不写成 FAILED：用户主动终止的流水线与"任务出错"是两回事，混在一起会让重跑入口显示成故障。
  repository.updatePatternPipeline(step.pipelineId, { status: status === "CANCELLED" ? "CANCELLED" : "FAILED", blockReason: null });
}

/** 把某一步及其后续步骤重置为 PENDING，用于单步重跑（下游结果已基于旧输入，必须一并重算）。 */
export function resetPipelineStepsFrom(repository: EcomRepository, pipelineId: string, stepId: string): void {
  const pipeline = repository.getPatternPipeline(pipelineId);
  if (!pipeline) return;
  const target = pipeline.steps.find((entry) => entry.id === stepId);
  if (!target) return;
  for (const step of pipeline.steps.filter((entry) => entry.position >= target.position)) {
    repository.updatePatternPipelineStep(step.id, { status: "PENDING", jobId: null, detail: null, error: null });
  }
}
