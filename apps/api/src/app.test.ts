import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("assets from history", () => {
  it("从历史复制图片到目标项目：新记录、独立文件、历史列表按 hash 去重并排除目标项目", async () => {
    const sourceProject = seedProject(repository, "source");
    const targetProject = seedProject(repository, "target");
    const source = await seedSourceAsset(repository, sourceProject.id, Buffer.from("image-bytes"));

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${targetProject.id}/assets/from-history`,
      payload: { assetId: source.id, kind: "PRODUCT" },
    });
    expect(response.statusCode).toBe(201);
    const copied = response.json<{ projectId: string; role: string; hash: string; storagePath: string }>();
    expect(copied).toMatchObject({ projectId: targetProject.id, role: "PRODUCT_TRUTH", hash: source.hash, originalName: "source.png" });
    expect(copied.storagePath).not.toBe(source.storagePath);
    expect(await new LocalAssetStore(dataDir).exists(copied.storagePath)).toBe(true);

    const allHistory = await app.inject({ method: "GET", url: "/api/v1/asset-history" });
    const hashes = allHistory.json<{ items: Array<{ hash: string }> }>().items.map((item) => item.hash);
    expect(hashes.filter((hash) => hash === source.hash)).toHaveLength(1);

    const excluded = await app.inject({ method: "GET", url: `/api/v1/asset-history?excludeProjectId=${targetProject.id}` });
    expect(excluded.json<{ items: Array<{ hash: string }> }>().items.map((item) => item.hash)).not.toContain(source.hash);
  });

  it("源资产不存在或源文件缺失时返回 404 且不产生新记录", async () => {
    const sourceProject = seedProject(repository, "source");
    const targetProject = seedProject(repository, "target");
    const unknown = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${targetProject.id}/assets/from-history`,
      payload: { assetId: randomUUID() },
    });
    expect(unknown.statusCode).toBe(404);

    const source = await seedSourceAsset(repository, sourceProject.id, Buffer.from("missing"));
    await new LocalAssetStore(dataDir).delete(source.storagePath);
    const missingFile = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${targetProject.id}/assets/from-history`,
      payload: { assetId: source.id },
    });
    expect(missingFile.statusCode).toBe(404);
    expect(repository.listAssets(targetProject.id)).toHaveLength(0);
  });

  it("目标项目已有同内容图片时拒绝复制", async () => {
    const sourceProject = seedProject(repository, "source");
    const targetProject = seedProject(repository, "target");
    const source = await seedSourceAsset(repository, sourceProject.id, Buffer.from("image-bytes"));
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${targetProject.id}/assets/from-history`,
      payload: { assetId: source.id },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${targetProject.id}/assets/from-history`,
      payload: { assetId: source.id },
    });
    expect(second.statusCode).toBe(400);
  });

  it("商品图达到容量上限后拒绝从历史复制", async () => {
    const sourceProject = seedProject(repository, "source");
    const targetProject = seedProject(repository, "target");
    for (let index = 0; index < 6; index += 1) {
      repository.createAsset({ projectId: targetProject.id, role: "PRODUCT_TRUTH", storagePath: `assets/${targetProject.id}/${index}.png`, hash: `hash-${index}`, originalName: `${index}.png`, mimeType: "image/png", width: null, height: null });
    }
    const source = await seedSourceAsset(repository, sourceProject.id, Buffer.from("image-bytes"));
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${targetProject.id}/assets/from-history`,
      payload: { assetId: source.id, kind: "PRODUCT" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("省略 kind 时沿用源资产 role", async () => {
    const sourceProject = seedProject(repository, "source");
    const targetProject = seedProject(repository, "target");
    const source = await seedSourceAsset(repository, sourceProject.id, Buffer.from("reference"), "STYLE_REFERENCE");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${targetProject.id}/assets/from-history`,
      payload: { assetId: source.id },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<{ role: string }>().role).toBe("STYLE_REFERENCE");
  });
});
