import { randomBytes } from "node:crypto";
import type { JobRecord } from "@ecomgen/core";
import { validateEcomSuiteFile } from "@ecomgen/contracts";
import { forgeSuite, type SuiteForgeHints } from "@ecomgen/agent";
import { normalizeSuiteDocument, type SuiteDocumentInput } from "@ecomgen/ecom-suite";
import { buildReasoningModel } from "@ecomgen/providers";
import type { WorkerContext } from "./context.js";

interface SuiteForgeSourceInput { storagePath?: unknown; hash?: unknown; originalName?: unknown; mimeType?: unknown; }
interface SuiteForgeJobInput { providerId?: unknown; modelId?: unknown; sources?: unknown; hints?: unknown; }

/** 反推套图预先分配最终 ID：草稿预览与确认入库共用同一 ID，assetType 不会在确认时突变。 */
function mintForgeSuiteId(ctx: WorkerContext): string {
  let id = `custom-suite-${randomBytes(4).toString("hex")}`;
  while (ctx.suiteCatalog.getSuite(id)) id = `custom-suite-${randomBytes(4).toString("hex")}`;
  return id;
}

// 全局套图反推任务不绑定项目：模型由请求写入 job.providerId/modelId，源图读取自 suite-forge 存储目录。
// 产出只落草稿（suite_forge_results），用户在前端确认后才写入 user_suites，避免污染用户套图库。
export async function executeSuiteForge(ctx: WorkerContext, job: JobRecord): Promise<void> {
  const { repository, storage, secrets, updateJob, throwIfCancelled, cachedCompressForVision } = ctx;
  const input = job.input as SuiteForgeJobInput;
  const providerId = typeof input.providerId === "string" ? input.providerId : job.providerId;
  const modelId = typeof input.modelId === "string" ? input.modelId : job.modelId;
  if (!providerId || !modelId) throw new Error("套图反推任务缺少推理模型配置");
  const provider = repository.getProvider(providerId);
  if (!provider) throw new Error(`Configured provider not found: ${providerId}`);
  const model = provider.models.find((candidate) => candidate.id === modelId);
  if (!model) throw new Error("配置的推理模型已不在其 Provider 中");
  if (!model.supportsVision) throw new Error("套图反推需要支持视觉的推理模型");
  const sources = (Array.isArray(input.sources) ? input.sources : []).filter((source): source is SuiteForgeSourceInput => Boolean(source) && typeof (source as SuiteForgeSourceInput).storagePath === "string");
  if (sources.length === 0) throw new Error("套图反推任务缺少源图");
  await updateJob(job, { progress: 20 });
  const images: Array<{ type: "image"; mimeType: string; data: string }> = [];
  for (const source of sources) {
    throwIfCancelled(job);
    const original = await storage.read(source.storagePath as string);
    const compressed = await cachedCompressForVision(original, typeof source.hash === "string" ? source.hash : undefined);
    images.push({ type: "image", mimeType: compressed.mimeType, data: compressed.data.toString("base64") });
  }
  await updateJob(job, { progress: 40 });
  throwIfCancelled(job);
  const shots = createShotProgressPublisher(ctx, job, (input.hints ?? {}) as SuiteForgeHints);
  const forged = await forgeSuite({
    model: buildReasoningModel({ providerId: provider.id, modelId: model.id, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: model.supportsVision, supportsThinking: model.supportsThinking, supportsStructuredOutput: model.supportsStructuredOutput }),
    apiKey: secrets.decrypt(provider.encryptedApiKey),
    images,
    hints: (input.hints ?? undefined) as SuiteForgeHints | undefined,
    onShotProgress: shots.publish
  });
  await shots.settled();
  throwIfCancelled(job);
  // 模型产出先过契约校验，再归一化派生 assetType=<id>::<shotId>；worker 预先分配最终 ID，使草稿预览与确认入库一致。
  const validation = validateEcomSuiteFile(forged);
  if (!validation.ok) throw new Error(`套图反推结果未通过契约校验：${validation.errors.join("；")}`);
  const id = mintForgeSuiteId(ctx);
  const normalized = normalizeSuiteDocument(forged as unknown as SuiteDocumentInput, "user", { id });
  await updateJob(job, { progress: 85 });
  repository.saveSuiteForgeResult({
    jobId: job.id,
    payload: {
      schemaVersion: 1,
      kind: "ecomgen.suite",
      id: normalized.id,
      name: normalized.name,
      description: normalized.description,
      category: normalized.category,
      productFamily: normalized.productFamily,
      keywords: normalized.keywords,
      styleLock: normalized.styleLock,
      shots: normalized.shots,
      provenance: normalized.provenance
    }
  });
}

/**
 * 套图反推的过程计数落库器。
 *
 * 回调在 agent 的订阅链上被同步调用（pi-agent-core 会 await 监听器），在其中写库会把
 * SQLite 往返时间反压到 token 流上、直接拖慢这次反推。所以回调只把写入排进串行链，
 * 反推结束后再统一 await，保证明细不会晚于结果落库，也不会与流争抢。
 *
 * 计数是观察值而非任务状态：写失败只影响这一行提示，不该让一次已经成功且已计费的
 * 反推判为失败，因此这里保留首个错误用于诊断而不上抛。
 */
function createShotProgressPublisher(ctx: WorkerContext, job: JobRecord, hints: SuiteForgeHints): { publish: (shotsGenerated: number) => void; settled: () => Promise<void> } {
  const shotsTarget = typeof hints.targetShotCount === "number" ? hints.targetShotCount : null;
  let chain: Promise<unknown> = Promise.resolve();
  let firstError: unknown = null;
  return {
    // agent 侧只在计数变化时回调，写入次数天然被分镜数（与重试轮数）封顶，无需再节流。
    publish: (shotsGenerated: number) => {
      chain = chain.then(() => ctx.repository.updateJob(job.id, { progressDetail: { shotsGenerated, shotsTarget } })).catch((error: unknown) => { firstError ??= error; });
    },
    settled: async () => {
      await chain;
      if (firstError) console.warn(`Suite forge progress detail write failed: ${firstError instanceof Error ? firstError.message : String(firstError)}`);
    }
  };
}
