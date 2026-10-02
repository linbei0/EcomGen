import { writePsdBuffer } from "ag-psd";
import sharp from "sharp";
import type { JobRecord } from "@ecomgen/core";
import { EXTERNAL_REQUEST_STARTED } from "@ecomgen/core";
import type { LayerExportLayerFileRecord, LayerExportRecord, LayerPlanRecord } from "@ecomgen/core";
import { isSegmentationProtocol, SEGMENTATION_PROTOCOL_CAPABILITIES } from "@ecomgen/contracts";
import { planLayerElements } from "@ecomgen/agent";
import { buildReasoningModel } from "@ecomgen/providers";
import { SeedreamLayerizeProvider, createSegmentationProvider } from "@ecomgen/providers";
import { createPsdLayerAccumulator, extractAlpha, invertMask, multiplyAlpha, unionOfMasks } from "./layer-composite.js";
import { decodeRgba, maskHasForeground, normalizeMask, pngFromRgba } from "./mask-utils.js";
import { seedreamLayerizePrompt, seedreamLayerMask, seedreamMatches } from "./seedream-layerize.js";
import { mimeForStoragePath, safeName, projectIdFor, JobCancelled } from "./context.js";
import type { WorkerContext } from "./context.js";

function layerPlanFor(ctx: WorkerContext, job: JobRecord): LayerPlanRecord { const plan = ctx.repository.getLayerPlanByJobId(job.id); if (!plan || plan.projectId !== job.projectId) throw new Error("Layer plan is missing or belongs to another project"); return plan; }
function layerExportFor(ctx: WorkerContext, job: JobRecord): LayerExportRecord { const record = ctx.repository.getLayerExportByJobId(job.id); if (!record || record.projectId !== job.projectId) throw new Error("Layer export is missing or belongs to another project"); return record; }

interface LayerExportElementInput { id: string; name: string; promptEn?: string; source: "auto" | "manual" | "prompt"; bbox: { x: number; y: number; width: number; height: number } | null; }
// 导入元素来自 job.input（API 已用契约校验）；这里做最小防御性解析，manual 无 bbox 直接失败。
function layerExportElementsFor(job: JobRecord): LayerExportElementInput[] {
  const raw = Array.isArray(job.input.elements) ? job.input.elements : [];
  const elements = raw.flatMap((entry): LayerExportElementInput[] => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    if (typeof value.id !== "string" || typeof value.name !== "string" || (value.source !== "auto" && value.source !== "manual" && value.source !== "prompt")) return [];
    const promptEn = typeof value.promptEn === "string" && value.promptEn.trim().length > 0 ? value.promptEn : undefined;
    const bboxRaw = value.bbox as Record<string, unknown> | null | undefined;
    const bbox = bboxRaw && typeof bboxRaw.x === "number" && typeof bboxRaw.y === "number" && typeof bboxRaw.width === "number" && typeof bboxRaw.height === "number"
      ? { x: bboxRaw.x, y: bboxRaw.y, width: bboxRaw.width, height: bboxRaw.height }
      : null;
    if (value.source === "manual" && !bbox) throw new Error(`手动元素「${value.name}」缺少画框坐标`);
    return [{ id: value.id, name: value.name, promptEn, source: value.source, bbox }];
  });
  if (elements.length === 0) throw new Error("Layer export has no elements");
  return elements;
}

export async function executeLayerPlan(ctx: WorkerContext, job: JobRecord): Promise<void> {
  const { repository, secrets, events, updateJob, throwIfCancelled, providerFor, visionSourceImage } = ctx;
  const plan = layerPlanFor(ctx, job);
  try {
    const output = repository.getOutput(plan.outputId);
    if (!output || output.projectId !== plan.projectId) throw new Error("Layer plan source output is missing or belongs to another project");
    // 排队时 API 已把推理 Provider/模型写入 input 并计入指纹；执行只认这份快照，指纹与执行配置保持一致。
    const reasoningProviderId = typeof job.input.reasoningProviderId === "string" ? job.input.reasoningProviderId : "";
    const reasoningModelId = typeof job.input.reasoningModelId === "string" ? job.input.reasoningModelId : "";
    if (!reasoningProviderId || !reasoningModelId) throw new Error("Layer plan job is missing its reasoning model snapshot");
    const provider = providerFor(reasoningProviderId);
    const model = provider.models.find((candidate) => candidate.id === reasoningModelId);
    if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
    if (!model.supportsVision) throw new Error("CAPABILITY_UNSUPPORTED: 图层识别需要视觉推理模型");
    await updateJob(job, { progress: 25 });
    // 执行前先落 RUNNING：否则前端在整个识别过程中都只能看到 QUEUED。
    const running = repository.updateLayerPlan(plan.id, { status: "RUNNING", error: null });
    if (running) await events.publish(projectIdFor(job), "layer-plan.updated", { plan: running });
    const image = await visionSourceImage(output.storagePath);
    throwIfCancelled(job);
    // 视觉识别是付费外部请求：标记后崩溃恢复一律按“结果未知”显式失败，不会重新执行已计费的调用。
    await updateJob(job, { providerTaskId: EXTERNAL_REQUEST_STARTED });
    const elements = await planLayerElements({
      model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking, supportsStructuredOutput: model.supportsStructuredOutput }),
      apiKey: secrets.decrypt(provider.encryptedApiKey),
      image
    });
    throwIfCancelled(job);
    // 元素 id 在方案内稳定（el-N）；前端勾选后原样回传，manual 元素由前端自带 id。
    const records = elements.map((element, index) => ({ id: `el-${index + 1}`, name: element.name, promptEn: element.promptEn, source: "auto" as const, bbox: null }));
    const updated = repository.updateLayerPlan(plan.id, { status: "SUCCEEDED", elements: records, error: null });
    if (updated) await events.publish(projectIdFor(job), "layer-plan.updated", { plan: updated });
  } catch (error) {
    // 失败/取消必须同步到方案记录：REST 是状态真相，SSE 只负责通知前端失效重查。
    if (error instanceof JobCancelled) {
      const cancelled = repository.updateLayerPlan(plan.id, { status: "CANCELLED", error: null });
      if (cancelled) await events.publish(projectIdFor(job), "layer-plan.updated", { plan: cancelled });
    } else {
      const updated = repository.updateLayerPlan(plan.id, { status: "FAILED", error: { message: error instanceof Error ? error.message : String(error) } });
      if (updated) await events.publish(projectIdFor(job), "layer-plan.updated", { plan: updated });
    }
    throw error;
  }
  await updateJob(job, { progress: 90 });
}

export async function executeLayerExport(ctx: WorkerContext, job: JobRecord, signal: AbortSignal): Promise<void> {
  const { repository, storage, secrets, events, updateJob, throwIfCancelled, projectFor, providerFor } = ctx;
  const record = layerExportFor(ctx, job);
  const project = projectFor(job);
  try {
    const output = repository.getOutput(record.outputId);
    if (!output || output.projectId !== project.id) throw new Error("Layer export source output is missing or belongs to another project");
    // planId 为空表示画框/提示词直接分层（无识别方案，不回写实测包围盒）；有 planId 时方案必须已成功。
    const plan = record.planId ? repository.getLayerPlan(record.planId) : undefined;
    if (record.planId && (!plan || plan.status !== "SUCCEEDED")) throw new Error("Layer plan is missing or has not succeeded");
    // 排队时 API 已把分割 Provider/模型/协议写入 input 并计入指纹；执行只认这份快照，
    // 排队后修改项目分割模型或 Provider 的协议声明都不影响本次执行。
    const segmentationProviderId = typeof job.input.segmentationProviderId === "string" ? job.input.segmentationProviderId : "";
    const segmentationModelId = typeof job.input.segmentationModelId === "string" ? job.input.segmentationModelId : "";
    if (!isSegmentationProtocol(job.input.segmentationProtocol)) throw new Error("Layer export job is missing its segmentation snapshot");
    const protocol = job.input.segmentationProtocol;
    if (!segmentationProviderId || !segmentationModelId) throw new Error("Layer export job is missing its segmentation snapshot");
    const provider = providerFor(segmentationProviderId);
    const elements = layerExportElementsFor(job);
    await updateJob(job, { progress: 10 });
    // 执行前先落 RUNNING：否则前端在整段分割过程中都只能看到 QUEUED。
    const running = repository.updateLayerExport(record.id, { status: "RUNNING", error: null });
    if (running) await events.publish(project.id, "layer-export.updated", { layerExport: running });
    const original = await storage.read(output.storagePath);
    const meta = await sharp(original).metadata();
    if (!meta.width || !meta.height) throw new Error("Source image dimensions are unavailable");
    const width = meta.width; const height = meta.height;
    // fal 接受公网 URL 或 data URI；本地产物没有公网地址，直接内联原图。
    const imageUrl = `data:${mimeForStoragePath(output.storagePath)};base64,${original.toString("base64")}`;
    // protocol 是项目配置里的显式字段；grounded_sam 面向国内自部署服务，fal 面向 fal.ai SAM 3，seedream 面向火山方舟图层拆分。
    const apiKey = secrets.decrypt(provider.encryptedApiKey);
    // 两条路径统一产出 {name, mask}：mask 只是选区，元素图层像素一律取自原图（PIXEL_PROTECTED）。
    const cutoutTargets: Array<{ name: string; mask: Buffer }> = [];
    const measuredBboxes = new Map<string, { x: number; y: number; width: number; height: number } | null>();
    // 标记“已发出外部计费请求”：此后标记不再被替换或中途清空，直到终态一次性清掉；
    // 进程在任意时点崩溃时，恢复层据此把任务判为结果未知并显式失败，而不是重新执行已计费的请求。
    await updateJob(job, { providerTaskId: EXTERNAL_REQUEST_STARTED });
    // seedream 返回的补绘底图保持 RGBA，避免“编码 PNG 再解码”这一轮无用往返。
    let inpaintedBackground: Buffer | undefined;
    if (protocol === "seedream_layerize") {
      // 一次调用拆分全部元素：手动框选换算为 0-1000 bbox 标签，自动元素用语义名称。
      const layerizer = new SeedreamLayerizeProvider({ baseUrl: provider.baseUrl, apiKey }, { modelId: segmentationModelId });
      const result = await layerizer.layerize({ imageUrl, prompt: seedreamLayerizePrompt(elements), quality: "auto", signal });
      throwIfCancelled(job);
      if (result.base) inpaintedBackground = await decodeRgba(result.base.data, width, height);
      for (const layer of result.layers) {
        throwIfCancelled(job);
        const mask = await seedreamLayerMask(layer.png, layer.bbox, width, height);
        // 空白图层是模型漏拆，不能静默跳过后当成成功：明确失败让用户调整描述或画框。
        if (!maskHasForeground(mask)) throw new Error(`Seedream 图层「${layer.name ?? layer.zIndex}」没有有效前景，请调整元素描述或画框后重试`);
        const matched = seedreamMatches(elements, layer);
        if (matched) measuredBboxes.set(matched.id, layer.bbox);
        cutoutTargets.push({ name: matched?.name ?? layer.name ?? `图层 ${layer.zIndex}`, mask });
        await updateJob(job, { progress: 10 + Math.round((cutoutTargets.length / Math.max(1, result.layers.length)) * 50) });
      }
      if (cutoutTargets.length === 0) throw new Error("Seedream 未拆分出任何有效图层，请调整元素描述或画框后重试");
    } else {
      // protocol 是项目配置里的显式字段：文本提示分割协议的差异由适配器各自消化，
      // 业务层只按注册表能力决定是否携带框提示（LSP：SegmentationProviderLike 统一 segment/probe）。
      const segmenter = createSegmentationProvider(protocol, { baseUrl: provider.baseUrl, apiKey });
      // 分割模型 id 允许直接写完整 fal 路径（含 "/"），否则使用适配器默认 fal-ai/sam-3/image。
      const modelPath = protocol === "fal" && segmentationModelId.includes("/") ? segmentationModelId : undefined;
      const supportsBoxPrompts = SEGMENTATION_PROTOCOL_CAPABILITIES[protocol].supportsBoxPrompts;
      for (const [index, element] of elements.entries()) {
        throwIfCancelled(job);
        // 框提示是否可用是协议能力（contracts 注册表声明），不是业务特判；
        // 不支持的协议直接不传框，手动框选元素应改用支持框提示的协议。
        const box = supportsBoxPrompts && element.bbox ? {
          xMin: Math.round(element.bbox.x * width), yMin: Math.round(element.bbox.y * height),
          xMax: Math.round((element.bbox.x + element.bbox.width) * width), yMax: Math.round((element.bbox.y + element.bbox.height) * height)
        } : undefined;
        // 文本提示优先用识别产出的英文 promptEn（部分分割渠道只接受英文），没有则退回元素名；
        // 手动框选直接用画框坐标，不传文本提示。
        const textPrompt = element.source === "manual" ? undefined : element.promptEn?.trim() || element.name;
        const result = await segmenter.segment({ imageUrl, textPrompt, box, modelPath, signal });
        throwIfCancelled(job);
        measuredBboxes.set(element.id, result.bbox);
        const mask = await normalizeMask(result.mask, width, height);
        if (!maskHasForeground(mask)) throw new Error(`SAM 未在「${element.name}」中分割出前景，请调整元素名称或画框后重试`);
        cutoutTargets.push({ name: element.name, mask });
        await updateJob(job, { progress: 10 + Math.round(((index + 1) / elements.length) * 50) });
      }
    }
    throwIfCancelled(job);
    // 把 SAM 实测包围盒回写方案：前端 chips 悬停即可按真实分割区域高亮，而不只是手动画框。
    if (plan) {
      const refreshedElements = plan.elements.map((planElement) => ({ ...planElement, bbox: measuredBboxes.get(planElement.id) ?? planElement.bbox }));
      if (JSON.stringify(refreshedElements) !== JSON.stringify(plan.elements)) {
        const refreshed = repository.updateLayerPlan(plan.id, { elements: refreshedElements });
        if (refreshed) await events.publish(project.id, "layer-plan.updated", { plan: refreshed });
      }
    }
    // mask 只是选区：元素图层像素原样取自原图，不做任何生成，保持 PIXEL_PROTECTED 语义。
    // 原图 RGBA 只解码一次；每层全幅 RGBA 在 PNG 落盘、合成与 PSD 裁剪后即被释放，只保留裁剪副本。
    const originalRgba = await decodeRgba(original, width, height);
    const layerFiles: LayerExportLayerFileRecord[] = [];
    // PSD 组装用累积器：背景先入 children（children[0] 是最底层），元素逐层叠加到同一份合成预览上。
    const psd = createPsdLayerAccumulator(width, height);
    if (record.includeBackground) {
      // 挖空背景语义：原图 alpha ×(1-元素选区并集)，保留原图透明度；软边处元素与背景 alpha 之和略小于 1，
      // 叠加后边缘会轻微变透明，这是“可移动元素”与“逐像素还原原图”不可兼得时的取舍，合成预览如实呈现。
      const backgroundRgba = inpaintedBackground
        ? multiplyAlpha(inpaintedBackground, extractAlpha(originalRgba))
        : multiplyAlpha(originalRgba, invertMask(unionOfMasks(cutoutTargets.map((target) => target.mask), width, height)));
      const stored = await storage.putLayerArtifact(project.id, record.id, "00_背景", await pngFromRgba(backgroundRgba, width, height));
      layerFiles.push({ name: "00_背景.png", kind: "background", storagePath: stored.path, hash: stored.hash });
      psd.append({ name: "背景", rgba: backgroundRgba });
    }
    for (const [index, target] of cutoutTargets.entries()) {
      // 元素选区透明：元素 alpha = 原图 alpha × 选区，保留原图透明度与软边。
      const cutoutRgba = multiplyAlpha(originalRgba, target.mask);
      const label = `${String(index + 1).padStart(2, "0")}_${safeName(target.name)}`;
      const stored = await storage.putLayerArtifact(project.id, record.id, label, await pngFromRgba(cutoutRgba, width, height));
      layerFiles.push({ name: `${label}.png`, kind: "element", storagePath: stored.path, hash: stored.hash });
      psd.append({ name: `${String(index + 1).padStart(2, "0")} ${target.name}`, rgba: cutoutRgba });
    }
    await updateJob(job, { progress: 85 });
    const psdStored = await storage.putLayerArtifact(project.id, record.id, "图层", writePsdBuffer({ width, height, children: psd.children, imageData: { width, height, data: new Uint8ClampedArray(psd.composite) } }), ".psd");
    layerFiles.push({ name: "图层.psd", kind: "composite", storagePath: psdStored.path, hash: psdStored.hash });
    const updated = repository.updateLayerExport(record.id, { status: "SUCCEEDED", psdStoragePath: psdStored.path, layerFiles, error: null });
    if (updated) await events.publish(project.id, "layer-export.updated", { layerExport: updated });
    await updateJob(job, { progress: 95 });
  } catch (error) {
    // EXTERNAL_REQUEST_STARTED 标记保持到终态：付费请求之后的任何时点崩溃，恢复层都会判“结果未知”并显式失败，
    // 不会重跑已计费的分割调用；标记由终态更新一次性清空，不在执行中途改写。
    if (error instanceof JobCancelled) {
      const cancelled = repository.updateLayerExport(record.id, { status: "CANCELLED", error: null });
      if (cancelled) await events.publish(project.id, "layer-export.updated", { layerExport: cancelled });
    } else {
      // 分割已产生外部计费，任何失败都必须显式落到记录上，不允许静默重试掩盖。
      const failed = repository.updateLayerExport(record.id, { status: "FAILED", error: { message: error instanceof Error ? error.message : String(error) } });
      if (failed) await events.publish(project.id, "layer-export.updated", { layerExport: failed });
    }
    throw error;
  }
}
