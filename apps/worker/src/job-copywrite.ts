import type { JobRecord } from "@ecomgen/core";
import type { CopywritingTarget } from "@ecomgen/contracts";
import { LISTING_PLATFORMS } from "@ecomgen/contracts";
import type { ListingPlatform } from "@ecomgen/contracts";
import { writeCopywriting, writeListingCopy } from "@ecomgen/agent";
import { buildReasoningModel } from "@ecomgen/providers";
import { assignImageHandles, imageHandle, selectVisionAssets } from "./visual-assets.js";
import type { WorkerContext } from "./context.js";

/** 花型 Listing 文案：看图写跨境标题/tags/描述；结果存 pattern_listing_results，不进项目域。 */
export async function executePatternListing(ctx: WorkerContext, job: JobRecord): Promise<void> {
  const { repository, storage, secrets, updateJob, throwIfCancelled, providerFor, cachedCompressForVision } = ctx;
  throwIfCancelled(job);
  const input = job.input as { patternId?: unknown; platform?: unknown; sellingPoints?: unknown; mustIncludeWords?: unknown; bannedWords?: unknown };
  const pattern = repository.getPattern(typeof input.patternId === "string" ? input.patternId : "");
  if (!pattern?.storagePath) throw new Error("Pattern artwork is missing for this listing job");
  const platform = typeof input.platform === "string" && (LISTING_PLATFORMS as readonly string[]).includes(input.platform) ? (input.platform as ListingPlatform) : null;
  if (!platform) throw new Error("Listing job has an invalid platform");
  const provider = providerFor(job.providerId);
  const model = provider.models.find((candidate) => candidate.id === job.modelId);
  if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
  if (!model.supportsVision) throw new Error("Selected reasoning model must support Vision for listing copy");
  await updateJob(job, { progress: 25 });
  const original = await storage.read(pattern.storagePath);
  const attachment = await cachedCompressForVision(original, pattern.fileHash ?? undefined);
  const result = await writeListingCopy({
    model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking, supportsStructuredOutput: model.supportsStructuredOutput }),
    apiKey: secrets.decrypt(provider.encryptedApiKey),
    platform,
    patternName: pattern.name,
    category: null,
    sellingPoints: typeof input.sellingPoints === "string" && input.sellingPoints.trim() ? input.sellingPoints.trim() : null,
    mustIncludeWords: typeof input.mustIncludeWords === "string" && input.mustIncludeWords.trim() ? input.mustIncludeWords.trim() : null,
    bannedWords: typeof input.bannedWords === "string" && input.bannedWords.trim() ? input.bannedWords.trim() : null,
    patternImages: [{ type: "image", mimeType: attachment.mimeType, data: attachment.data.toString("base64") }],
  });
  throwIfCancelled(job);
  repository.savePatternListingResult({ jobId: job.id, patternId: pattern.id, platform, copy: result });
  await updateJob(job, { progress: 90 });
}

export async function executeCopywriting(ctx: WorkerContext, job: JobRecord): Promise<void> {
  const { repository, secrets, updateJob, throwIfCancelled, projectFor, providerFor, visionImageContents } = ctx;
  // LISTING 由花型工坊发起、不绑定项目：走独立的看图写文案分支，复用 COPYWRITE 的队列与推理链路。
  if (job.input.target === "LISTING") return executePatternListing(ctx, job);
  throwIfCancelled(job);
  const project = projectFor(job);
  const provider = providerFor(project.reasoningProviderId);
  const model = provider.models.find((candidate) => candidate.id === project.reasoningModelId);
  if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
  if (!model.supportsVision) throw new Error("Selected reasoning model must support Vision for AI copywriting");
  const assets = selectVisionAssets(repository.listAssets(project.id));
  if (!assets.some((asset) => asset.role === "PRODUCT_TRUTH")) throw new Error("AI copywriting requires at least one product image");
  const target = job.input.target;
  if (target !== "PRODUCT_DESCRIPTION" && target !== "PLANNING_INSTRUCTION") throw new Error("Copywriting job has an invalid target");
  await updateJob(job, { progress: 25 });
  const visualAttachments = await visionImageContents(assets);
  const imageHandles = assignImageHandles(assets);
  const result = await writeCopywriting({
    target: target as CopywritingTarget,
    model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking, supportsStructuredOutput: model.supportsStructuredOutput }),
    apiKey: secrets.decrypt(provider.encryptedApiKey),
    projectName: project.name,
    productCategory: project.category,
    productDescription: project.productDescription,
    verifiedFacts: project.verifiedFacts,
    prohibitedClaims: project.prohibitedClaims,
    platformTargets: project.platformTargets,
    targetMarket: project.targetMarket,
    copyLanguage: project.copyLanguage,
    assets: assets.map((asset) => ({ handle: imageHandle(imageHandles, asset.id), role: asset.role, name: asset.originalName, mimeType: asset.mimeType })),
    referenceImages: visualAttachments,
  });
  throwIfCancelled(job);
  repository.saveCopywritingResult({ jobId: job.id, projectId: project.id, target: result.target, content: result.content });
  await updateJob(job, { progress: 90 });
}
