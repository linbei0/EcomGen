import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { JobRecord } from "@ecomgen/core";
import { requestFingerprint } from "@ecomgen/core";
import { getTemplate, isUserTemplateId } from "@ecomgen/ecom-skill";
import {
  ConfirmStoryboardInput,
  CreateGenerationJobInput,
  UpdateStoryboardItemInput,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
} from "@ecomgen/contracts";
import type { ImageAspectRatio, ImageResolution, StoryboardMode } from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import { candidatesPerType, clampCandidates, ensureProject, missing, verifyModel } from "../helpers.js";
import { parseBody } from "../http-input.js";
import { enumValue, parameter, readObject, readOptionalText, readText, readTextArray } from "../input-normalizers.js";

export function registerStoryboardRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { database, repository, enqueueOrMarkFailed } = ctx;
  app.get("/api/v1/projects/:projectId/storyboard", async (request) => {
    const projectId = parameter(request, "projectId"); ensureProject(repository, projectId); return { storyboard: repository.getStoryboard(projectId) ?? null, items: repository.listStoryboardItems(projectId) };
  });
  app.patch("/api/v1/storyboard-items/:itemId", async (request) => {
    const itemId = parameter(request, "itemId"); const current = repository.getStoryboardItem(itemId); if (!current) missing("storyboard item", itemId); const body = parseBody(UpdateStoryboardItemInput, request.body);
    if (current.status === "GENERATING") {
      throw new ApiError(409, "CONFLICT", "Generating storyboard items cannot be updated");
    }
    if (current.status === "GENERATED" && (body.assetType !== undefined || body.displayName !== undefined || body.templateVariant !== undefined || body.referencedAssets !== undefined || body.mode !== undefined || body.promptInstruction !== undefined)) {
      throw new ApiError(409, "CONFLICT", "Generated storyboard items only allow generation-setting updates");
    }
    const patch: Record<string, unknown> = {};
    if (body.assetType !== undefined) {
      const templateId = readText(body.assetType, "assetType");
      if (templateId !== current.assetType) throw new ApiError(409, "CONFLICT", "Storyboard item image type is immutable");
      // assetType 不可变：这里只放行"仍可解析"的既有值（内置模板或未删除的自定义模板）
      if (!getTemplate(templateId) && !(isUserTemplateId(templateId) && repository.getUserTemplate(templateId))) throw new ApiError(400, "VALIDATION_ERROR", "assetType must be an ecom-details-image template ID");
    }
    if (body.displayName !== undefined) patch.displayName = readText(body.displayName, "displayName");
    if (body.templateVariant !== undefined) { const template = getTemplate(String(patch.assetType ?? current.assetType)); const variant = readOptionalText(body.templateVariant) ?? null; if (variant && !template?.variants[variant]) throw new ApiError(400, "VALIDATION_ERROR", "templateVariant is not declared by the selected ecom-details-image template"); patch.templateVariant = variant; }
    if (body.candidateCount !== undefined) patch.candidateCount = candidatesPerType(body.candidateCount);
    if (body.imageModel !== undefined) {
      const model = readObject(body.imageModel, "imageModel");
      const providerId = readText(model.providerId, "imageModel.providerId");
      const modelId = readText(model.modelId, "imageModel.modelId");
      verifyModel(repository, providerId, modelId, "image");
      patch.imageProviderId = providerId;
      patch.imageModelId = modelId;
    }
    if (body.imageResolution !== undefined) patch.imageResolution = enumValue<ImageResolution>(body.imageResolution, IMAGE_RESOLUTIONS, "imageResolution");
    if (body.imageAspectRatio !== undefined) patch.imageAspectRatio = enumValue<ImageAspectRatio>(body.imageAspectRatio, IMAGE_ASPECT_RATIOS, "imageAspectRatio");
    if (body.referencedAssets !== undefined) {
      const ids = readTextArray(body.referencedAssets, "referencedAssets");
      const known = new Set(repository.listAssets(current.projectId).map((asset) => asset.id));
      if (ids.some((id) => !known.has(id))) throw new ApiError(400, "VALIDATION_ERROR", "referencedAssets must belong to this project");
      patch.referencedAssets = ids;
    }
    if (body.mode !== undefined) patch.mode = enumValue<StoryboardMode>(body.mode, ["CREATIVE", "PIXEL_PROTECTED"], "mode");
    if (body.promptInstruction !== undefined) patch.promptInstruction = readText(body.promptInstruction, "promptInstruction");
    return repository.updateStoryboardItem(itemId, patch) as object;
  });
  app.delete("/api/v1/storyboard-items/:itemId", async (request, reply) => {
    const itemId = parameter(request, "itemId");
    const current = repository.getStoryboardItem(itemId);
    if (!current) missing("storyboard item", itemId);
    if (current.status === "GENERATING" || current.status === "GENERATED") {
      throw new ApiError(409, "CONFLICT", "Generated or generating storyboard items cannot be deleted");
    }
    repository.deleteStoryboardItem(itemId);
    return reply.code(204).send();
  });
  app.post("/api/v1/projects/:projectId/storyboard/confirm", async (request) => {
    const projectId = parameter(request, "projectId");
    const storyboard = repository.getStoryboard(projectId); if (!storyboard) throw new ApiError(409, "CONFLICT", "A draft storyboard must exist before confirmation");
    // 确认携带发起编辑时看到的版本：与当前版本不一致即并发冲突，拒绝并带回当前版本，防止旧页面覆盖新页面
    const body = parseBody(ConfirmStoryboardInput, request.body ?? {});
    if (body.version !== storyboard.version) {
      throw new ApiError(409, "CONFLICT", `分镜已被其他修改更新（当前版本 ${storyboard.version}），请刷新后重试`, [{ path: "/version", reason: `expected ${storyboard.version}` }]);
    }
    return repository.confirmStoryboard(projectId) as object;
  });
  app.post("/api/v1/projects/:projectId/generation-jobs", async (request, reply) => {
    const projectId = parameter(request, "projectId"); const storyboard = repository.getStoryboard(projectId); if (!storyboard || storyboard.status !== "CONFIRMED") throw new ApiError(409, "CONFLICT", "Confirm the storyboard before generation");
    const body = parseBody(CreateGenerationJobInput, request.body); const itemIds = readTextArray(body.storyboardItemIds, "storyboardItemIds"); if (itemIds.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "At least one storyboardItemId is required");
    const config = body.generationConfig ?? null;
    const revision = readOptionalText(body.revision);
    const requestedBatchId = readOptionalText(body.generationBatchId);
    const generationBatchId = requestedBatchId ?? (revision === "retry"
      ? repository.listOutputs(projectId).find((output) => itemIds.includes(output.storyboardItemId) && !output.editSessionId)?.generationBatchId ?? randomUUID()
      : randomUUID());
    const overrideResolution = config?.imageResolution === undefined ? undefined : enumValue<ImageResolution>(config.imageResolution, IMAGE_RESOLUTIONS, "generationConfig.imageResolution");
    const overrideAspect = config?.imageAspectRatio === undefined ? undefined : enumValue<ImageAspectRatio>(config.imageAspectRatio, IMAGE_ASPECT_RATIOS, "generationConfig.imageAspectRatio");
    const overrideCandidates = config?.candidateCount === undefined ? undefined : candidatesPerType(config.candidateCount);
    const overrideModel = config?.imageModel;
    const overrideProviderId = overrideModel ? readText(overrideModel.providerId, "generationConfig.imageModel.providerId") : undefined;
    const overrideModelId = overrideModel ? readText(overrideModel.modelId, "generationConfig.imageModel.modelId") : undefined;
    if (overrideProviderId && overrideModelId) verifyModel(repository, overrideProviderId, overrideModelId, "image");
    const project = repository.getProject(projectId); if (!project) missing("project", projectId);
    // 先完整校验全部 item，再在单个事务里创建任务：部分写入后返回 400 会留下不可执行的孤儿任务
    const plans = itemIds.map((itemId) => {
      const item = repository.getStoryboardItem(itemId); if (!item || item.projectId !== projectId) throw new ApiError(400, "VALIDATION_ERROR", "Storyboard item does not belong to this project");
      if (!overrideProviderId || !overrideModelId) verifyModel(repository, item.imageProviderId, item.imageModelId, "image");
      return { item, candidateCount: overrideCandidates ?? clampCandidates(item.candidateCount) };
    });
    const jobs: JobRecord[] = [];
    const created: JobRecord[] = [];
    const writeJobs = database.transaction(() => {
      for (const { item, candidateCount } of plans) {
        // 有效 Provider/模型参与指纹：切换 Provider 或模型必须产生新任务，不能复用旧结果
        const effectiveProviderId = overrideProviderId ?? item.imageProviderId;
        const effectiveModelId = overrideModelId ?? item.imageModelId;
        for (let index = 0; index < candidateCount; index++) {
          const input = {
            revision,
            generationBatchId,
            candidateIndex: index + 1,
            imageResolution: overrideResolution ?? item.imageResolution,
            imageAspectRatio: overrideAspect ?? item.imageAspectRatio
          };
          const { generationBatchId: _generationBatchId, ...fingerprintInput } = input;
          const fingerprint = requestFingerprint({ type: "GENERATE", projectId, itemId: item.id, storyboardVersion: storyboard.version, itemUpdatedAt: item.updatedAt, providerId: effectiveProviderId, modelId: effectiveModelId, input: fingerprintInput, idempotencyKey: request.headers["idempotency-key"] ?? null });
          const existing = repository.findJobByFingerprint(projectId, fingerprint);
          if (existing) { jobs.push(existing); continue; }
          const job = repository.createJob({ id: randomUUID(), projectId, storyboardItemId: item.id, type: "GENERATE", input, requestFingerprint: fingerprint, providerId: effectiveProviderId, modelId: effectiveModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
          jobs.push(job); created.push(job);
        }
      }
    });
    writeJobs();
    // 入队失败只回滚本次新建的任务：按指纹复用的既有任务不属于本请求的失败面
    await enqueueOrMarkFailed(jobs, "generate", { markable: created });
    return reply.code(202).send({ jobs });
  });
}
