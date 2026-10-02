import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { queueKindForJobType } from "@ecomgen/jobs";
import type { JobType } from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import { markDomainRecordFailed, missing } from "../helpers.js";
import { parameter } from "../input-normalizers.js";

export function registerJobRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, requestJobCancellation, enqueueOrMarkFailed } = ctx;
  app.get("/api/v1/jobs/:jobId", async (request) => { const job = repository.getJob(parameter(request, "jobId")); if (!job) missing("job", parameter(request, "jobId")); return job; });
  app.get("/api/v1/copywriting-jobs/:jobId/result", async (request) => {
    const jobId = parameter(request, "jobId");
    const job = repository.getJob(jobId);
    if (!job || job.type !== "COPYWRITE") missing("copywriting job", jobId);
    if (job.status !== "SUCCEEDED") throw new ApiError(409, "CONFLICT", "Copywriting job has not succeeded");
    const result = repository.getCopywritingResult(jobId);
    if (!result) missing("copywriting result", jobId);
    return result;
  });
  app.post("/api/v1/jobs/:jobId/cancel", async (request) => requestJobCancellation(parameter(request, "jobId")));
  app.post("/api/v1/jobs/:jobId/retry", async (request, reply) => {
    const id = parameter(request, "jobId"); const job = repository.getJob(id); if (!job) missing("job", id);
    // 只有失败任务可重试：重试 QUEUED/RUNNING 会叠加 Provider 调用产生重复计费，
    // SUCCEEDED 无需重试，CANCELLED 是用户主动终结的终态；retryable=false 保留 Worker 对
    // 外部请求不确定状态的非重试判断，API 不绕过该不变量。
    if (job.status !== "FAILED" || !job.retryable) {
      throw new ApiError(409, "CONFLICT", `只有失败的任务可以重试，当前状态：${job.status}`);
    }
    const input = job.type === "GENERATE" ? { ...job.input, revision: "retry" } : job.input;
    // 分层任务重试必须同时重建分层记录，否则 Worker 按新 jobId 找不到对应记录会立即失败。
    let createLayerRecord: ((retryJobId: string) => void) | undefined;
    if (job.type === "LAYER_PLAN" || job.type === "LAYER_EXPORT") {
      const outputId = typeof job.input.outputId === "string" ? job.input.outputId : "";
      const output = outputId ? repository.getOutput(outputId) : undefined;
      if (!output || output.projectId !== job.projectId) throw new ApiError(409, "CONFLICT", "无法重试：源输出已不存在");
      if (job.type === "LAYER_PLAN") {
        createLayerRecord = (retryJobId) => { repository.createLayerPlan({ projectId: output.projectId, outputId: output.id, jobId: retryJobId, outputHash: output.hash, status: "QUEUED", elements: [], error: null }); };
      } else {
        const planId = typeof job.input.planId === "string" ? job.input.planId : null;
        const includeBackground = job.input.includeBackground !== false;
        createLayerRecord = (retryJobId) => { repository.createLayerExport({ projectId: output.projectId, outputId: output.id, jobId: retryJobId, planId, status: "QUEUED", includeBackground, psdStoragePath: null, layerFiles: null, error: null }); };
      }
    }
    // 规格包重试同理：记录按新 jobId 重建，否则 Worker 找不到对应记录会立即失败。
    if (job.type === "PRINT_PACK") {
      const patternId = typeof job.input.patternId === "string" ? job.input.patternId : "";
      const specId = typeof job.input.specId === "string" ? job.input.specId : "";
      const specVersion = typeof job.input.specVersion === "string" ? job.input.specVersion : "";
      if (!patternId || !specId || !specVersion) throw new ApiError(409, "CONFLICT", "无法重试：规格包任务缺少快照");
      createLayerRecord = (retryJobId) => { repository.createPrintPack({ patternId, jobId: retryJobId, specId, specVersion, status: "QUEUED" }); };
    }
    // 重试即替代原任务：先终结原失败任务再入队新任务，前端结果区不再残留旧卡片；retryable 在此关闭使并发双击得到 409。
    repository.updateJob(id, { status: "CANCELLED", cancelRequested: true, retryable: false });
    const retry = repository.createJob({ id: randomUUID(), projectId: job.projectId, storyboardItemId: job.storyboardItemId, type: job.type, input, providerId: job.providerId, modelId: job.modelId, estimatedCost: job.estimatedCost }); createLayerRecord?.(retry.id); await enqueueOrMarkFailed(retry, queueKindForJobType(retry.type), { onFail: (jobId) => markDomainRecordFailed(repository, retry.type as JobType, jobId) }); return reply.code(202).send(retry);
  });
}
