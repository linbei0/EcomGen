import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

// App 级端点测试的边界在 Redis/BullMQ：状态真相是 SQLite 与 REST 响应，
// 入队只需要确认发生且方向正确，不应要求本地真实 Redis。
vi.mock("@ecomgen/jobs", async () => {
  const connection = { duplicate: () => connection, quit: async () => { } };
  return {
    QUEUE_NAME: "ecomgen-test",
    createRedisConnection: () => connection,
    createJobQueue: () => ({ close: async () => { } }),
    enqueue: vi.fn(async () => { }),
    RedisProjectEventBus: class {
      public async publish(projectId: string, type: string, data: unknown) {
        return { id: randomUUID(), projectId, type, occurredAt: new Date().toISOString(), data };
      }
      public async subscribe(_projectId: string, listener: (event: unknown) => void) {
        return async () => void listener;
      }
      public async close() { }
    }
  };
});

import type { FastifyInstance } from "fastify";
import { EcomRepository, LocalAssetStore, openDatabase } from "@ecomgen/core";
import { MODEL_SPEC_DEFAULTS } from "@ecomgen/contracts";
import { buildApi, resolveCorsOrigins } from "./app.js";
import { enqueue } from "@ecomgen/jobs";

let dataDir = "";
let database: ReturnType<typeof openDatabase>;
let repository: EcomRepository;
let app: FastifyInstance;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "ecomgen-api-test-"));
  app = await buildApi({ dataDir, redisUrl: "redis://127.0.0.1:6399", masterKey: Buffer.alloc(32, 7).toString("base64") });
  // 与 buildApi 共享同一个文件库，保证端点操作和断言看到相同的状态真相
  database = openDatabase(join(dataDir, "ecomgen.sqlite"));
  repository = new EcomRepository(database);
  // enqueue 是模块级共享 mock：逐用例重置到成功实现（once 行为会跨用例排队，只 clear 调用计数不够），
  // 断言不依赖文件内的执行顺序
  vi.mocked(enqueue).mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await app.close();
  database.close();
  rmSync(dataDir, { recursive: true, force: true });
});

type ProviderModels = Parameters<EcomRepository["saveProvider"]>[0]["models"];
type ProjectInput = Parameters<EcomRepository["createProject"]>[0];

const DEFAULT_MODELS: ProviderModels = [
  { id: "reasoner", supportsVision: true, supportsThinking: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null },
  { id: "image", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: "openai_images" }
];

function saveProvider(models: ProviderModels = DEFAULT_MODELS) {
  return repository.saveProvider({
    name: "test",
    baseUrl: "https://example.test/v1",
    encryptedApiKey: "encrypted",
    reasoningProtocol: "openai",
    models
  });
}

/** 项目字段默认值：用例只覆盖与自身规则相关的差异。 */
function makeProject(providerId: string, overrides: Partial<ProjectInput> = {}) {
  return repository.createProject({
    name: "cup",
    category: null,
    productDescription: null,
    verifiedFacts: [],
    prohibitedClaims: [],
    brandGuidelines: {},
    platformTargets: ["TAOBAO"],
    targetMarket: null,
    copyLanguage: null,
    reasoningProviderId: providerId,
    reasoningModelId: "reasoner",
    imageProviderId: providerId,
    imageModelId: "image",
    defaultMode: "CREATIVE",
    imageResolution: "1K",
    imageAspectRatio: "AUTO",
    candidatesPerType: 1,
    ...overrides,
  });
}

function seedFailedGenerateJob(): ReturnType<EcomRepository["createJob"]> {
  const provider = saveProvider();
  const project = makeProject(provider.id);
  const job = repository.createJob({ id: randomUUID(), projectId: project.id, storyboardItemId: null, type: "GENERATE", input: { candidateIndex: 1 }, providerId: provider.id, modelId: "image" });
  repository.updateJob(job.id, { status: "FAILED", progress: 100, error: { message: "fetch failed" } });
  return job;
}

describe("POST /api/v1/jobs/:jobId/retry", () => {
  it("重试成功后终止原失败任务并保留可追溯状态", async () => {
    const failed = seedFailedGenerateJob();
    const response = await app.inject({ method: "POST", url: `/api/v1/jobs/${failed.id}/retry` });
    expect(response.statusCode).toBe(202);
    const retried = response.json<{ id: string; type: string; status: string }>();
    expect(retried.id).not.toBe(failed.id);
    expect(retried.status).toBe("QUEUED");
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(repository.getJob(failed.id)).toMatchObject({ status: "CANCELLED", retryable: false });
    expect(repository.getJob(retried.id)?.status).toBe("QUEUED");
  });

  it("同一失败任务不可重复触发重试", async () => {
    const failed = seedFailedGenerateJob();
    const first = await app.inject({ method: "POST", url: `/api/v1/jobs/${failed.id}/retry` });
    expect(first.statusCode).toBe(202);
    const second = await app.inject({ method: "POST", url: `/api/v1/jobs/${failed.id}/retry` });
    expect(second.statusCode).toBe(409);
  });

  it("运行中与已成功的任务不可重试，避免叠加 Provider 调用", async () => {
    const provider = saveProvider();
    const project = makeProject(provider.id);
    const running = repository.createJob({ id: randomUUID(), projectId: project.id, storyboardItemId: null, type: "PLAN", input: {}, providerId: provider.id, modelId: "reasoner" });
    repository.updateJob(running.id, { status: "RUNNING" });
    const runningRetry = await app.inject({ method: "POST", url: `/api/v1/jobs/${running.id}/retry` });
    expect(runningRetry.statusCode).toBe(409);
    expect(enqueue).not.toHaveBeenCalled();

    const succeeded = repository.createJob({ id: randomUUID(), projectId: project.id, storyboardItemId: null, type: "PLAN", input: {}, providerId: provider.id, modelId: "reasoner" });
    repository.updateJob(succeeded.id, { status: "SUCCEEDED", progress: 100 });
    const succeededRetry = await app.inject({ method: "POST", url: `/api/v1/jobs/${succeeded.id}/retry` });
    expect(succeededRetry.statusCode).toBe(409);
  });
});

function seedProject(name: string) {
  const provider = saveProvider();
  return makeProject(provider.id, { name });
}

/** 与 buildApi 共享同一 dataDir：测试侧直接用 LocalAssetStore 落盘源文件，绕开 multipart 构造。 */
async function seedSourceAsset(repository: EcomRepository, projectId: string, content: Buffer, role: "PRODUCT_TRUTH" | "STYLE_REFERENCE" = "PRODUCT_TRUTH") {
  const stored = await new LocalAssetStore(dataDir).putAsset(projectId, "source.png", content);
  return repository.createAsset({ projectId, role, storagePath: stored.path, hash: stored.hash, originalName: "source.png", mimeType: "image/png", width: null, height: null });
}

describe("asset library", () => {
  it("从资产库复制图片到目标项目：新记录、独立文件，库列表按 hash 去重并映射来源", async () => {
    const sourceProject = seedProject("source");
    const targetProject = seedProject("target");
    const source = await seedSourceAsset(repository, sourceProject.id, await samplePng());

    const listing = await app.inject({ method: "GET", url: "/api/v1/library-assets" });
    expect(listing.statusCode).toBe(200);
    const listingBody = listing.json<{ items: Array<{ id: string; source: string; kind: string; url: string; thumbnailUrl: string }>; total: number }>();
    expect(listingBody.total).toBe(listingBody.items.length);
    const listed = listingBody.items.find((item) => item.id === `asset:${source.id}`);
    expect(listed).toMatchObject({ source: "UPLOADED", kind: "PRODUCT", url: `/api/v1/files/assets/${source.id}` });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${targetProject.id}/assets/from-library`,
      payload: { itemId: `asset:${source.id}`, kind: "PRODUCT" },
    });
    expect(response.statusCode).toBe(201);
    const copied = response.json<{ projectId: string; role: string; hash: string; storagePath: string }>();
    expect(copied).toMatchObject({ projectId: targetProject.id, role: "PRODUCT_TRUTH", hash: source.hash });
    expect(copied.storagePath).not.toBe(source.storagePath);
    expect(await new LocalAssetStore(dataDir).exists(copied.storagePath)).toBe(true);
  });

  it("缩略图端点按内容 hash 惰性生成 webp，并作为库条目 thumbnailUrl", async () => {
    const project = seedProject("source");
    const source = await seedSourceAsset(repository, project.id, await samplePng());
    const listing = await app.inject({ method: "GET", url: "/api/v1/library-assets" });
    const listed = listing.json<{ items: Array<{ id: string; thumbnailUrl: string }> }>().items.find((item) => item.id === `asset:${source.id}`);
    const thumbnail = await app.inject({ method: "GET", url: listed!.thumbnailUrl });
    expect(thumbnail.statusCode).toBe(200);
    expect(thumbnail.headers["content-type"]).toContain("image/webp");
  });

  it("库列表包含生成结果并按 GENERATED 类型筛选", async () => {
    const project = seedProject("source");
    repository.saveStoryboard(project.id, "lock", "DRAFT", [{ assetType: "hero-image", displayName: "杯子首图", shotRole: null, templateVariant: null, candidateCount: 1, referencedAssets: [], mode: "CREATIVE", status: "DRAFT", promptInstruction: "hero", compiledPrompt: null, factClaims: [], riskFlags: [], sortOrder: 0 }]);
    const item = repository.listStoryboardItems(project.id)[0]!;
    const job = repository.createJob({ id: randomUUID(), projectId: project.id, storyboardItemId: item.id, type: "GENERATE", input: {} });
    const output = repository.createOutput({ projectId: project.id, storyboardItemId: item.id, jobId: job.id, candidateIndex: 1, generationSnapshot: null, storagePath: "outputs/gen.png", hash: "gen-hash", width: 1024, height: 1024 });

    const listing = await app.inject({ method: "GET", url: "/api/v1/library-assets?kind=GENERATED" });
    expect(listing.statusCode).toBe(200);
    const listed = listing.json<{ items: Array<{ id: string; source: string; kind: string; name: string; url: string }> }>().items.find((entry) => entry.id === `output:${output.id}`);
    expect(listed).toMatchObject({ source: "GENERATED", kind: "GENERATED", name: "杯子首图", url: `/api/v1/files/outputs/${output.id}` });

    // kind 允许列表必须跟随 LibraryItemKind 枚举，防止新增类型后路由误拒。
    const layerListing = await app.inject({ method: "GET", url: "/api/v1/library-assets?kind=LAYER" });
    expect(layerListing.statusCode).toBe(200);
  });

  it("库条目不存在或源文件缺失时返回 404 且不产生新记录", async () => {
    const sourceProject = seedProject("source");
    const targetProject = seedProject("target");
    const unknown = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${targetProject.id}/assets/from-library`,
      payload: { itemId: `asset:${randomUUID()}` },
    });
    expect(unknown.statusCode).toBe(404);

    const source = await seedSourceAsset(repository, sourceProject.id, await samplePng());
    await new LocalAssetStore(dataDir).delete(source.storagePath);
    const missingFile = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${targetProject.id}/assets/from-library`,
      payload: { itemId: `asset:${source.id}` },
    });
    expect(missingFile.statusCode).toBe(404);
    expect(repository.listAssets(targetProject.id)).toHaveLength(0);
  });

  it("from-library 复制同样执行容量上限与同内容校验", async () => {
    const source = await seedSourceAsset(repository, seedProject("source").id, await samplePng());

    const capacityTarget = seedProject("target-capacity");
    for (let index = 0; index < 6; index += 1) {
      repository.createAsset({ projectId: capacityTarget.id, role: "PRODUCT_TRUTH", storagePath: `assets/${capacityTarget.id}/${index}.png`, hash: `hash-${index}`, originalName: `${index}.png`, mimeType: "image/png", width: null, height: null });
    }
    const overCapacity = await app.inject({ method: "POST", url: `/api/v1/projects/${capacityTarget.id}/assets/from-library`, payload: { itemId: `asset:${source.id}`, kind: "PRODUCT" } });
    expect(overCapacity.statusCode).toBe(400);

    const duplicateTarget = seedProject("target-duplicate");
    const first = await app.inject({ method: "POST", url: `/api/v1/projects/${duplicateTarget.id}/assets/from-library`, payload: { itemId: `asset:${source.id}` } });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: "POST", url: `/api/v1/projects/${duplicateTarget.id}/assets/from-library`, payload: { itemId: `asset:${source.id}` } });
    expect(second.statusCode).toBe(400);
  });

  it("省略 kind 时沿用源资产 role", async () => {
    const sourceProject = seedProject("source");
    const targetProject = seedProject("target");
    const source = await seedSourceAsset(repository, sourceProject.id, await samplePng(), "STYLE_REFERENCE");
    const response = await app.inject({ method: "POST", url: `/api/v1/projects/${targetProject.id}/assets/from-library`, payload: { itemId: `asset:${source.id}` } });
    expect(response.statusCode).toBe(201);
    expect(response.json<{ role: string }>().role).toBe("STYLE_REFERENCE");
  });
});

/** 缩略图/尺寸路径需要能解码的真实图片；固定尺寸让断言稳定。 */
async function samplePng(): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 12, channels: 3, background: { r: 200, g: 120, b: 40 } } }).png().toBuffer();
}

function seedLayerProject(segmentationModelId: string | null) {
  const provider = saveProvider([
    { id: "reasoner", supportsVision: true, supportsThinking: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null },
    { id: "reasoner-2", supportsVision: true, supportsThinking: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null },
    { id: "sam-3", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: null, segmentationProtocol: "fal" },
    { id: "layerize", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: null, segmentationProtocol: "seedream_layerize" }
  ]);
  const project = makeProject(provider.id, {
    name: "layer-cup",
    imageModelId: null,
    segmentationModel: segmentationModelId ? { providerId: provider.id, modelId: segmentationModelId } : null,
  });
  repository.saveStoryboard(project.id, "", "CONFIRMED", [{ assetType: "hero", displayName: "主图", shotRole: null, templateVariant: null, candidateCount: 1, referencedAssets: [], mode: "CREATIVE", status: "CONFIRMED", promptInstruction: "", compiledPrompt: null, factClaims: [], riskFlags: [], sortOrder: 0 }]);
  const item = repository.listStoryboardItems(project.id)[0]!;
  const job = repository.createJob({ id: randomUUID(), projectId: project.id, storyboardItemId: null, type: "GENERATE", input: {} });
  const output = repository.createOutput({ projectId: project.id, storyboardItemId: item.id, jobId: job.id, candidateIndex: 1, generationSnapshot: null, storagePath: `outputs/${project.id}/seed.png`, hash: "hash-1" });
  return { provider, project, output };
}

describe("layer plan & layer exports", () => {
  it("layer-plan 入队 LAYER_PLAN 任务并按指纹复用同一方案", async () => {
    const { project, output } = seedLayerProject(null);
    const first = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-plan`, payload: {} });
    expect(first.statusCode).toBe(202);
    const plan = first.json<{ id: string; status: string; outputHash: string }>();
    expect(plan).toMatchObject({ status: "QUEUED", outputHash: "hash-1", projectId: project.id, outputId: output.id });
    expect(vi.mocked(enqueue).mock.calls.some(([, payload]) => payload.kind === "layer_plan")).toBe(true);

    const second = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-plan`, payload: {} });
    expect(second.statusCode).toBe(202);
    expect(second.json<{ id: string }>().id).toBe(plan.id);
  });

  it("切换推理模型后重新识别不复用旧方案，并按新模型记录任务快照", async () => {
    const { project, output } = seedLayerProject(null);
    const first = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-plan`, payload: {} });
    expect(first.statusCode).toBe(202);
    const firstPlan = first.json<{ id: string }>();
    // 识别成功后，同模型且未要求重新识别时复用旧方案
    repository.updateLayerPlan(firstPlan.id, { status: "SUCCEEDED", elements: [{ id: "el-1", name: "瓶子", source: "auto", bbox: null }] });
    const reuse = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-plan`, payload: {} });
    expect(reuse.json<{ id: string }>().id).toBe(firstPlan.id);

    // 切换推理模型后指纹不同：不复用旧方案，并让任务快照记录新模型
    repository.updateProject(project.id, { reasoningModelId: "reasoner-2" });
    const switched = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-plan`, payload: {} });
    expect(switched.statusCode).toBe(202);
    const switchedPlan = switched.json<{ id: string }>();
    expect(switchedPlan.id).not.toBe(firstPlan.id);
    const snapshotJob = repository.getJob(repository.getLayerPlan(switchedPlan.id)!.jobId);
    expect(snapshotJob).toMatchObject({ providerId: project.reasoningProviderId, modelId: "reasoner-2" });
  });

  it("layer-plan 对不存在的 output 返回 404", async () => {
    const response = await app.inject({ method: "POST", url: `/api/v1/outputs/${randomUUID()}/layer-plan`, payload: {} });
    expect(response.statusCode).toBe(404);
  });

  it("layer-exports 在缺少分割模型或识别方案时拒绝", async () => {
    const withoutModel = seedLayerProject(null);
    const noModel = await app.inject({ method: "POST", url: `/api/v1/outputs/${withoutModel.output.id}/layer-exports`, payload: { elements: [{ id: "a", name: "瓶子", source: "auto" }] } });
    expect(noModel.statusCode).toBe(422);
    expect(noModel.json<{ error: { code: string } }>().error.code).toBe("PROVIDER_NOT_CONFIGURED");

    const configured = seedLayerProject("sam-3");
    const noPlan = await app.inject({ method: "POST", url: `/api/v1/outputs/${configured.output.id}/layer-exports`, payload: { elements: [{ id: "a", name: "瓶子", source: "auto" }] } });
    expect(noPlan.statusCode).toBe(409);
  });

  it("layer-exports 允许画框/提示词元素免识别方案，但画框元素必须携带 bbox", async () => {
    const { output } = seedLayerProject("sam-3");

    const manualOnly = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-exports`, payload: { elements: [{ id: "m-1", name: "自定义", source: "manual", bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } }] } });
    expect(manualOnly.statusCode).toBe(202);
    expect(manualOnly.json<{ layerExport: { planId: string | null; status: string } }>().layerExport).toMatchObject({ planId: null, status: "QUEUED" });

    const promptOnly = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-exports`, payload: { elements: [{ id: "p-1", name: "标题", source: "prompt" }] } });
    expect(promptOnly.statusCode).toBe(202);

    const manualWithoutBbox = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-exports`, payload: { elements: [{ id: "m-1", name: "背景", source: "manual" }] } });
    expect(manualWithoutBbox.statusCode).toBe(400);
  });

  it("layer-exports 的 auto 元素必须引用所属识别方案中的元素", async () => {
    const { project, output } = seedLayerProject("sam-3");
    const plan = repository.createLayerPlan({ projectId: project.id, outputId: output.id, jobId: randomUUID(), outputHash: "hash-1", status: "SUCCEEDED", elements: [{ id: "el-1", name: "瓶子", source: "auto", bbox: null }], error: null });

    const unknownAuto = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-exports`, payload: { planId: plan.id, elements: [{ id: "el-x", name: "不存在", source: "auto" }] } });
    expect(unknownAuto.statusCode).toBe(409);

    // auto 元素引用方案局部 id，必须携带其所属 planId；重识别后旧选择不得静默套用到新方案
    const stalePlan = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-exports`, payload: { planId: randomUUID(), elements: [{ id: "el-1", name: "瓶子", source: "auto" }] } });
    expect(stalePlan.statusCode).toBe(409);
  });

  it("layer-exports 成功后复用指纹并按时间倒序列出历史", async () => {
    const { project, output } = seedLayerProject("sam-3");
    const plan = repository.createLayerPlan({ projectId: project.id, outputId: output.id, jobId: randomUUID(), outputHash: "hash-1", status: "SUCCEEDED", elements: [{ id: "el-1", name: "瓶子", source: "auto", bbox: null }], error: null });
    const payload = { planId: plan.id, elements: [{ id: "el-1", name: "瓶子", source: "auto" }, { id: "m-1", name: "自定义", source: "manual", bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } }] };

    const valid = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-exports`, payload });
    expect(valid.statusCode).toBe(202);
    const bundle = valid.json<{ job: { type: string }; layerExport: { id: string; planId: string; includeBackground: boolean; status: string } }>();
    expect(bundle.job.type).toBe("LAYER_EXPORT");
    expect(bundle.layerExport).toMatchObject({ planId: plan.id, includeBackground: true, status: "QUEUED" });
    expect(vi.mocked(enqueue).mock.calls.some(([, payload]) => payload.kind === "layer_export")).toBe(true);

    const duplicate = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-exports`, payload });
    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json<{ layerExport: { id: string } }>().layerExport.id).toBe(bundle.layerExport.id);

    const another = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-exports`, payload: { elements: [{ id: "p-9", name: "标题", source: "prompt" }] } });
    expect(another.statusCode).toBe(202);
    const history = await app.inject({ method: "GET", url: `/api/v1/outputs/${output.id}/layer-exports/history` });
    expect(history.statusCode).toBe(200);
    const listed = history.json<{ exports: Array<{ id: string; psdDownloadUrl: string | null; layerFiles: Array<{ downloadUrl: string }> | null }> }>().exports;
    expect(listed).toHaveLength(2);
    expect(listed[0].id).toBe(another.json<{ layerExport: { id: string } }>().layerExport.id);
    // 未完成的导出没有产物：下载链接为空且不暴露存储路径
    expect(listed.every((item) => item.psdDownloadUrl === null)).toBe(true);

    const missingHistory = await app.inject({ method: "GET", url: `/api/v1/outputs/${randomUUID()}/layer-exports/history` });
    expect(missingHistory.statusCode).toBe(404);
  });

  it("layer-exports 按分割协议限制单次导出元素数量", async () => {
    // 32 是契约层的全局硬上限（SAM 单次最多 32 个对象）；Seedream 协议在路由层进一步收紧到 16
    const sam = seedLayerProject("sam-3");
    const samElements = Array.from({ length: 33 }, (_, index) => ({ id: `p-${index}`, name: `元素${index}`, source: "prompt" as const }));
    const rejectedSam = await app.inject({ method: "POST", url: `/api/v1/outputs/${sam.output.id}/layer-exports`, payload: { elements: samElements } });
    expect(rejectedSam.statusCode).toBe(400);

    // Seedream 图层拆分单次最多输出 16 个图层，上限比 SAM 协议更紧
    const seedream = seedLayerProject("layerize");
    const seedreamElements = Array.from({ length: 17 }, (_, index) => ({ id: `p-${index}`, name: `元素${index}`, source: "prompt" as const }));
    const rejectedSeedream = await app.inject({ method: "POST", url: `/api/v1/outputs/${seedream.output.id}/layer-exports`, payload: { elements: seedreamElements } });
    expect(rejectedSeedream.statusCode).toBe(400);
    expect(rejectedSeedream.json<{ error: { message: string } }>().error.message).toContain("16");

    const allowedSeedream = await app.inject({ method: "POST", url: `/api/v1/outputs/${seedream.output.id}/layer-exports`, payload: { elements: seedreamElements.slice(0, 16) } });
    expect(allowedSeedream.statusCode).toBe(202);
  });

  it("切换分割模型后不复用旧导出，并按新模型记录任务快照", async () => {
    const { provider, project, output } = seedLayerProject("sam-3");
    const elements = [{ id: "m-1", name: "自定义", source: "manual" as const, bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } }];
    const first = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-exports`, payload: { elements } });
    expect(first.statusCode).toBe(202);
    const firstExport = first.json<{ layerExport: { id: string } }>().layerExport;

    // 同一分割模型重复提交复用同一导出记录（指纹命中）
    const duplicate = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-exports`, payload: { elements } });
    expect(duplicate.json<{ layerExport: { id: string } }>().layerExport.id).toBe(firstExport.id);

    // 切换到另一协议的分割模型：指纹不同必须新建导出，且任务快照使用新模型而非执行时项目配置
    repository.updateProject(project.id, { segmentationModel: { providerId: provider.id, modelId: "layerize", protocol: "seedream_layerize" } });
    const switched = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-exports`, payload: { elements } });
    expect(switched.statusCode).toBe(202);
    const switchedExport = switched.json<{ job: { providerId: string; modelId: string }; layerExport: { id: string } }>();
    expect(switchedExport.layerExport.id).not.toBe(firstExport.id);
    expect(switchedExport.job).toMatchObject({ providerId: provider.id, modelId: "layerize" });
  });

  it("重试分层任务时为新建任务重建对应的分层记录", async () => {
    const { project, output } = seedLayerProject("sam-3");

    // LAYER_PLAN：重试后新任务必须关联新的 LayerPlan，否则 Worker 按 jobId 找不到记录
    const planJob = repository.createJob({ id: randomUUID(), projectId: project.id, storyboardItemId: null, type: "LAYER_PLAN", input: { outputId: output.id }, providerId: project.reasoningProviderId, modelId: "reasoner" });
    repository.updateJob(planJob.id, { status: "FAILED", error: { message: "vision failed" } });
    const plan = repository.createLayerPlan({ projectId: project.id, outputId: output.id, jobId: planJob.id, outputHash: output.hash, status: "FAILED", elements: [], error: { message: "vision failed" } });
    const planRetry = await app.inject({ method: "POST", url: `/api/v1/jobs/${planJob.id}/retry` });
    expect(planRetry.statusCode).toBe(202);
    expect(repository.getLayerPlanByJobId(planRetry.json<{ id: string }>().id)).toMatchObject({ outputId: output.id, status: "QUEUED" });

    // LAYER_EXPORT：重试后同样重建导出记录并保留原 planId 与背景选项
    const exportJob = repository.createJob({ id: randomUUID(), projectId: project.id, storyboardItemId: null, type: "LAYER_EXPORT", input: { outputId: output.id, planId: plan.id, includeBackground: false, elements: [{ id: "m-1", name: "自定义", source: "manual", bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } }] }, providerId: project.segmentationModel!.providerId, modelId: project.segmentationModel!.modelId });
    repository.updateJob(exportJob.id, { status: "FAILED", error: { message: "provider failed" } });
    repository.createLayerExport({ projectId: project.id, outputId: output.id, planId: plan.id, jobId: exportJob.id, status: "FAILED", includeBackground: false, psdStoragePath: null, layerFiles: null, error: { message: "provider failed" } });
    const exportRetry = await app.inject({ method: "POST", url: `/api/v1/jobs/${exportJob.id}/retry` });
    expect(exportRetry.statusCode).toBe(202);
    expect(repository.getLayerExportByJobId(exportRetry.json<{ id: string }>().id)).toMatchObject({ planId: plan.id, includeBackground: false, status: "QUEUED" });
  });
});

describe("POST /api/v1/models 规格互斥校验", () => {
  it("接受自洽规格，拒绝互斥组合并回传字段路径", async () => {
    const accepted = await app.inject({ method: "POST", url: "/api/v1/models", payload: { name: "小满", spec: MODEL_SPEC_DEFAULTS } });
    expect(accepted.statusCode).toBe(201);

    // 短发配高盘发：schema 形状合法，但编译出来会是自相矛盾的提示词。
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/models",
      payload: { name: "矛盾", spec: { ...MODEL_SPEC_DEFAULTS, hairLength: "CROP", hairstyle: "HIGH_BUN" } },
    });
    expect(rejected.statusCode).toBe(400);
    // 错误体统一为 { error: { code, message, details } }，details 带字段路径便于前端定位。
    const { error } = rejected.json() as { error: { code: string; message: string; details: Array<{ path: string }> } };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("互斥");
    expect(error.details.map((detail) => detail.path)).toContain("/spec/hairstyle");
    expect(repository.listModels()).toHaveLength(1);
  });
});

describe("PATCH /api/v1/models/:modelId 局部更新", () => {
  it("只改一个字段时其余字段原样保留", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/models", payload: { name: "小满", spec: MODEL_SPEC_DEFAULTS, notes: "甜酷风" } });
    const id = created.json<{ id: string }>().id;

    // 只改名：漏传的 spec/notes 必须保留，不能被 undefined 覆盖成 NULL（会撞 NOT NULL 约束变 500）。
    const renamed = await app.inject({ method: "PATCH", url: `/api/v1/models/${id}`, payload: { name: "小满 2.0" } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: "小满 2.0", notes: "甜酷风", spec: MODEL_SPEC_DEFAULTS });

    // 只清空备注：空串是合法的清空操作，名称与规格不受影响。
    const cleared = await app.inject({ method: "PATCH", url: `/api/v1/models/${id}`, payload: { notes: "" } });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ name: "小满 2.0", notes: "", spec: MODEL_SPEC_DEFAULTS });

    // 只改规格：互斥校验照旧生效，且失败不落库。
    const conflicting = await app.inject({
      method: "PATCH",
      url: `/api/v1/models/${id}`,
      payload: { spec: { ...MODEL_SPEC_DEFAULTS, hairLength: "CROP", hairstyle: "HIGH_BUN" } },
    });
    expect(conflicting.statusCode).toBe(400);
    expect(repository.getModel(id)).toMatchObject({ notes: "", spec: MODEL_SPEC_DEFAULTS });
  });
});

describe("GET /api/v1/suites 分页与筛选", () => {
  const importedSuite = {
    name: "接口导入套图",
    category: { l1: "测试专用品类", l2: "接口护理", leaf: "接口洁面乳" },
    styleLock: { lockText: "柔光白底，暖米色台面，左上主光" },
    shots: [{ shotId: "shot-1", order: 1, shotRole: "HERO" as const, displayName: "主图", promptTemplate: "hero {product}" }]
  };

  it("返回 items/nextCursor/total/l1Counts，且 l1Counts 合计等于 total", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/suites" });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: Array<{ id: string }>; nextCursor: string | null; total: number; l1Counts: Record<string, number> }>();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThanOrEqual(body.items.length);
    expect(Object.values(body.l1Counts).reduce((sum, count) => sum + count, 0)).toBe(body.total);
  });

  it("limit + cursor 逐页取完全部套图且不重复", async () => {
    const first = await app.inject({ method: "GET", url: "/api/v1/suites?limit=1" });
    const firstBody = first.json<{ items: Array<{ id: string }>; nextCursor: string | null; total: number }>();
    expect(firstBody.items).toHaveLength(1);

    const seen = [firstBody.items[0].id];
    let cursor = firstBody.nextCursor;
    while (cursor) {
      const page = await app.inject({ method: "GET", url: `/api/v1/suites?limit=1&cursor=${encodeURIComponent(cursor)}` });
      const body = page.json<{ items: Array<{ id: string }>; nextCursor: string | null }>();
      seen.push(...body.items.map((item) => item.id));
      expect(seen.length).toBeLessThanOrEqual(firstBody.total);
      cursor = body.nextCursor;
    }
    expect(new Set(seen).size).toBe(firstBody.total);
  });

  it("q/l1 过滤只改变返回项，total 与 l1Counts 保持来源区间口径", async () => {
    const all = (await app.inject({ method: "GET", url: "/api/v1/suites" }))
      .json<{ items: Array<{ id: string; name: string; category: { l1: string } }>; total: number; l1Counts: Record<string, number> }>();
    const target = all.items[0];

    const byL1 = (await app.inject({ method: "GET", url: `/api/v1/suites?l1=${encodeURIComponent(target.category.l1)}` }))
      .json<{ items: Array<{ category: { l1: string } }>; total: number; l1Counts: Record<string, number> }>();
    expect(byL1.items.length).toBe(all.l1Counts[target.category.l1]);
    expect(byL1.items.every((item) => item.category.l1 === target.category.l1)).toBe(true);
    expect(byL1.total).toBe(all.total);
    expect(byL1.l1Counts).toEqual(all.l1Counts);

    const byKeyword = (await app.inject({ method: "GET", url: `/api/v1/suites?q=${encodeURIComponent(target.name.slice(1, 4))}` }))
      .json<{ items: Array<{ id: string }>; total: number }>();
    expect(byKeyword.items.map((item) => item.id)).toContain(target.id);
    expect(byKeyword.total).toBe(all.total);
  });

  it("ids 精确回读忽略未知 ID 并绕过分页", async () => {
    const all = (await app.inject({ method: "GET", url: "/api/v1/suites" })).json<{ items: Array<{ id: string }> }>();
    const [first, second] = all.items;
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/suites?ids=${encodeURIComponent(`${second.id},${first.id},suite-ghost`)}&limit=1`
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: Array<{ id: string }>; nextCursor: string | null }>();
    expect(body.items.map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
    expect(body.nextCursor).toBeNull();

    const tooMany = await app.inject({ method: "GET", url: `/api/v1/suites?ids=${Array.from({ length: 25 }, (_, index) => `suite-${index}`).join(",")}` });
    expect(tooMany.statusCode).toBe(400);
  });

  it("导入与删除立即反映到列表，不需要额外 refresh", async () => {
    const before = (await app.inject({ method: "GET", url: "/api/v1/suites" })).json<{ total: number }>();

    const created = await app.inject({ method: "POST", url: "/api/v1/suites", payload: importedSuite });
    expect(created.statusCode).toBe(201);
    const suiteId = created.json<{ id: string }>().id;

    // 内置套图数量远超单页，用导入套图的专用品类过滤定位，不依赖默认首页位置。
    const afterInsert = (await app.inject({ method: "GET", url: "/api/v1/suites", query: { l1: "测试专用品类" } }))
      .json<{ items: Array<{ id: string }>; total: number; l1Counts: Record<string, number> }>();
    expect(afterInsert.total).toBe(before.total + 1);
    expect(afterInsert.l1Counts["测试专用品类"]).toBe(1);
    expect(afterInsert.items.some((item) => item.id === suiteId)).toBe(true);

    const deleted = await app.inject({ method: "DELETE", url: `/api/v1/suites/${suiteId}` });
    expect(deleted.statusCode).toBe(204);
    const afterDelete = (await app.inject({ method: "GET", url: "/api/v1/suites", query: { l1: "测试专用品类" } }))
      .json<{ items: Array<{ id: string }>; total: number; l1Counts: Record<string, number> }>();
    expect(afterDelete.total).toBe(before.total);
    expect(afterDelete.l1Counts["测试专用品类"]).toBeUndefined();
    expect(afterDelete.items.some((item) => item.id === suiteId)).toBe(false);

    // 已删除的游标按“已到底”处理：宁可少一页，也不要重复或死循环
    const stale = await app.inject({ method: "GET", url: `/api/v1/suites?limit=1&cursor=${Buffer.from(suiteId, "utf8").toString("base64url")}` });
    expect(stale.statusCode).toBe(200);
    expect(stale.json<{ items: unknown[]; nextCursor: string | null }>()).toMatchObject({ items: [], nextCursor: null });

    expect((await app.inject({ method: "DELETE", url: `/api/v1/suites/${suiteId}` })).statusCode).toBe(409);
  });

  it("origin 收窄列表与品类计数，originCounts 报全库库存，未知取值报 400", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/suites", payload: { ...importedSuite, name: "来源筛选导入套图" } });
    expect(created.statusCode).toBe(201);
    const suiteId = created.json<{ id: string }>().id;

    try {
      const all = (await app.inject({ method: "GET", url: "/api/v1/suites" }))
        .json<{ total: number; originCounts: { builtin: number; user: number } }>();
      expect(all.originCounts.builtin + all.originCounts.user).toBe(all.total);

      const user = (await app.inject({ method: "GET", url: "/api/v1/suites", query: { origin: "user" } }))
        .json<{ items: Array<{ id: string; origin: string }>; total: number; l1Counts: Record<string, number> }>();
      expect(user.total).toBe(all.originCounts.user);
      expect(user.items.every((item) => item.origin === "user")).toBe(true);
      expect(user.items.some((item) => item.id === suiteId)).toBe(true);
      expect(user.l1Counts["测试专用品类"]).toBeGreaterThanOrEqual(1);

      const builtin = (await app.inject({ method: "GET", url: "/api/v1/suites", query: { origin: "builtin", limit: "5" } }))
        .json<{ items: Array<{ origin: string }>; total: number }>();
      expect(builtin.total).toBe(all.originCounts.builtin);
      expect(builtin.items.every((item) => item.origin === "builtin")).toBe(true);

      expect((await app.inject({ method: "GET", url: "/api/v1/suites?origin=USER" })).statusCode).toBe(400);
    } finally {
      await app.inject({ method: "DELETE", url: `/api/v1/suites/${suiteId}` });
    }
  });

  it("POST /suites/refresh 返回首页且形状与列表一致", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/suites/refresh" });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: unknown[]; nextCursor: string | null; total: number; l1Counts: Record<string, number> }>();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThanOrEqual(body.items.length);
    expect(Object.values(body.l1Counts).reduce((sum, count) => sum + count, 0)).toBe(body.total);
  });
});

describe("segmentation model declarations & refs", () => {
  function seedSegmentationProvider() {
    const provider = saveProvider([
      ...DEFAULT_MODELS,
      { id: "sam-3", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: null, segmentationProtocol: "fal" }
    ]);
    const project = makeProject(provider.id, { name: "seg-cup", segmentationModel: null });
    return { provider, project };
  }

  it("同一模型不能同时声明生图与分割能力", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/providers",
      payload: { name: "dup", baseUrl: "https://example.test/v1", reasoningProtocol: "openai", apiKey: "k", models: [{ id: "both", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: "openai_images", segmentationProtocol: "fal" }] }
    });
    expect(response.statusCode).toBe(400);
  });

  it("PATCH /projects/:id 校验分割引用：未声明 400、非分割 422、协议不匹配 400、声明模型派生协议", async () => {
    const { provider, project } = seedSegmentationProvider();
    const undeclared = await app.inject({ method: "PATCH", url: `/api/v1/projects/${project.id}`, payload: { segmentationModel: { providerId: provider.id, modelId: "unknown" } } });
    expect(undeclared.statusCode).toBe(400);

    const notSegmentation = await app.inject({ method: "PATCH", url: `/api/v1/projects/${project.id}`, payload: { segmentationModel: { providerId: provider.id, modelId: "reasoner" } } });
    expect(notSegmentation.statusCode).toBe(422);
    expect(notSegmentation.json<{ error: { code: string } }>().error.code).toBe("CAPABILITY_UNSUPPORTED");

    const mismatched = await app.inject({ method: "PATCH", url: `/api/v1/projects/${project.id}`, payload: { segmentationModel: { providerId: provider.id, modelId: "sam-3", protocol: "seedream_layerize" } } });
    expect(mismatched.statusCode).toBe(400);

    const ok = await app.inject({ method: "PATCH", url: `/api/v1/projects/${project.id}`, payload: { segmentationModel: { providerId: provider.id, modelId: "sam-3" } } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ segmentationModel: { providerId: string; modelId: string; protocol: string } }>().segmentationModel)
      .toEqual({ providerId: provider.id, modelId: "sam-3", protocol: "fal" });
  });

  it("provider test kind=segmentation 拒绝未声明分割协议的模型", async () => {
    const { provider } = seedSegmentationProvider();
    const unsupported = await app.inject({ method: "POST", url: `/api/v1/providers/${provider.id}/test`, payload: { modelId: "reasoner", kind: "segmentation" } });
    expect(unsupported.statusCode).toBe(422);
    expect(unsupported.json<{ error: { code: string } }>().error.code).toBe("CAPABILITY_UNSUPPORTED");

    const unknown = await app.inject({ method: "POST", url: `/api/v1/providers/${provider.id}/test`, payload: { modelId: "ghost", kind: "segmentation" } });
    expect(unknown.statusCode).toBe(400);
  });
});

describe("DELETE /api/v1/projects/:projectId 路径穿越防御", () => {
  it.each(["..", encodeURIComponent("../evil"), encodeURIComponent("C:\Windows")])("拒绝非 UUID 的项目 ID：%s", async (encoded) => {
    // 与被测 API 共享 dataDir：穿越参数若抵达存储层会删除目录内容，这里预置一个受害者文件
    const store = new LocalAssetStore(dataDir);
    await store.initialize();
    const victim = await store.putAsset("victim", "keep.png", Buffer.from("victim"));
    const response = await app.inject({ method: "DELETE", url: `/api/v1/projects/${encoded}` });
    // 字面 ".." 段在路由层就被 404 掉，其余形态到达处理器后返回 400；不变量都是不触达存储层
    expect([400, 404]).toContain(response.statusCode);
    await expect(store.exists(victim.path)).resolves.toBe(true);
  });
});

describe("CORS 来源白名单", () => {
  it("未配置时只允许本机 dev server 来源，任意站点不带 allow-origin", async () => {
    const trusted = await app.inject({ method: "GET", url: "/health", headers: { origin: "http://localhost:5173" } });
    expect(trusted.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const untrusted = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://untrusted.example" } });
    expect(untrusted.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("通配符与非 origin 形态在启动时失败", () => {
    expect(() => resolveCorsOrigins(["*"])).toThrow();
    expect(() => resolveCorsOrigins(["https://untrusted.example/path"])).toThrow();
    expect(() => resolveCorsOrigins(["ftp://untrusted.example"])).toThrow();
    expect(() => resolveCorsOrigins([])).toThrow();
    expect(resolveCorsOrigins(["https://console.example.com"])).toEqual(["https://console.example.com"]);
  });
});

describe("入队失败的任务状态", () => {
  it("入队抛错时任务落为 FAILED(QUEUE_UNAVAILABLE)，相同请求不再复用坏任务", async () => {
    const project = seedProject("queue-down");
    vi.mocked(enqueue).mockRejectedValueOnce(new Error("redis down"));
    const failed = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/planning-jobs`, payload: {} });
    expect(failed.statusCode).toBe(503);
    expect(failed.json<{ error: { code: string } }>().error.code).toBe("QUEUE_UNAVAILABLE");
    const failedJob = repository.listJobs(project.id)[0];
    expect(failedJob).toMatchObject({ status: "FAILED", retryable: true });
    expect(failedJob.error).toMatchObject({ code: "QUEUE_UNAVAILABLE" });

    const retried = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/planning-jobs`, payload: {} });
    expect(retried.statusCode).toBe(202);
    expect(retried.json<{ id: string }>().id).not.toBe(failedJob.id);
  });

  it("入队失败不波及按指纹复用的既有任务", async () => {
    // 生成批次里新旧任务混合：入队失败只允许落终态本次新建的任务
    const project = seedProject("reuse-safe");
    repository.saveStoryboard(project.id, "", "CONFIRMED", [
      {
        assetType: "hero-image",
        displayName: "首图",
        shotRole: null,
        templateVariant: null,
        candidateCount: 1,
        referencedAssets: [],
        mode: "CREATIVE",
        status: "DRAFT",
        promptInstruction: "hero",
        compiledPrompt: null,
        factClaims: [],
        riskFlags: [],
        sortOrder: 0,
      },
      {
        assetType: "lifestyle-scene",
        displayName: "场景图",
        shotRole: null,
        templateVariant: null,
        candidateCount: 1,
        referencedAssets: [],
        mode: "CREATIVE",
        status: "DRAFT",
        promptInstruction: "scene",
        compiledPrompt: null,
        factClaims: [],
        riskFlags: [],
        sortOrder: 1,
      },
    ]);
    const itemsAll = repository.listStoryboardItems(project.id);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/generation-jobs`,
      payload: { storyboardItemIds: [itemsAll[0].id], revision: "initial" },
    });
    expect(first.statusCode).toBe(202);
    const reusedJobId = first.json<{ jobs: Array<{ id: string }> }>().jobs[0].id;

    vi.mocked(enqueue).mockRejectedValueOnce(new Error("redis down"));
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/generation-jobs`,
      payload: { storyboardItemIds: [itemsAll[0].id, itemsAll[1].id], revision: "initial" },
    });
    expect(second.statusCode).toBe(503);
    // 复用的既有任务保持 QUEUED，新任务落 FAILED(QUEUE_UNAVAILABLE)
    expect(repository.getJob(reusedJobId)).toMatchObject({ status: "QUEUED" });
    const jobs = repository.listJobs(project.id);
    expect(jobs).toHaveLength(2);
    const newJob = jobs.find((job) => job.id !== reusedJobId);
    expect(newJob).toMatchObject({ status: "FAILED" });
    expect(newJob?.error).toMatchObject({ code: "QUEUE_UNAVAILABLE" });
  });
});

/** 确认态分镜：生成入口要求 storyboard.status=CONFIRMED。 */
function seedConfirmedStoryboard(projectId: string) {
  repository.saveStoryboard(projectId, "", "CONFIRMED", [{
    assetType: "hero-image",
    displayName: "首图",
    shotRole: null,
    templateVariant: null,
    candidateCount: 1,
    referencedAssets: [],
    mode: "CREATIVE",
    status: "DRAFT",
    promptInstruction: "hero",
    compiledPrompt: null,
    factClaims: [],
    riskFlags: [],
    sortOrder: 0,
  }]);
  return repository.listStoryboardItems(projectId);
}

describe("POST /api/v1/projects/:projectId/generation-jobs 批次与指纹", () => {
  it("部分 item 无效时整体返回 400 且不留下孤儿任务", async () => {
    const project = seedProject("batch");
    const items = seedConfirmedStoryboard(project.id);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/generation-jobs`,
      payload: { storyboardItemIds: [items[0].id, randomUUID()], revision: "initial" },
    });
    expect(response.statusCode).toBe(400);
    expect(repository.listJobs(project.id)).toHaveLength(0);
  });

  it("生成指纹纳入有效 Provider/模型：切换 Provider 产生新任务而非复用旧结果", async () => {
    const providerA = saveProvider();
    const project = makeProject(providerA.id);
    const items = seedConfirmedStoryboard(project.id);
    const providerB = saveProvider();

    const initial = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/generation-jobs`,
      payload: { storyboardItemIds: [items[0].id], revision: "initial" },
    });
    expect(initial.statusCode).toBe(202);
    const initialJob = initial.json<{ jobs: Array<{ id: string; providerId: string }> }>().jobs[0];
    expect(initialJob.providerId).toBe(providerA.id);

    const override = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/generation-jobs`,
      payload: { storyboardItemIds: [items[0].id], revision: "initial", generationConfig: { imageModel: { providerId: providerB.id, modelId: "image" } } },
    });
    const overrideJob = override.json<{ jobs: Array<{ id: string; providerId: string }> }>().jobs[0];
    expect(override.statusCode).toBe(202);
    expect(overrideJob.providerId).toBe(providerB.id);
    expect(overrideJob.id).not.toBe(initialJob.id);

    // 相同 Provider 覆盖请求仍按指纹复用，不重复计费
    const repeat = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/generation-jobs`,
      payload: { storyboardItemIds: [items[0].id], revision: "initial", generationConfig: { imageModel: { providerId: providerB.id, modelId: "image" } } },
    });
    expect(repeat.json<{ jobs: Array<{ id: string }> }>().jobs[0].id).toBe(overrideJob.id);
  });
});

describe("POST /api/v1/projects/:projectId/planning-jobs 规划指纹", () => {
  it("项目规划事实变化后相同请求创建新任务，不复用旧规划", async () => {
    const project = seedProject("revision");
    const first = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/planning-jobs`, payload: { planningMode: "AI", requestedTypes: ["hero-image"] } });
    expect(first.statusCode).toBe(202);
    const firstJob = first.json<{ id: string; input: { planningRevision: number } }>();
    expect(firstJob.input.planningRevision).toBe(0);

    repository.updateProject(project.id, { verifiedFacts: ["304 不锈钢"] });

    const second = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/planning-jobs`, payload: { planningMode: "AI", requestedTypes: ["hero-image"] } });
    expect(second.statusCode).toBe(202);
    const secondJob = second.json<{ id: string; input: { planningRevision: number } }>();
    expect(secondJob.id).not.toBe(firstJob.id);
    expect(secondJob.input.planningRevision).toBe(1);
  });
});

describe("POST /api/v1/projects/:projectId/storyboard/confirm 版本校验", () => {
  it("过期版本返回 409 并带回当前版本，当前版本可确认", async () => {
    const project = seedProject("confirm");
    seedConfirmedStoryboard(project.id);
    const storyboard = repository.getStoryboard(project.id);
    expect(storyboard).toBeDefined();
    const version = storyboard!.version;

    const stale = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/storyboard/confirm`, payload: { version: version + 1 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { details: Array<{ reason: string }> } }>().error.details).toEqual([{ path: "/version", reason: `expected ${version}` }]);

    const missing = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/storyboard/confirm`, payload: {} });
    expect(missing.statusCode).toBe(400);

    const current = await app.inject({ method: "POST", url: `/api/v1/projects/${project.id}/storyboard/confirm`, payload: { version } });
    expect(current.statusCode).toBe(200);
    expect(repository.getStoryboard(project.id)).toMatchObject({ status: "CONFIRMED", version });
  });
});
