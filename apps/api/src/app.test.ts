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
import { buildApi } from "./app.js";
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
});

afterEach(async () => {
  await app.close();
  database.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function seedFailedGenerateJob(): ReturnType<EcomRepository["createJob"]> {
  const provider = repository.saveProvider({
    name: "test",
    baseUrl: "https://example.test/v1",
    encryptedApiKey: "encrypted",
    reasoningProtocol: "openai",
    models: [
      { id: "reasoner", supportsVision: true, supportsThinking: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null },
      { id: "image", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: "openai_images" }
    ]
  });
  const project = repository.createProject({ name: "cup", category: null, productDescription: null, verifiedFacts: [], prohibitedClaims: [], brandGuidelines: {}, platformTargets: ["TAOBAO"], targetMarket: null, copyLanguage: null, reasoningProviderId: provider.id, reasoningModelId: "reasoner", imageProviderId: provider.id, imageModelId: "image", defaultMode: "CREATIVE", imageResolution: "1K", imageAspectRatio: "AUTO", candidatesPerType: 1 });
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
});

function seedProject(repository: EcomRepository, name: string) {
  const provider = repository.saveProvider({
    name: "test",
    baseUrl: "https://example.test/v1",
    encryptedApiKey: "encrypted",
    reasoningProtocol: "openai",
    models: [
      { id: "reasoner", supportsVision: true, supportsThinking: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null },
      { id: "image", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: "openai_images" }
    ]
  });
  return repository.createProject({ name, category: null, productDescription: null, verifiedFacts: [], prohibitedClaims: [], brandGuidelines: {}, platformTargets: ["TAOBAO"], targetMarket: null, copyLanguage: null, reasoningProviderId: provider.id, reasoningModelId: "reasoner", imageProviderId: provider.id, imageModelId: "image", defaultMode: "CREATIVE", imageResolution: "1K", imageAspectRatio: "AUTO", candidatesPerType: 1 });
}

/** 与 buildApi 共享同一 dataDir：测试侧直接用 LocalAssetStore 落盘源文件，绕开 multipart 构造。 */
async function seedSourceAsset(repository: EcomRepository, projectId: string, content: Buffer, role: "PRODUCT_TRUTH" | "STYLE_REFERENCE" = "PRODUCT_TRUTH") {
  const stored = await new LocalAssetStore(dataDir).putAsset(projectId, "source.png", content);
  return repository.createAsset({ projectId, role, storagePath: stored.path, hash: stored.hash, originalName: "source.png", mimeType: "image/png", width: null, height: null });
}

describe("asset library", () => {
  it("从资产库复制图片到目标项目：新记录、独立文件，库列表按 hash 去重并映射来源", async () => {
    const sourceProject = seedProject(repository, "source");
    const targetProject = seedProject(repository, "target");
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
    const project = seedProject(repository, "source");
    const source = await seedSourceAsset(repository, project.id, await samplePng());
    const listing = await app.inject({ method: "GET", url: "/api/v1/library-assets" });
    const listed = listing.json<{ items: Array<{ id: string; thumbnailUrl: string }> }>().items.find((item) => item.id === `asset:${source.id}`);
    const thumbnail = await app.inject({ method: "GET", url: listed!.thumbnailUrl });
    expect(thumbnail.statusCode).toBe(200);
    expect(thumbnail.headers["content-type"]).toContain("image/webp");
  });

  it("库列表包含生成结果并按 GENERATED 类型筛选", async () => {
    const project = seedProject(repository, "source");
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
    const sourceProject = seedProject(repository, "source");
    const targetProject = seedProject(repository, "target");
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

  it("目标项目已有同内容图片时拒绝复制", async () => {
    const sourceProject = seedProject(repository, "source");
    const targetProject = seedProject(repository, "target");
    const source = await seedSourceAsset(repository, sourceProject.id, await samplePng());
    const first = await app.inject({ method: "POST", url: `/api/v1/projects/${targetProject.id}/assets/from-library`, payload: { itemId: `asset:${source.id}` } });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: "POST", url: `/api/v1/projects/${targetProject.id}/assets/from-library`, payload: { itemId: `asset:${source.id}` } });
    expect(second.statusCode).toBe(400);
  });

  it("商品图达到容量上限后拒绝从库复制", async () => {
    const sourceProject = seedProject(repository, "source");
    const targetProject = seedProject(repository, "target");
    for (let index = 0; index < 6; index += 1) {
      repository.createAsset({ projectId: targetProject.id, role: "PRODUCT_TRUTH", storagePath: `assets/${targetProject.id}/${index}.png`, hash: `hash-${index}`, originalName: `${index}.png`, mimeType: "image/png", width: null, height: null });
    }
    const source = await seedSourceAsset(repository, sourceProject.id, await samplePng());
    const response = await app.inject({ method: "POST", url: `/api/v1/projects/${targetProject.id}/assets/from-library`, payload: { itemId: `asset:${source.id}`, kind: "PRODUCT" } });
    expect(response.statusCode).toBe(400);
  });

  it("省略 kind 时沿用源资产 role", async () => {
    const sourceProject = seedProject(repository, "source");
    const targetProject = seedProject(repository, "target");
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
  const provider = repository.saveProvider({
    name: "layer",
    baseUrl: "https://example.test/v1",
    encryptedApiKey: "encrypted",
    reasoningProtocol: "openai",
    models: [
      { id: "reasoner", supportsVision: true, supportsThinking: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null },
      { id: "reasoner-2", supportsVision: true, supportsThinking: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null },
      { id: "sam-3", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: null, segmentationProtocol: "fal" },
      { id: "layerize", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: null, segmentationProtocol: "seedream_layerize" }
    ]
  });
  const project = repository.createProject({ name: "layer-cup", category: null, productDescription: null, verifiedFacts: [], prohibitedClaims: [], brandGuidelines: {}, platformTargets: ["TAOBAO"], targetMarket: null, copyLanguage: null, reasoningProviderId: provider.id, reasoningModelId: "reasoner", imageProviderId: provider.id, imageModelId: null, defaultMode: "CREATIVE", imageResolution: "1K", imageAspectRatio: "AUTO", candidatesPerType: 1, segmentationModel: segmentationModelId ? { providerId: provider.id, modelId: segmentationModelId } : null });
  repository.saveStoryboard(project.id, "", "CONFIRMED", [{ assetType: "hero", displayName: "主图", shotRole: null, templateVariant: null, candidateCount: 1, referencedAssets: [], mode: "CREATIVE", status: "CONFIRMED", promptInstruction: "", compiledPrompt: null, factClaims: [], riskFlags: [], sortOrder: 0 }]);
  const item = repository.listStoryboardItems(project.id)[0]!;
  const job = repository.createJob({ id: randomUUID(), projectId: project.id, storyboardItemId: null, type: "GENERATE", input: {} });
  const output = repository.createOutput({ projectId: project.id, storyboardItemId: item.id, jobId: job.id, candidateIndex: 1, generationSnapshot: null, storagePath: `outputs/${project.id}/seed.png`, hash: "hash-1" });
  return { provider, project, output };
}

describe("layer plan & layer exports", () => {
  beforeEach(() => { vi.mocked(enqueue).mockClear(); });

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

  it("layer-exports 依次校验分割模型、识别方案与元素合法性", async () => {
    const { output } = seedLayerProject(null);
    const noModel = await app.inject({ method: "POST", url: `/api/v1/outputs/${output.id}/layer-exports`, payload: { elements: [{ id: "a", name: "瓶子", source: "auto" }] } });
    expect(noModel.statusCode).toBe(422);
    expect(noModel.json<{ error: { code: string } }>().error.code).toBe("PROVIDER_NOT_CONFIGURED");

    const configured = seedLayerProject("sam-3");
    const noPlan = await app.inject({ method: "POST", url: `/api/v1/outputs/${configured.output.id}/layer-exports`, payload: { elements: [{ id: "a", name: "瓶子", source: "auto" }] } });
    expect(noPlan.statusCode).toBe(409);

    // 画框/提示词元素无需识别方案即可直接分层（planId 为空）；auto 元素仍要求已成功的识别方案
    const manualOnly = await app.inject({ method: "POST", url: `/api/v1/outputs/${configured.output.id}/layer-exports`, payload: { elements: [{ id: "m-1", name: "自定义", source: "manual", bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } }] } });
    expect(manualOnly.statusCode).toBe(202);
    expect(manualOnly.json<{ layerExport: { planId: string | null; status: string } }>().layerExport).toMatchObject({ planId: null, status: "QUEUED" });

    const promptOnly = await app.inject({ method: "POST", url: `/api/v1/outputs/${configured.output.id}/layer-exports`, payload: { elements: [{ id: "p-1", name: "标题", source: "prompt" }] } });
    expect(promptOnly.statusCode).toBe(202);

    const plan = repository.createLayerPlan({ projectId: configured.project.id, outputId: configured.output.id, jobId: randomUUID(), outputHash: "hash-1", status: "SUCCEEDED", elements: [{ id: "el-1", name: "瓶子", source: "auto", bbox: null }], error: null });
    const manualWithoutBbox = await app.inject({ method: "POST", url: `/api/v1/outputs/${configured.output.id}/layer-exports`, payload: { elements: [{ id: "m-1", name: "背景", source: "manual" }] } });
    expect(manualWithoutBbox.statusCode).toBe(400);

    const unknownAuto = await app.inject({ method: "POST", url: `/api/v1/outputs/${configured.output.id}/layer-exports`, payload: { planId: plan.id, elements: [{ id: "el-x", name: "不存在", source: "auto" }] } });
    expect(unknownAuto.statusCode).toBe(409);

    // auto 元素引用方案局部 id，必须携带其所属 planId；重识别后旧选择不得静默套用到新方案
    const stalePlan = await app.inject({ method: "POST", url: `/api/v1/outputs/${configured.output.id}/layer-exports`, payload: { planId: randomUUID(), elements: [{ id: "el-1", name: "瓶子", source: "auto" }] } });
    expect(stalePlan.statusCode).toBe(409);

    const valid = await app.inject({ method: "POST", url: `/api/v1/outputs/${configured.output.id}/layer-exports`, payload: { planId: plan.id, elements: [{ id: "el-1", name: "瓶子", source: "auto" }, { id: "m-1", name: "自定义", source: "manual", bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } }] } });
    expect(valid.statusCode).toBe(202);
    const bundle = valid.json<{ job: { type: string }; layerExport: { id: string; planId: string; includeBackground: boolean; status: string } }>();
    expect(bundle.job.type).toBe("LAYER_EXPORT");
    expect(bundle.layerExport).toMatchObject({ planId: plan.id, includeBackground: true, status: "QUEUED" });
    expect(vi.mocked(enqueue).mock.calls.some(([, payload]) => payload.kind === "layer_export")).toBe(true);

    const duplicate = await app.inject({ method: "POST", url: `/api/v1/outputs/${configured.output.id}/layer-exports`, payload: { planId: plan.id, elements: [{ id: "el-1", name: "瓶子", source: "auto" }, { id: "m-1", name: "自定义", source: "manual", bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } }] } });
    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json<{ layerExport: { id: string } }>().layerExport.id).toBe(bundle.layerExport.id);

    // 历史导出按时间倒序列出每次导出；重复请求命中指纹不新增记录（前面已产生 manualOnly/promptOnly/valid 三条）
    const another = await app.inject({ method: "POST", url: `/api/v1/outputs/${configured.output.id}/layer-exports`, payload: { elements: [{ id: "p-9", name: "标题", source: "prompt" }] } });
    expect(another.statusCode).toBe(202);
    const history = await app.inject({ method: "GET", url: `/api/v1/outputs/${configured.output.id}/layer-exports/history` });
    expect(history.statusCode).toBe(200);
    const listed = history.json<{ exports: Array<{ id: string; psdDownloadUrl: string | null; layerFiles: Array<{ downloadUrl: string }> | null }> }>().exports;
    expect(listed).toHaveLength(4);
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

describe("segmentation model declarations & refs", () => {
  function seedSegmentationProvider() {
    const provider = repository.saveProvider({
      name: "seg",
      baseUrl: "https://example.test/v1",
      encryptedApiKey: "encrypted",
      reasoningProtocol: "openai",
      models: [
        { id: "reasoner", supportsVision: true, supportsThinking: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null },
        { id: "image", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: "openai_images" },
        { id: "sam-3", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: null, segmentationProtocol: "fal" }
      ]
    });
    const project = repository.createProject({ name: "seg-cup", category: null, productDescription: null, verifiedFacts: [], prohibitedClaims: [], brandGuidelines: {}, platformTargets: ["TAOBAO"], targetMarket: null, copyLanguage: null, reasoningProviderId: provider.id, reasoningModelId: "reasoner", imageProviderId: provider.id, imageModelId: "image", defaultMode: "CREATIVE", imageResolution: "1K", imageAspectRatio: "AUTO", candidatesPerType: 1, segmentationModel: null });
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
