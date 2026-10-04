import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { EditTurnRecord, JobRecord, ProjectRecord } from "@ecomgen/core";
import { EXTERNAL_REQUEST_STARTED } from "@ecomgen/core";
import { MAX_CANDIDATES_PER_TYPE, resolveImageSize } from "@ecomgen/contracts";
import type { CompositePolicy, EditExecutionMode, EditOperation, ImageResolution } from "@ecomgen/contracts";
import { planImageEdit } from "@ecomgen/agent";
import { buildReasoningModel } from "@ecomgen/providers";
import { imageEditCapabilitiesFor } from "@ecomgen/providers";
import { assertEditCapabilities, assertSameDimensions, compositeMaskedEdit, compositeNaturalBlend, compositeOutpaint, createOutpaintCanvas, providerMaskFor } from "./edit-imaging.js";
import { generationKeyFor, mimeForStoragePath, outputDerivatives } from "./context.js";
import { openAiEditSize, openAiImageQuality } from "./image-params.js";
import { enqueue } from "@ecomgen/jobs";
import type { WorkerContext } from "./context.js";

interface EditGenerationConfig { reasoningProviderId: string; reasoningModelId: string; imageProviderId: string; imageModelId: string; imageResolution: ImageResolution; candidateCount: number; }

function editGenerationConfigFor(project: ProjectRecord, turn: EditTurnRecord): EditGenerationConfig {
  // 编辑链路允许注解覆盖模型，但 fallback 始终依赖项目引用；引用为空时直接失败而不是产出 null 配置
  if (!project.reasoningProviderId || !project.reasoningModelId || !project.imageProviderId || !project.imageModelId) {
    throw new Error("该项目尚未选择推理与图片模型（Provider 可能已被删除），请在项目设置中重新选择");
  }
  const defaults = { reasoningProviderId: project.reasoningProviderId, reasoningModelId: project.reasoningModelId, imageProviderId: project.imageProviderId, imageModelId: project.imageModelId, imageResolution: project.imageResolution, candidateCount: Math.min(MAX_CANDIDATES_PER_TYPE, Math.max(1, Math.round(project.candidatesPerType))) };
  const raw = (turn.annotations as Record<string, unknown>).generationConfig;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const config = raw as Record<string, unknown>;
  const readId = (key: keyof Pick<EditGenerationConfig, "reasoningProviderId" | "reasoningModelId" | "imageProviderId" | "imageModelId">) => typeof config[key] === "string" && config[key] ? config[key] as string : defaults[key];
  const resolution = config.imageResolution === "1K" || config.imageResolution === "2K" || config.imageResolution === "4K" ? config.imageResolution : defaults.imageResolution;
  const candidateCount = typeof config.candidateCount === "number" && Number.isFinite(config.candidateCount) ? Math.min(MAX_CANDIDATES_PER_TYPE, Math.max(1, Math.round(config.candidateCount))) : defaults.candidateCount;
  return { reasoningProviderId: readId("reasoningProviderId"), reasoningModelId: readId("reasoningModelId"), imageProviderId: readId("imageProviderId"), imageModelId: readId("imageModelId"), imageResolution: resolution, candidateCount };
}

function effectiveEditMemory(repository: WorkerContext["repository"], session: { memorySummary: { summary?: string; constraints?: string[]; scopes?: Record<string, { summary?: string; constraints?: string[] }> } }, outputId: string): { summary?: string; constraints?: string[] } {
  let current = repository.getOutput(outputId);
  while (current) {
    const scoped = session.memorySummary.scopes?.[current.id];
    if (scoped) return scoped;
    current = current.parentOutputId ? repository.getOutput(current.parentOutputId) : undefined;
  }
  const output = repository.getOutput(outputId);
  return output && !output.parentOutputId ? { summary: session.memorySummary.summary, constraints: session.memorySummary.constraints } : {};
}

function canvasExpansionFor(turn: EditTurnRecord): { top: number; right: number; bottom: number; left: number } | null {
  const value = (turn.annotations as Record<string, unknown>).canvasExpansion;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const expansion = value as Record<string, unknown>;
  const read = (edge: "top" | "right" | "bottom" | "left") => typeof expansion[edge] === "number" && Number.isFinite(expansion[edge]) ? Math.max(0, Math.round(expansion[edge])) : 0;
  const result = { top: read("top"), right: read("right"), bottom: read("bottom"), left: read("left") };
  return result.top || result.right || result.bottom || result.left ? result : null;
}

function editTurnFor(ctx: WorkerContext, job: JobRecord): EditTurnRecord {
  const turnId = typeof job.input.editTurnId === "string" ? job.input.editTurnId : "";
  const turn = ctx.repository.getEditTurn(turnId);
  if (!turn || turn.projectId !== job.projectId) throw new Error("Edit turn is missing or belongs to another project");
  return turn;
}

export async function executeEditPlan(ctx: WorkerContext, job: JobRecord): Promise<void> {
  const { repository, secrets, events, updateJob, throwIfCancelled, projectFor, providerFor, visionSourceImage } = ctx;
  const turn = editTurnFor(ctx, job);
  const project = projectFor(job);
  const config = editGenerationConfigFor(project, turn);
  const provider = providerFor(config.reasoningProviderId);
  const model = provider.models.find((candidate) => candidate.id === config.reasoningModelId);
  if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
  await updateJob(job, { progress: 25 });
  const session = repository.getEditSession(turn.sessionId); if (!session) throw new Error("Edit session is missing");
  const assets = repository.listAssets(project.id);
  const imageProvider = providerFor(config.imageProviderId);
  const imageModel = imageProvider.models.find((candidate) => candidate.id === config.imageModelId);
  const temporaryAssets = repository.listEditReferenceAssets(turn.sessionId).filter((asset) => asset.expiresAt > new Date().toISOString());
  const references = turn.referenceSelections.slice().sort((left, right) => left.order - right.order).flatMap((selection) => {
    const asset = selection.source === "PROJECT" ? assets.find((candidate) => candidate.id === selection.id) : temporaryAssets.find((candidate) => candidate.id === selection.id);
    return asset ? [{ id: asset.id, name: asset.originalName, role: "role" in asset ? asset.role : "TEMPORARY", source: selection.source, purpose: selection.purpose, order: selection.order }] : [];
  });
  const source = repository.getOutput(turn.baseOutputId); if (!source) throw new Error("Edit source output is missing");
  let plan;
  try {
    plan = await planImageEdit({
      model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking, supportsStructuredOutput: model.supportsStructuredOutput }),
      apiKey: secrets.decrypt(provider.encryptedApiKey),
      message: turn.message,
      annotations: turn.annotations,
      hasEditMask: Boolean(turn.editMaskPath),
      hasCanvasExpansion: Boolean((turn.annotations as Record<string, unknown>).canvasExpansion),
      referenceAssets: references,
      memorySummary: effectiveEditMemory(repository, session, turn.baseOutputId),
      projectFacts: project.verifiedFacts,
      imageCapabilities: imageModel ? imageEditCapabilitiesFor(imageModel) ?? undefined : undefined,
      sourceImage: model.supportsVision ? await visionSourceImage(source.storagePath) : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (["REFERENCE_ASSET_REQUIRED", "EDIT_TARGET_REQUIRED", "OUTPAINT_CANVAS_REQUIRED", "EDIT_VISION_REQUIRED"].includes(message)) {
      const updated = repository.updateEditTurn(turn.id, { status: "NEED_INPUT", error: { message } });
      if (updated) await events.publish(project.id, "edit-turn.updated", { turn: updated });
      await updateJob(job, { progress: 90 });
      return;
    }
    throw error;
  }
  throwIfCancelled(job);
  if (plan.executionMode === "NEED_INPUT") {
    const clarification = plan.clarification?.trim() || "请补充编辑目标或保护范围。";
    const updated = repository.updateEditTurn(turn.id, { status: "NEED_INPUT", plan: plan as unknown as Record<string, unknown>, error: { message: clarification } });
    if (updated) await events.publish(project.id, "edit-turn.updated", { turn: updated });
    await updateJob(job, { progress: 90 });
    return;
  }
  const status = plan.requiresConfirmation ? "AWAITING_CONFIRMATION" : "GENERATING";
  repository.updateEditTurn(turn.id, { status, plan: plan as unknown as Record<string, unknown>, error: null });
  await events.publish(project.id, "edit-turn.updated", { turn: repository.getEditTurn(turn.id) });
  if (!plan.requiresConfirmation) {
    const generation = repository.createJob({ id: randomUUID(), projectId: project.id, storyboardItemId: null, type: "EDIT_GENERATE", input: { editTurnId: turn.id }, requestFingerprint: null, providerId: config.imageProviderId, modelId: config.imageModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueue(ctx.executionQueue, { jobId: generation.id, kind: "edit_generate" });
  }
  await updateJob(job, { progress: 90 });
}

export async function executeEditGeneration(ctx: WorkerContext, job: JobRecord, signal: AbortSignal): Promise<void> {
  const { repository, storage, events, updateJob, throwIfCancelled, projectFor, providerFor, imageGeneratorFor } = ctx;
  const turn = editTurnFor(ctx, job);
  const project = projectFor(job);
  const config = editGenerationConfigFor(project, turn);
  const session = repository.getEditSession(turn.sessionId); if (!session) throw new Error("Edit session is missing");
  const source = repository.getOutput(turn.baseOutputId); if (!source || source.projectId !== project.id) throw new Error("Edit source output is missing or belongs to another project");
  const plan = turn.plan as { operation?: EditOperation; executionMode?: EditExecutionMode; prompt?: string; compositePolicy?: CompositePolicy; targetDescription?: string; targetConfidence?: number; memoryPatch?: { summary?: string; constraints?: string[] } } | null;
  if (!plan?.operation || !plan.executionMode || !plan.prompt || !plan.compositePolicy || plan.executionMode === "NEED_INPUT") throw new Error("Edit turn has no executable plan");
  if (plan.executionMode === "MASKED" && !turn.editMaskPath) throw new Error("EDIT_TARGET_REQUIRED: 局部编辑需要先标记可编辑区域");
  const outpaintExpansion = plan.compositePolicy === "OUTPAINT" ? canvasExpansionFor(turn) : null;
  if (plan.compositePolicy === "OUTPAINT" && !outpaintExpansion) throw new Error("OUTPAINT_CANVAS_REQUIRED");
  if (plan.compositePolicy === "MASK_LOCKED" && !turn.editMaskPath) throw new Error("EDIT_TARGET_REQUIRED");
  const provider = providerFor(config.imageProviderId);
  const model = provider.models.find((candidate) => candidate.id === config.imageModelId);
  if (!model || (model.imageApiKind !== "openai_images" && model.imageApiKind !== "gemini")) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持图像编辑");
  const capabilities = imageEditCapabilitiesFor(model); if (!capabilities) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持图像编辑");
  if (plan.executionMode === "MODEL_DIRECTED" && !capabilities.supportsUnmaskedEdit) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持无蒙版编辑");
  await updateJob(job, { progress: 30 });
  const sourceImage = await storage.read(source.storagePath);
  const mask = turn.editMaskPath ? await storage.read(turn.editMaskPath) : undefined;
  if (mask) await assertSameDimensions(sourceImage, mask);
  const generator = imageGeneratorFor(provider, model);
  const assets = repository.listAssets(project.id);
  const temporaryAssets = repository.listEditReferenceAssets(turn.sessionId).filter((asset) => asset.expiresAt > new Date().toISOString());
  const references = await Promise.all(turn.referenceSelections.slice().sort((left, right) => left.order - right.order).map(async (selection) => {
    const asset = selection.source === "PROJECT" ? assets.find((candidate) => candidate.id === selection.id) : temporaryAssets.find((candidate) => candidate.id === selection.id);
    if (!asset) throw new Error(`Reference asset is missing: ${selection.id}`);
    return { data: await storage.read(asset.storagePath), filename: asset.originalName, mimeType: asset.mimeType };
  }));
  assertEditCapabilities(capabilities, plan.operation as EditOperation, plan.executionMode, Boolean(mask), references.length);
  const outpaintCanvas = outpaintExpansion ? await createOutpaintCanvas(sourceImage, outpaintExpansion) : null;
  const inputImage = outpaintCanvas?.image ?? sourceImage;
  const providerMask = outpaintCanvas?.mask ?? (plan.executionMode === "MASKED" && mask ? await providerMaskFor(sourceImage, mask, turn.protectMaskPath ? await storage.read(turn.protectMaskPath) : undefined) : undefined);
  const protectedMask = turn.protectMaskPath ? await storage.read(turn.protectMaskPath) : undefined;
  const createdOutputs: Array<ReturnType<typeof repository.createOutput>> = [];
  for (let candidateIndex = 1; candidateIndex <= config.candidateCount; candidateIndex += 1) {
    const generationKey = generationKeyFor(job.id, candidateIndex);
    const existingOutput = repository.getOutputByGenerationKey(generationKey);
    if (existingOutput) {
      createdOutputs.push(existingOutput);
      continue;
    }
    await updateJob(job, { providerTaskId: EXTERNAL_REQUEST_STARTED });
    const editInput = {
      model: model.id,
      prompt: plan.prompt,
      // 源产物可能是 webp/jpeg（格式兜底转码后落盘）：按存储路径标注真实 MIME，硬标 png 会被按声明校验的渠道拒收。
      sourceImage: { data: inputImage, filename: `source${mimeForStoragePath(source.storagePath).replace("image/", ".")}`, mimeType: mimeForStoragePath(source.storagePath) },
      referenceImages: references,
      mask: providerMask ? { data: providerMask, filename: "edit-mask.png", mimeType: "image/png" } : undefined,
      operation: plan.operation as EditOperation,
      idempotencyKey: generationKey
    };
    const result = await generator.editImage(model.imageApiKind === "gemini"
      ? { ...editInput, imageAspectRatio: project.imageAspectRatio, imageResolution: config.imageResolution, signal }
      : {
        ...editInput,
        quality: openAiImageQuality(model.id, undefined),
        // Seedream 按档位 × 比例下发显式像素；其余模型维持原折叠值（AUTO 折叠为模板缺省尺寸）。
        size: openAiEditSize(model.id, config.imageResolution, project.imageAspectRatio, resolveImageSize(config.imageResolution, project.imageAspectRatio, "1024x1024")),
        inputFidelity: capabilities.supportsInputFidelity ? "high" : undefined,
        signal
      });
    throwIfCancelled(job);
    await updateJob(job, { progress: 30 + Math.round((candidateIndex / config.candidateCount) * 45), providerTaskId: result.providerTaskId ?? EXTERNAL_REQUEST_STARTED });
    const composed = plan.executionMode === "MASKED" && plan.compositePolicy === "MASK_LOCKED" && mask
      ? await compositeMaskedEdit(sourceImage, result.image, mask, protectedMask)
      : plan.executionMode === "MASKED" && plan.compositePolicy === "NATURAL_BLEND"
        ? await compositeNaturalBlend(sourceImage, result.image, mask, protectedMask)
        : outpaintCanvas
          ? await compositeOutpaint(sourceImage, result.image, outpaintCanvas)
          : await sharp(result.image).png().toBuffer();
    const stored = await storage.putOutput(project.id, composed, ".png", generationKey);
    const { width, height } = await outputDerivatives(storage, stored.hash, composed);
    const output = repository.createOutput({ projectId: project.id, storyboardItemId: source.storyboardItemId, jobId: job.id, candidateIndex, generationSnapshot: { providerId: provider.id, modelId: model.id, resolution: config.imageResolution, aspectRatio: project.imageAspectRatio, size: "source", candidateIndex, operation: plan.operation, executionMode: plan.executionMode, targetDescription: plan.targetDescription, targetConfidence: plan.targetConfidence, sourceOutputId: source.id, maskHash: turn.editMaskHash, protectMaskHash: turn.protectMaskHash, compositePolicy: plan.compositePolicy, referenceSelections: turn.referenceSelections, referenceHashes: Object.fromEntries(turn.referenceSelections.map((selection) => { const asset = selection.source === "PROJECT" ? assets.find((candidate) => candidate.id === selection.id) : temporaryAssets.find((candidate) => candidate.id === selection.id); return [selection.id, asset?.hash ?? null]; })) }, storagePath: stored.path, hash: stored.hash, width, height, generationKey, parentOutputId: source.id, rootOutputId: source.rootOutputId ?? source.id, editSessionId: session.id, editTurnId: turn.id });
    await updateJob(job, { providerTaskId: null });
    createdOutputs.push(output);
  }
  const output = createdOutputs.at(-1);
  if (!output) throw new Error("Edit generation produced no outputs");
  await updateJob(job, { providerTaskId: null });
  const inheritedMemory = effectiveEditMemory(repository, session, source.id);
  const nextMemory = { summary: plan.memoryPatch?.summary ?? inheritedMemory.summary, constraints: plan.memoryPatch?.constraints ?? inheritedMemory.constraints };
  const updatedSession = repository.updateEditSession(session.id, { currentOutputId: output.id, memorySummary: { ...session.memorySummary, scopes: { ...(session.memorySummary.scopes ?? {}), [output.id]: nextMemory } } });
  repository.updateEditTurn(turn.id, { status: "SUCCEEDED", error: null });
  if (updatedSession) await events.publish(project.id, "edit-session.updated", { session: updatedSession });
  for (const createdOutput of createdOutputs) await events.publish(project.id, "output.created", { output: createdOutput });
  await events.publish(project.id, "edit-turn.updated", { turn: repository.getEditTurn(turn.id) });
}
