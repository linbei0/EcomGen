import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { LayerExportRecord, LayerPlanRecord } from "@ecomgen/core";
import { requestFingerprint } from "@ecomgen/core";
import { CreateExportJobRequest, CreateLayerExportInput, CreateLayerPlanInput, SEGMENTATION_PROTOCOL_CAPABILITIES } from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import { ensureProject, markDomainRecordFailed, missing, readSegmentationModel } from "../helpers.js";
import { parseBody } from "../http-input.js";
import { parameter } from "../input-normalizers.js";

function publicLayerPlan(plan: LayerPlanRecord): object { return { ...plan, error: plan.error ?? undefined }; }
function publicLayerExport(record: LayerExportRecord): object {
  return {
    ...record,
    psdStoragePath: record.psdStoragePath ?? undefined,
    psdDownloadUrl: record.psdStoragePath ? `/files/layer-exports/${record.id}` : null,
    layerFiles: record.layerFiles?.map((file, index) => ({ name: file.name, kind: file.kind, downloadUrl: `/files/layer-exports/${record.id}/layers/${index}` })) ?? null,
    error: record.error ?? undefined,
  };
}

export function registerOutputRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, enqueueOrMarkFailed } = ctx;
  app.get("/api/v1/projects/:projectId/outputs", async (request) => repository.listOutputs(parameter(request, "projectId")));
  app.post("/api/v1/projects/:projectId/export-jobs", async (request, reply) => { const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); const body = parseBody(CreateExportJobRequest, request.body ?? {}); const input = { outputIds: body.outputIds, filenamePrefix: body.filenamePrefix }; const fingerprint = requestFingerprint({ type: "EXPORT", projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null }); const existing = repository.findJobByFingerprint(projectId, fingerprint); if (existing) { const exportRecord = repository.getExportByJobId(existing.id); return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send({ job: existing, export: exportRecord ?? null }); } const job = repository.createJob({ id: randomUUID(), projectId, storyboardItemId: null, type: "EXPORT", input, requestFingerprint: fingerprint, estimatedCost: { status: "UNKNOWN", unit: "local-storage" } }); const exportRecord = repository.createExport({ projectId, jobId: job.id, status: "QUEUED", storagePath: null }); await enqueueOrMarkFailed(job, "export", { onFail: (failedJobId) => { const pendingExport = repository.getExportByJobId(failedJobId); if (pendingExport) repository.updateExport(pendingExport.id, { status: "FAILED" }); } }); return reply.code(202).send({ job, export: exportRecord }); });
  app.get("/api/v1/exports/:exportId", async (request) => { const result = repository.getExport(parameter(request, "exportId")); if (!result) missing("export", parameter(request, "exportId")); return result; });
  app.get("/api/v1/outputs/:outputId/layer-plan", async (request) => {
    const output = repository.getOutput(parameter(request, "outputId"));
    if (!output) missing("output", parameter(request, "outputId"));
    const plan = repository.getLayerPlanByOutput(output.id);
    if (!plan) missing("layer plan", output.id);
    return publicLayerPlan(plan);
  });
  app.post("/api/v1/outputs/:outputId/layer-plan", async (request, reply) => {
    const output = repository.getOutput(parameter(request, "outputId"));
    if (!output) missing("output", parameter(request, "outputId"));
    const project = repository.getProject(output.projectId);
    if (!project) missing("project", output.projectId);
    const body = parseBody(CreateLayerPlanInput, request.body ?? {});
    // 输出内容未变化、上次识别成功、且推理模型快照一致时才复用；显式 regenerationKey 表示调用方要求重新识别。
    const existing = repository.getLayerPlanByOutput(output.id);
    const existingJob = existing ? repository.getJob(existing.jobId) : undefined;
    const sameReasoningModel = existingJob?.providerId === project.reasoningProviderId && existingJob?.modelId === project.reasoningModelId;
    if (existing && existing.status === "SUCCEEDED" && existing.outputHash === output.hash && sameReasoningModel && !body.regenerationKey) return reply.code(200).send(publicLayerPlan(existing));
    const input = { outputId: output.id, outputHash: output.hash, regenerationKey: body.regenerationKey ?? null, reasoningProviderId: project.reasoningProviderId ?? null, reasoningModelId: project.reasoningModelId ?? null };
    const fingerprint = requestFingerprint({ type: "LAYER_PLAN", projectId: output.projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null });
    const duplicate = repository.findJobByFingerprint(output.projectId, fingerprint);
    if (duplicate) { const duplicatePlan = repository.getLayerPlanByJobId(duplicate.id); if (duplicatePlan) return reply.code(duplicate.status === "SUCCEEDED" ? 200 : 202).send(publicLayerPlan(duplicatePlan)); }
    const job = repository.createJob({ id: randomUUID(), projectId: output.projectId, storyboardItemId: null, type: "LAYER_PLAN", input, requestFingerprint: fingerprint, providerId: project.reasoningProviderId, modelId: project.reasoningModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    const plan = repository.createLayerPlan({ projectId: output.projectId, outputId: output.id, jobId: job.id, outputHash: output.hash, status: "QUEUED", elements: [], error: null });
    await enqueueOrMarkFailed(job, "layer_plan", { onFail: (failedJobId) => markDomainRecordFailed(repository, "LAYER_PLAN", failedJobId) });
    return reply.code(202).send(publicLayerPlan(plan));
  });
  app.get("/api/v1/outputs/:outputId/layer-exports", async (request) => {
    const output = repository.getOutput(parameter(request, "outputId"));
    if (!output) missing("output", parameter(request, "outputId"));
    const layerExport = repository.getLayerExportByOutput(output.id);
    if (!layerExport) missing("layer export", output.id);
    return publicLayerExport(layerExport);
  });
  // 历史导出全集：文件端点按记录 id 寻址，旧导出在重新分层/重新导出后仍可回看与下载
  app.get("/api/v1/outputs/:outputId/layer-exports/history", async (request) => {
    const output = repository.getOutput(parameter(request, "outputId"));
    if (!output) missing("output", parameter(request, "outputId"));
    return { exports: repository.listLayerExportsByOutput(output.id).map(publicLayerExport) };
  });
  app.post("/api/v1/outputs/:outputId/layer-exports", async (request, reply) => {
    const output = repository.getOutput(parameter(request, "outputId"));
    if (!output) missing("output", parameter(request, "outputId"));
    const project = repository.getProject(output.projectId);
    if (!project) missing("project", output.projectId);
    if (!project.segmentationModel) throw new ApiError(422, "PROVIDER_NOT_CONFIGURED", "请先在项目设置中选择分割模型");
    const body = parseBody(CreateLayerExportInput, request.body ?? {});
    const includeBackground = body.includeBackground ?? true;
    const plan = repository.getLayerPlanByOutput(output.id);
    // 画框/提示词元素可以跳过视觉识别直接分层；auto 元素必须来自当前识别结果，避免引用过期元素。
    const succeededPlan = plan?.status === "SUCCEEDED" ? plan : null;
    const planId = succeededPlan?.id ?? null;
    // auto 元素必须绑定勾选时的识别方案：方案被重新识别后 el-N 会指向新对象，仅靠局部 id 无法区分。
    if (body.elements.some((element) => element.source === "auto") && body.planId !== planId) throw new ApiError(409, "CONFLICT", "识别方案已更新，请重新选择图层元素后再导出");
    const planElementIds = new Set(succeededPlan?.elements.map((element) => element.id) ?? []);
    for (const element of body.elements) {
      if (element.source === "manual" && !element.bbox) throw new ApiError(400, "VALIDATION_ERROR", `手动元素「${element.name}」缺少画框坐标`);
      if (element.source === "auto" && !planElementIds.has(element.id)) throw new ApiError(409, "CONFLICT", `元素「${element.name}」不在识别结果中，请先完成图层识别再导出`);
    }
    // 单次导出元素数受分割协议上限约束（Seedream 最多 16 层、SAM 单次最多 32 个对象），提前校验避免任务必然失败。
    // 存储引用里的 protocol 可能是历史默认值，以模型当前声明为准，因此只传 providerId/modelId。
    const segmentation = readSegmentationModel(repository, { providerId: project.segmentationModel.providerId, modelId: project.segmentationModel.modelId });
    const maxLayerElements = SEGMENTATION_PROTOCOL_CAPABILITIES[segmentation.protocol].maxElements;
    if (body.elements.length > maxLayerElements) throw new ApiError(400, "VALIDATION_ERROR", `当前分割模型单次最多支持 ${maxLayerElements} 个图层元素，请减少元素后重试`);
    // auto 元素的英文分割提示由服务端从识别方案补齐：客户端只传 id/name/source/bbox，
    // promptEn 属于识别产物而非用户输入，避免客户端伪造或携带过期方案的数据。
    const promptEnById = new Map(succeededPlan?.elements.filter((element) => element.promptEn).map((element) => [element.id, element.promptEn]) ?? []);
    const elements = body.elements.map((element) => (element.source === "auto" && promptEnById.has(element.id) ? { ...element, promptEn: promptEnById.get(element.id) } : element));
    const input = { outputId: output.id, planId, outputHash: output.hash, elements, includeBackground, segmentationProviderId: segmentation.providerId, segmentationModelId: segmentation.modelId, segmentationProtocol: segmentation.protocol };
    const fingerprint = requestFingerprint({ type: "LAYER_EXPORT", projectId: output.projectId, input, idempotencyKey: request.headers["idempotency-key"] ?? null });
    const duplicate = repository.findJobByFingerprint(output.projectId, fingerprint);
    if (duplicate) { const duplicateExport = repository.getLayerExportByJobId(duplicate.id); if (duplicateExport) return reply.code(duplicate.status === "SUCCEEDED" ? 200 : 202).send({ job: duplicate, layerExport: publicLayerExport(duplicateExport) }); }
    const job = repository.createJob({ id: randomUUID(), projectId: output.projectId, storyboardItemId: null, type: "LAYER_EXPORT", input, requestFingerprint: fingerprint, providerId: project.segmentationModel.providerId, modelId: project.segmentationModel.modelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    const layerExport = repository.createLayerExport({ projectId: output.projectId, outputId: output.id, jobId: job.id, planId, status: "QUEUED", includeBackground, psdStoragePath: null, layerFiles: null, error: null });
    await enqueueOrMarkFailed(job, "layer_export", { onFail: (failedJobId) => markDomainRecordFailed(repository, "LAYER_EXPORT", failedJobId) });
    return reply.code(202).send({ job, layerExport: publicLayerExport(layerExport) });
  });
}
