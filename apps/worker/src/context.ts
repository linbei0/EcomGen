import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Queue } from "bullmq";
import {
  EcomRepository,
  LocalAssetStore,
  SecretBox,
  SuiteCatalog,
  type AssetRecord,
  type JobRecord,
  type ProjectRecord,
  type ProviderRecord,
} from "@ecomgen/core";
import { RedisProjectEventBus, type EcomJobPayload } from "@ecomgen/jobs";
import { buildReasoningModel, GeminiImageProvider, OpenAiCompatibleImageProvider } from "@ecomgen/providers";
import { reviseImagePrompt } from "@ecomgen/agent";
import type { ModelDefinition } from "@ecomgen/contracts";
import { compileUserTemplate, type EcomTemplate } from "@ecomgen/ecom-skill";
import type { SearchSourceKind } from "@ecomgen/contracts";
import type { WebResearchConfig } from "@ecomgen/agent";
import type { VisionDerivativeCache } from "./vision-cache.js";

/**
 * 各执行器共享的运行时句柄，由 worker 入口组装后传给每个 executeXxx。
 * 与 API 的 ApiContext 同构：基础设施与跨领域助手只在这里存在一份，
 * 执行器模块不直接 import 单例，保证句柄可替换（e2e 注入与未来测试）。
 */
export interface WorkerContext {
  readonly repository: EcomRepository;
  readonly suiteCatalog: SuiteCatalog;
  readonly storage: LocalAssetStore;
  readonly visionCache: VisionDerivativeCache;
  readonly secrets: SecretBox;
  readonly events: RedisProjectEventBus;
  /** 流水线后续步骤与编辑生成链内入队都走这条队列：它与 Worker 消费的是同一个 Redis 队列。 */
  readonly executionQueue: Queue<EcomJobPayload>;
  /** 进度与状态落库并向项目通道广播；job.updated 是通知不是真相，REST 查询才是。 */
  readonly updateJob: (job: JobRecord, patch: Parameters<EcomRepository["updateJob"]>[1]) => Promise<void>;
  readonly throwIfCancelled: (job: JobRecord) => void;
  readonly projectFor: (job: JobRecord) => ProjectRecord;
  readonly providerFor: (id: string | null) => ProviderRecord;
  /** 任务快照 → 可执行生图模型：三个生成式执行器共用同一份 API 白名单与错误口径。 */
  readonly imageModelForJob: (job: JobRecord) => { provider: ProviderRecord; model: ModelDefinition };
  /** 按模型声明的 image API 选择适配器；生成/编辑/选角三条链路共用，避免适配器选择逻辑漂移。 */
  readonly imageGeneratorFor: (provider: ProviderRecord, model: { id: string; imageApiKind: string | null }) => GeminiImageProvider | OpenAiCompatibleImageProvider;
  readonly cachedCompressForVision: (buffer: Buffer, sourceHash?: string) => Promise<{ data: Buffer; mimeType: string }>;
  readonly visionImageContents: (assets: AssetRecord[]) => Promise<Array<{ type: "image"; mimeType: string; data: string }>>;
  readonly visionSourceImage: (storagePath: string) => Promise<{ type: "image"; mimeType: string; data: string }>;
  /** 自定义模板按 job 执行时从 DB 实时编译：表极小，无缓存必要，且保证与 API 同一编译口径。 */
  readonly compiledUserTemplates: () => EcomTemplate[];
  /** 搜索源严格按后台 priority 执行；所有源失败仍由 Pi 使用已有项目上下文完成规划。 */
  readonly configuredWebResearch: () => WebResearchConfig | undefined;
  readonly reviseGenerationPrompt: (project: ProjectRecord, prompt: string, revision: string) => Promise<string>;
}

export interface WorkerContextInfra {
  readonly repository: EcomRepository;
  readonly suiteCatalog: SuiteCatalog;
  readonly storage: LocalAssetStore;
  readonly visionCache: VisionDerivativeCache;
  readonly secrets: SecretBox;
  readonly events: RedisProjectEventBus;
  readonly executionQueue: Queue<EcomJobPayload>;
}

export function createWorkerContext(infra: WorkerContextInfra): WorkerContext {
  const { repository, suiteCatalog, storage, visionCache, secrets, events, executionQueue } = infra;

  async function updateJob(job: JobRecord, patch: Parameters<EcomRepository["updateJob"]>[1]): Promise<void> {
    const updated = repository.updateJob(job.id, patch);
    if (updated && job.projectId) await events.publish(job.projectId, "job.updated", updated);
  }
  function throwIfCancelled(job: JobRecord): void {
    const current = repository.getJob(job.id);
    if (current?.cancelRequested || current?.status === "CANCELLED") throw new JobCancelled(`Job ${job.id} was cancelled`);
  }
  function projectFor(job: JobRecord): ProjectRecord {
    const project = repository.getProject(projectIdFor(job));
    if (!project) throw new Error(`Project not found for job ${job.id}`);
    return project;
  }
  // 引用为 null 表示 Provider 被删除后项目尚未重新选择模型；入口虽已拦截，这里兜底给出可读错误
  function providerFor(id: string | null): ProviderRecord {
    if (!id) throw new Error("该项目尚未选择 Provider（可能已被删除），请在项目设置中重新选择");
    const provider = repository.getProvider(id);
    if (!provider) throw new Error(`Configured provider not found: ${id}`);
    return provider;
  }
  function imageModelForJob(job: JobRecord): { provider: ProviderRecord; model: ModelDefinition } {
    const provider = providerFor(job.providerId);
    const model = provider.models.find((candidate) => candidate.id === job.modelId);
    if (!model || (model.imageApiKind !== "openai_images" && model.imageApiKind !== "gemini")) throw new Error("Selected image model has no executable image API");
    return { provider, model };
  }
  function imageGeneratorFor(provider: ProviderRecord, model: { id: string; imageApiKind: string | null }): GeminiImageProvider | OpenAiCompatibleImageProvider {
    if (model.imageApiKind === "gemini") return new GeminiImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) });
    if (model.imageApiKind === "openai_images") return new OpenAiCompatibleImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) });
    throw new Error("Selected image model has no executable image API");
  }
  // 推理模型只做视觉理解，各 Provider 内部也会把图缩到有限分辨率再切 token；
  // 上传原图只增加传输体积，且 Pi Agent 多轮工具调用会把全部历史大图成倍重发。
  // 生图与像素保护仍读取原始文件，不受此压缩影响。
  const VISION_MAX_EDGE = 1024;
  const VISION_JPEG_QUALITY = 80;
  const VISION_PASSTHROUGH_BYTES = 512 * 1024;
  async function compressForVision(buffer: Buffer): Promise<{ data: Buffer; mimeType: string }> {
    const meta = await sharp(buffer).metadata();
    const withinBounds = (meta.width ?? 0) <= VISION_MAX_EDGE && (meta.height ?? 0) <= VISION_MAX_EDGE;
    if (withinBounds && buffer.byteLength <= VISION_PASSTHROUGH_BYTES) {
      const mimeType = meta.format === "png" ? "image/png" : meta.format === "webp" ? "image/webp" : "image/jpeg";
      return { data: buffer, mimeType };
    }
    return { data: await sharp(buffer).resize(VISION_MAX_EDGE, VISION_MAX_EDGE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: VISION_JPEG_QUALITY }).toBuffer(), mimeType: "image/jpeg" };
  }
  async function cachedCompressForVision(buffer: Buffer, sourceHash?: string): Promise<{ data: Buffer; mimeType: string }> {
    const hash = sourceHash ?? createHash("sha256").update(buffer).digest("hex");
    const metadata = await sharp(buffer).metadata();
    const passthroughMime = metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : "image/jpeg";
    const withinBounds = (metadata.width ?? 0) <= VISION_MAX_EDGE && (metadata.height ?? 0) <= VISION_MAX_EDGE;
    const outputMimeType = withinBounds && buffer.byteLength <= VISION_PASSTHROUGH_BYTES ? passthroughMime : "image/jpeg";
    return visionCache.getOrCreate({ sourceHash: hash, maxEdge: VISION_MAX_EDGE, jpegQuality: VISION_JPEG_QUALITY, mimeType: outputMimeType }, async () => compressForVision(buffer));
  }
  async function visionImageContents(assets: AssetRecord[]): Promise<Array<{ type: "image"; mimeType: string; data: string }>> {
    return Promise.all(assets.map(async (asset) => {
      const original = await storage.read(asset.storagePath);
      const compressed = await cachedCompressForVision(original, asset.hash);
      return { type: "image" as const, mimeType: compressed.mimeType, data: compressed.data.toString("base64") };
    }));
  }
  async function visionSourceImage(storagePath: string): Promise<{ type: "image"; mimeType: string; data: string }> {
    const original = await storage.read(storagePath);
    const compressed = await cachedCompressForVision(original);
    return { type: "image", mimeType: compressed.mimeType, data: compressed.data.toString("base64") };
  }
  function compiledUserTemplates(): EcomTemplate[] {
    return repository.listUserTemplates().map((record) => compileUserTemplate({ id: record.id, name: record.name, prompt: record.prompt, defaultSize: record.defaultSize, supportsImageReference: record.supportsImageReference }));
  }
  function configuredWebResearch(): WebResearchConfig | undefined {
    const sources = repository.listSearchSources()
      .filter((source) => source.enabled && (source.kind === "searxng" || source.encryptedApiKey))
      .map((source) => ({ id: source.id, name: source.name, kind: source.kind, baseUrl: source.baseUrl, apiKey: source.encryptedApiKey ? secrets.decrypt(source.encryptedApiKey) : undefined }));
    return sources.length ? { sources, maxResults: 3, timeoutMs: 8_000 } : undefined;
  }
  async function reviseGenerationPrompt(project: ProjectRecord, prompt: string, revision: string): Promise<string> {
    const provider = providerFor(project.reasoningProviderId);
    const model = provider.models.find((candidate) => candidate.id === project.reasoningModelId);
    if (!model) throw new Error("Configured reasoning model no longer exists in its provider");
    return reviseImagePrompt({
      model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking, supportsStructuredOutput: model.supportsStructuredOutput }),
      apiKey: secrets.decrypt(provider.encryptedApiKey),
      prompt,
      revision
    });
  }

  return {
    repository, suiteCatalog, storage, visionCache, secrets, events, executionQueue,
    updateJob, throwIfCancelled, projectFor, providerFor, imageModelForJob, imageGeneratorFor,
    cachedCompressForVision, visionImageContents, visionSourceImage,
    compiledUserTemplates, configuredWebResearch, reviseGenerationPrompt,
  };
}

/** 任务取消：以错误类型承载，让任务级 catch 与 AbortSignal 的 abort reason 共用同一个判定。 */
export class JobCancelled extends Error { }

// 全局任务（套图反推）不绑定项目，projectId 为 null；任何项目态 handler 都要显式取用而非静默传 null。
export function projectIdFor(job: JobRecord): string { if (!job.projectId) throw new Error(`Job ${job.id} is not bound to a project`); return job.projectId; }

/** 一个 Job 的每个候选使用独立稳定键，重试不会再次落库或写出另一份文件。 */
export function generationKeyFor(jobId: string, candidateIndex: number): string { return `ecomgen:generation:${jobId}:candidate:${candidateIndex}`; }

export function extensionForMime(mimeType: string): string { return mimeType.includes("webp") ? ".webp" : mimeType.includes("jpeg") ? ".jpg" : ".png"; }

export function mimeForStoragePath(path: string): string { if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"; if (path.endsWith(".webp")) return "image/webp"; return "image/png"; }

export function safeName(value: string): string { return value.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "ecomgen"; }

/** 生成结果入库派生：读取尺寸并尽量写入缩略图缓存；任一步失败都不阻断生成主流程。 */
export async function outputDerivatives(storage: LocalAssetStore, hash: string, image: Buffer): Promise<{ width: number | null; height: number | null }> {
  try {
    const metadata = await sharp(image).metadata();
    try {
      if (!(await storage.hasThumbnail(hash))) {
        const thumbnail = await sharp(image).rotate().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
        await storage.putThumbnail(hash, thumbnail);
      }
    } catch { /* 缩略图失败可接受，浏览时由 API 惰性兜底 */ }
    return { width: metadata.width ?? null, height: metadata.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

// 取消状态的真相源是数据库（取消接口、重试替代原任务、失败转取消都只写库，不广播事件），
// 但 throwIfCancelled 只在检查点生效，无法打断已经发出的 Provider 请求。
const CANCEL_POLL_INTERVAL_MS = 2_000;

/**
 * 把任务取消传播到在途 HTTP 请求。
 *
 * 没有中断时，用户点取消后 Worker 会继续等待上游返回（生图默认上限 5 分钟），该次生成
 * 照常计费，拿到结果后又被取消检查丢弃。这里以 JobCancelled 作为中断原因：fetch 会把
 * abort reason 原样抛出，因此任务级 catch 能按既有取消分支落为 CANCELLED，不会被记为失败。
 */
export function startJobCancellation(repository: EcomRepository, job: JobRecord): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setInterval(() => {
    const current = repository.getJob(job.id);
    if (current?.cancelRequested || current?.status === "CANCELLED") controller.abort(new JobCancelled(`Job ${job.id} was cancelled`));
  }, CANCEL_POLL_INTERVAL_MS);
  // 轮询不应阻止进程退出；dispose 仍负责在任务结束后清掉定时器。
  timer.unref();
  return { signal: controller.signal, dispose: () => clearInterval(timer) };
}
