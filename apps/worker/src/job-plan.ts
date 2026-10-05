import type { JobRecord } from "@ecomgen/core";
import { userAssetKindForRole } from "@ecomgen/contracts";
import type { ImageAspectRatio, ImageResolution, PlanningMode } from "@ecomgen/contracts";
import { planStoryboard } from "@ecomgen/agent";
import { buildReasoningModel } from "@ecomgen/providers";
import { assignImageHandles, imageHandle, selectVisionAssets, visionAttachmentMetadata } from "./visual-assets.js";
import type { WorkerContext } from "./context.js";

export async function executePlan(ctx: WorkerContext, job: JobRecord): Promise<void> {
  const { repository, suiteCatalog, secrets, events, updateJob, throwIfCancelled, projectFor, providerFor, visionImageContents, compiledUserTemplates, configuredWebResearch } = ctx;
  throwIfCancelled(job);
  // 计划阶段重新扫描套图目录与用户套图，保证刚导入的竞图套图立即对规划可见。
  await suiteCatalog.refresh();
  const project = projectFor(job); const provider = providerFor(project.reasoningProviderId); const model = provider.models.find((candidate) => candidate.id === project.reasoningModelId);
  if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
  await updateJob(job, { progress: 25 });
  const assets = repository.listAssets(project.id);
  const visualAssets = selectVisionAssets(assets);
  const referenceImages = model.supportsVision ? await visionImageContents(visualAssets) : undefined;
  const input = job.input as { planningMode?: PlanningMode; requestedTypes?: string[]; requestedSuiteShots?: string[]; userInstruction?: string; candidatesPerType?: number; targetImageCount?: number; imageResolution?: ImageResolution; imageAspectRatio?: ImageAspectRatio };
  if (input.imageResolution || input.imageAspectRatio || input.candidatesPerType) {
    repository.updateProject(project.id, {
      imageResolution: input.imageResolution ?? project.imageResolution,
      imageAspectRatio: input.imageAspectRatio ?? project.imageAspectRatio,
      candidatesPerType: input.candidatesPerType ?? project.candidatesPerType
    });
  }
  // 模型上下文只出现 P1/R1 短指代；真实素材 ID 不进入任何提示词，映射在代码内完成。
  const imageHandles = assignImageHandles(assets);
  const plannerAssets = visualAssets.map((asset) => ({ id: asset.id, handle: imageHandle(imageHandles, asset.id), role: asset.role, kind: userAssetKindForRole(asset.role), name: asset.originalName, mimeType: asset.mimeType }));
  const webResearch = project.webResearchEnabled ? configuredWebResearch() : undefined;
  repository.createWebResearchAudit(job.id, webResearch ? "AVAILABLE" : project.webResearchEnabled ? "UNAVAILABLE" : "DISABLED");
  const plan = await planStoryboard({
    model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking, supportsStructuredOutput: model.supportsStructuredOutput }),
    apiKey: secrets.decrypt(provider.encryptedApiKey),
    projectName: project.name,
    productCategory: project.category,
    productDescription: project.productDescription,
    verifiedFacts: project.verifiedFacts,
    prohibitedClaims: project.prohibitedClaims,
    brandGuidelines: project.brandGuidelines,
    platformTargets: project.platformTargets,
    targetMarket: project.targetMarket,
    copyLanguage: project.copyLanguage,
    promptLanguage: project.promptLanguage,
    defaultMode: project.defaultMode,
    assets: plannerAssets,
    referenceImages,
    visionAttachments: visionAttachmentMetadata(visualAssets.map((asset) => ({ ...asset, name: asset.originalName })), imageHandles),
    planningMode: input.planningMode ?? "AI",
    requestedTypes: input.requestedTypes,
    requestedSuiteShots: input.requestedSuiteShots,
    suites: suiteCatalog.listSuites(),
    userTemplates: compiledUserTemplates(),
    userInstruction: input.userInstruction,
    candidatesPerType: input.candidatesPerType ?? project.candidatesPerType,
    targetImageCount: input.targetImageCount,
    webResearch: webResearch ? {
      ...webResearch,
      audit: {
        onSearchStarted: () => repository.recordWebResearchSearch(job.id),
        onSourceAttempt: (attempt) => repository.recordWebResearchAttempt({ jobId: job.id, ...attempt })
      }
    } : undefined
  });
  throwIfCancelled(job);
  const storyboard = repository.saveStoryboard(project.id, plan.campaignStyleLock, "DRAFT", plan.items.map((item) => ({ ...item, status: "DRAFT", compiledPrompt: null })));
  repository.createPlanningConfigSnapshot({
    projectId: project.id,
    sourceJobId: job.id,
    payload: {
      project: {
        name: project.name, category: project.category, productDescription: project.productDescription,
        verifiedFacts: project.verifiedFacts, prohibitedClaims: project.prohibitedClaims, brandGuidelines: project.brandGuidelines,
        platformTargets: project.platformTargets, targetMarket: project.targetMarket, copyLanguage: project.copyLanguage,
        promptLanguage: project.promptLanguage,
        reasoningProviderId: project.reasoningProviderId, reasoningModelId: project.reasoningModelId,
        imageProviderId: project.imageProviderId, imageModelId: project.imageModelId, defaultMode: project.defaultMode,
        imageResolution: input.imageResolution ?? project.imageResolution, imageAspectRatio: input.imageAspectRatio ?? project.imageAspectRatio,
        candidatesPerType: input.candidatesPerType ?? project.candidatesPerType, webResearchEnabled: project.webResearchEnabled,
      },
      planning: {
        planningMode: input.planningMode ?? "AI", requestedTypes: input.requestedTypes ?? [], requestedSuiteShots: input.requestedSuiteShots ?? [],
        targetImageCount: input.targetImageCount ?? null, userInstruction: input.userInstruction ?? null,
      },
    },
  });
  await updateJob(job, { progress: 90 }); await events.publish(project.id, "storyboard.updated", { storyboard, items: repository.listStoryboardItems(project.id) });
}
