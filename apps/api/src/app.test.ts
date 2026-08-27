import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// App 级端点测试的边界在 Redis/BullMQ：状态真相是 SQLite 与 REST 响应，
// 入队只需要确认发生且方向正确，不应要求本地真实 Redis。
vi.mock("@ecomgen/jobs", async () => {
  const connection = { duplicate: () => connection, quit: async () => {} };
  return {
    QUEUE_NAME: "ecomgen-test",
    createRedisConnection: () => connection,
    createJobQueue: () => ({ close: async () => {} }),
    enqueue: vi.fn(async () => {}),
    RedisProjectEventBus: class {
      public async publish(projectId: string, type: string, data: unknown) {
        return { id: randomUUID(), projectId, type, occurredAt: new Date().toISOString(), data };
      }
      public async subscribe(_projectId: string, listener: (event: unknown) => void) {
        return async () => void listener;
      }
      public async close() {}
    }
  };
});

import type { FastifyInstance } from "fastify";
import { EcomRepository, openDatabase } from "@ecomgen/core";
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
  const project = repository.createProject({ name: "cup", category: null, productDescription: null, verifiedFacts: [], prohibitedClaims: [], brandGuidelines: {}, platformTargets: ["DOMESTIC"], targetMarket: null, copyLanguage: null, reasoningProviderId: provider.id, reasoningModelId: "reasoner", imageProviderId: provider.id, imageModelId: "image", defaultMode: "CREATIVE", imageResolution: "1K", imageAspectRatio: "AUTO", candidatesPerType: 1 });
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
