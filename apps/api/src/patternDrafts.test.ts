import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

// 与 app.test.ts 同一立场：入队只确认方向，不要求真实 Redis。
vi.mock("@ecomgen/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ecomgen/jobs")>();
  const connection = { duplicate: () => connection, quit: async () => { } };
  return {
    ...actual,
    QUEUE_NAME: "ecomgen-test",
    createRedisConnection: () => connection,
    createJobQueue: () => ({ close: async () => { }, getJob: async () => undefined }),
    enqueue: vi.fn(async () => { }),
    RedisProjectEventBus: class {
      public async publish(projectId: string, type: string, data: unknown) { return { id: randomUUID(), projectId, type, occurredAt: new Date().toISOString(), data }; }
      public async subscribe() { return async () => undefined; }
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
let storage: LocalAssetStore;
let app: FastifyInstance;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "ecomgen-draft-api-"));
  app = await buildApi({ dataDir, redisUrl: "redis://127.0.0.1:6399", masterKey: Buffer.alloc(32, 7).toString("base64") });
  database = openDatabase(join(dataDir, "ecomgen.sqlite"));
  repository = new EcomRepository(database);
  storage = new LocalAssetStore(dataDir);
  vi.mocked(enqueue).mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await app.close();
  database.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function samplePng(): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 10, g: 200, b: 10, alpha: 1 } } }).png().toBuffer();
}

function saveImageProvider() {
  return repository.saveProvider({
    name: "test", baseUrl: "https://example.test/v1", encryptedApiKey: "encrypted", reasoningProtocol: "openai",
    models: [{ id: "image", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: "openai_images" }],
  });
}

function multipart(fields: Record<string, string>, file?: { name: string; content: Buffer; type: string }) {
  const boundary = "----ecomgenTestBoundary";
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  if (file) parts.push(Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.content, Buffer.from("\r\n")]));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

async function createDraft(): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/pattern-drafts", payload: { composeType: "PLACEMENT" } });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

function batchBody(providerId: string, overrides: Record<string, unknown> = {}) {
  return { clientKey: "client-1", operation: "GENERATE", candidateCount: 2, providerId, imageModelId: "image", theme: "山茶花", aspectRatio: "1:1", background: "WHITE", ...overrides };
}

describe("pattern draft API", () => {
  it("新建/读取/列表草稿，PATCH 走 revision CAS", async () => {
    const draftId = await createDraft();
    const fetched = await app.inject({ method: "GET", url: `/api/v1/pattern-drafts/${draftId}` });
    expect(fetched.json<{ revision: number; composeType: string }>()).toMatchObject({ revision: 1, composeType: "PLACEMENT" });

    const conflict = await app.inject({ method: "PATCH", url: `/api/v1/pattern-drafts/${draftId}`, payload: { expectedRevision: 5, name: "改名" } });
    expect(conflict.statusCode).toBe(409);

    const updated = await app.inject({ method: "PATCH", url: `/api/v1/pattern-drafts/${draftId}`, payload: { expectedRevision: 1, name: "改名", conditions: { theme: "玫瑰", style: "", retain: "", avoid: "", aspectRatio: "1:1", background: "TRANSPARENT", candidateCount: 1 } } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ revision: number; name: string }>()).toMatchObject({ revision: 2, name: "改名" });

    const list = await app.inject({ method: "GET", url: "/api/v1/pattern-drafts" });
    expect(list.json<{ items: Array<{ id: string }> }>().items.some((item) => item.id === draftId)).toBe(true);
  });

  it("引用正式花型作为参考，删除时未被批次引用则清文件", async () => {
    const draftId = await createDraft();
    const patternId = randomUUID();
    const stored = await storage.putPatternArtifact(patternId, "pattern", await samplePng());
    repository.createPattern({ id: patternId, name: "参考花型", sourceType: "UPLOADED", sourceJobId: null, sourceAssetHash: stored.hash, parentPatternId: null, storagePath: stored.path, fileHash: stored.hash, width: 16, height: 16, tags: [] });

    const created = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/media`, ...multipart({ role: "REFERENCE", source: "PATTERN", patternId }) });
    expect(created.statusCode).toBe(201);
    const media = created.json<{ id: string; source: string }>();
    expect(media).toMatchObject({ source: "PATTERN" });
    const mediaRecord = repository.getDraftMedia(media.id)!;

    const removed = await app.inject({ method: "DELETE", url: `/api/v1/pattern-drafts/${draftId}/media/${media.id}` });
    expect(removed.statusCode).toBe(204);
    expect(repository.getDraftMedia(media.id)).toBeUndefined();
    // 未被任何批次快照引用，物理文件也应一并清掉（只删库行会留下孤儿文件）。
    expect(await storage.exists(mediaRecord.storagePath)).toBe(false);
  });


  it("提交批次：建槽位、入队方向正确、同 key 同 payload 复用、异 payload 冲突", async () => {
    const draftId = await createDraft();
    const provider = saveImageProvider();
    const first = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/batches`, payload: batchBody(provider.id) });
    expect(first.statusCode).toBe(202);
    const firstBody = first.json<{ batch: { id: string; slots: unknown[] }; reused: boolean; job: { id: string } }>();
    expect(firstBody.reused).toBe(false);
    expect(firstBody.batch.slots).toHaveLength(2);
    expect(vi.mocked(enqueue)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueue).mock.calls[0]![1]).toMatchObject({ kind: "pattern_draft_generate", jobId: firstBody.job.id });

    const reused = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/batches`, payload: batchBody(provider.id) });
    expect(reused.statusCode).toBe(202);
    expect(reused.json<{ reused: boolean }>().reused).toBe(true);
    expect(vi.mocked(enqueue)).toHaveBeenCalledTimes(1);

    const conflict = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/batches`, payload: batchBody(provider.id, { theme: "别的主题" }) });
    expect(conflict.statusCode).toBe(409);
  });

  it("失败补偿只重排失败槽位，成功槽位与候选保持不动，重复点击复用同一 retry 任务", async () => {
    const draftId = await createDraft();
    const provider = saveImageProvider();
    const created = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/batches`, payload: batchBody(provider.id) });
    const createdBody = created.json<{ batch: { id: string }; job: { id: string } }>();
    const batchId = createdBody.batch.id;
    // 首次任务已在 Worker 中失败：槽位才能进入 FAILED，这正是失败补偿的起点。
    repository.updateJob(createdBody.job.id, { status: "FAILED", progress: 100, error: { message: "boom" } });
    repository.updateDraftSlot(batchId, 1, { status: "SUCCEEDED" });
    repository.updateDraftSlot(batchId, 2, { status: "FAILED", error: { message: "boom" } });

    const retry = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/batches/${batchId}/retry-failed` });
    expect(retry.statusCode).toBe(202);
    expect(retry.json<{ reused: boolean }>().reused).toBe(false);
    const slots = repository.listDraftSlots(batchId);
    expect(slots.find((slot) => slot.index === 1)).toMatchObject({ status: "SUCCEEDED", attempt: 1 });
    expect(slots.find((slot) => slot.index === 2)).toMatchObject({ status: "QUEUED", attempt: 2 });

    const again = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/batches/${batchId}/retry-failed` });
    expect(again.json<{ reused: boolean }>().reused).toBe(true);
  });

  it("定稿按候选幂等入库为正式花型并保留来源，原稿可下载", async () => {
    const draftId = await createDraft();
    const provider = saveImageProvider();
    const created = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/batches`, payload: batchBody(provider.id, { candidateCount: 1 }) });
    const batchId = created.json<{ batch: { id: string } }>().batch.id;
    const candidateId = randomUUID();
    const stored = await storage.putDraftCandidate(draftId, candidateId, await samplePng());
    repository.createDraftCandidate({ id: candidateId, draftId, batchId, slotIndex: 1, parentCandidateId: null, storagePath: stored.path, fileHash: stored.hash, mimeType: "image/png", width: 16, height: 16, transform: "GENERATE", hasAlpha: true });

    const finalized = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/candidates/${candidateId}/finalize`, payload: { name: "正式花型", clientKey: randomUUID() } });
    expect(finalized.statusCode).toBe(201);
    const pattern = finalized.json<{ pattern: { id: string }; reused: boolean }>();
    expect(pattern.reused).toBe(false);
    expect(repository.getPatternByDraftCandidateId(candidateId)?.id).toBe(pattern.pattern.id);
    // 定稿复制到 patterns/ 命名空间，不引用草稿目录（Windows 上分隔符为反斜杠）
    expect(repository.getPattern(pattern.pattern.id)?.storagePath?.replaceAll("\\", "/")).toContain(`patterns/${pattern.pattern.id}/`);

    const repeat = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/candidates/${candidateId}/finalize`, payload: { name: "正式花型", clientKey: randomUUID() } });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json<{ reused: boolean; pattern: { id: string } }>()).toMatchObject({ reused: true, pattern: { id: pattern.pattern.id } });

    const file = await app.inject({ method: "GET", url: `/api/v1/files/pattern-drafts/${draftId}/candidates/${candidateId}` });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toContain("image/png");
    expect(file.rawPayload.length).toBeGreaterThan(0);
  });

  it("跨草稿访问候选返回 404，通用任务重试拒绝起稿类型", async () => {
    const first = await createDraft();
    const second = await createDraft();
    const provider = saveImageProvider();
    const created = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${first}/batches`, payload: batchBody(provider.id, { candidateCount: 1 }) });
    const batchId = created.json<{ batch: { id: string } }>().batch.id;
    const candidateId = randomUUID();
    const stored = await storage.putDraftCandidate(first, candidateId, await samplePng());
    repository.createDraftCandidate({ id: candidateId, draftId: first, batchId, slotIndex: 1, parentCandidateId: null, storagePath: stored.path, fileHash: stored.hash, mimeType: "image/png", width: 16, height: 16, transform: "GENERATE", hasAlpha: false });

    const cross = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${second}/candidates/${candidateId}/finalize`, payload: { clientKey: randomUUID() } });
    expect(cross.statusCode).toBe(404);

    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: "PATTERN_DRAFT_GENERATE", input: { draftId: first, batchId, slots: [1] }, requestFingerprint: null, providerId: provider.id, modelId: "image" });
    repository.updateJob(job.id, { status: "FAILED", progress: 100, error: { message: "x" } });
    const retry = await app.inject({ method: "POST", url: `/api/v1/jobs/${job.id}/retry` });
    expect(retry.statusCode).toBe(409);
  });
});
