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
import { MAX_DRAFT_MEDIA_NOTES_LENGTH } from "@ecomgen/contracts";
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


  it("参考图备注可改，超过上限被拒", async () => {
    const draftId = await createDraft();
    const created = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/media`, ...multipart({ role: "REFERENCE", notes: "这条会成为提示词里的说明" }, { name: "ref.png", content: await samplePng(), type: "image/png" }) });
    expect(created.statusCode).toBe(201);
    const mediaId = created.json<{ id: string; notes: string }>().id;
    expect(created.json<{ notes: string }>().notes).toBe("这条会成为提示词里的说明");

    // 备注逐条进提示词，长度必须像改稿指令一样有界。
    const tooLong = await app.inject({ method: "PATCH", url: `/api/v1/pattern-drafts/${draftId}/media/${mediaId}`, payload: { notes: "字".repeat(MAX_DRAFT_MEDIA_NOTES_LENGTH + 1) } });
    expect(tooLong.statusCode).toBe(400);

    const updated = await app.inject({ method: "PATCH", url: `/api/v1/pattern-drafts/${draftId}/media/${mediaId}`, payload: { notes: "改过的备注" } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ notes: string }>().notes).toBe("改过的备注");
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

describe("参考图下发", () => {
  /** 上传一张参考图并返回它的引用编号。 */
  async function uploadReference(draftId: string): Promise<number> {
    const response = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/media`, ...multipart({ role: "REFERENCE", source: "UPLOAD" }, { name: "ref.png", content: await samplePng(), type: "image/png" }) });
    expect(response.statusCode).toBe(201);
    return response.json<{ ordinal: number }>().ordinal;
  }

  /** 备一个父候选，改稿操作需要一个被改的对象。 */
  async function seedCandidate(draftId: string, providerId: string): Promise<string> {
    const created = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/batches`, payload: batchBody(providerId, { candidateCount: 1 }) });
    const batchId = created.json<{ batch: { id: string } }>().batch.id;
    const candidateId = randomUUID();
    const stored = await storage.putDraftCandidate(draftId, candidateId, await samplePng());
    repository.createDraftCandidate({ id: candidateId, draftId, batchId, slotIndex: 1, parentCandidateId: null, storagePath: stored.path, fileHash: stored.hash, mimeType: "image/png", width: 16, height: 16, transform: "GENERATE", hasAlpha: false });
    return candidateId;
  }

  function snapshotOf(batchId: string): { references?: Array<{ ordinal: number }> } {
    return repository.getDraftBatch(batchId)!.snapshot as { references?: Array<{ ordinal: number }> };
  }

  it("起稿下发全部参考图；改稿只下发说明里 @ 到的那一张", async () => {
    const draftId = await createDraft();
    const provider = saveImageProvider();
    const first = await uploadReference(draftId);
    const second = await uploadReference(draftId);

    const generated = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/batches`, payload: batchBody(provider.id, { candidateCount: 1 }) });
    expect(snapshotOf(generated.json<{ batch: { id: string } }>().batch.id).references?.map((row) => row.ordinal)).toEqual([first, second]);

    const candidateId = await seedCandidate(draftId, provider.id);
    const cited = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/candidates/${candidateId}/edits`, payload: { clientKey: "edit-cited", operation: "EDIT", candidateCount: 1, providerId: provider.id, imageModelId: "image", instruction: `照 @图${second} 的配色调暖一点` } });
    expect(cited.statusCode).toBe(202);
    expect(snapshotOf(cited.json<{ batch: { id: string } }>().batch.id).references?.map((row) => row.ordinal)).toEqual([second]);

    const uncited = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/candidates/${candidateId}/edits`, payload: { clientKey: "edit-uncited", operation: "EDIT", candidateCount: 1, providerId: provider.id, imageModelId: "image", instruction: "整体调暖一点" } });
    expect(uncited.statusCode).toBe(202);
    expect(snapshotOf(uncited.json<{ batch: { id: string } }>().batch.id).references).toEqual([]);
  });

  it("改稿拒绝引用不存在的编号；接缝改稿不接受任何 @图N", async () => {
    const draftId = await createDraft();
    const provider = saveImageProvider();
    await uploadReference(draftId);
    const candidateId = await seedCandidate(draftId, provider.id);
    const editUrl = `/api/v1/pattern-drafts/${draftId}/candidates/${candidateId}/edits`;
    const base = { candidateCount: 1, providerId: provider.id, imageModelId: "image" };

    // 接缝改稿的下发集是空集，写了引用必然落到"编号不存在"上；这里确认它确实被拒。
    const seam = await app.inject({ method: "POST", url: editUrl, payload: { ...base, clientKey: "s", operation: "SEAM_EDIT", seam: { edge: "LEFT_RIGHT", band: 48 }, instruction: "参考 @图1" } });
    expect(seam.statusCode).toBe(400);

    // 编号不存在：提示要指名道姓说是哪个编号，用户才改得对。
    const missing = await app.inject({ method: "POST", url: editUrl, payload: { ...base, clientKey: "m", operation: "EDIT", instruction: "照 @图9 调暖" } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<{ error: { message: string } }>().error.message).toContain("@图9");
  });

  it("改稿的笔迹只在是笔迹媒体时才收，候选数按操作生效", async () => {
    const draftId = await createDraft();
    const provider = saveImageProvider();
    await uploadReference(draftId);
    const candidateId = await seedCandidate(draftId, provider.id);
    const editUrl = `/api/v1/pattern-drafts/${draftId}/candidates/${candidateId}/edits`;
    const base = { providerId: provider.id, imageModelId: "image", instruction: "把这朵花改成粉色" };
    const upload = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/media`, ...multipart({ role: "ANNOTATION", source: "UPLOAD" }, { name: "marks.png", content: await samplePng(), type: "image/png" }) });
    expect(upload.statusCode, upload.body).toBe(201);
    const annotationMediaId = upload.json<{ id: string }>().id;

    // 参考图不能当笔迹用：两者坐标语义不同，认错了只会把一张素材当标注叠上去。
    const reference = repository.listDraftMedia(draftId).find((item) => item.role === "REFERENCE")!;
    const wrongKind = await app.inject({ method: "POST", url: editUrl, payload: { ...base, clientKey: "x", operation: "EDIT", candidateCount: 1, annotationMediaId: reference.id } });
    expect(wrongKind.statusCode).toBe(400);

    // 只有改稿读笔迹；其他操作带着它只会静默无效，快照里还会留一份误导性记录。
    const misplaced = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/batches`, payload: { ...batchBody(provider.id, { clientKey: "g" }), annotationMediaId } });
    expect(misplaced.statusCode).toBe(400);

    const marked = await app.inject({ method: "POST", url: editUrl, payload: { ...base, clientKey: "l", operation: "EDIT", candidateCount: 3, annotationMediaId } });
    expect(marked.statusCode, marked.body).toBe(202);
    const markedBatch = marked.json<{ batch: { id: string } }>().batch.id;
    expect(repository.listDraftSlots(markedBatch)).toHaveLength(3);
    expect(snapshotOf(markedBatch)).toMatchObject({ annotation: { mediaId: annotationMediaId } });

    // 确定性处理出 N 张等于同一张，不产生无谓的付费调用。
    const recolor = await app.inject({ method: "POST", url: editUrl, payload: { ...base, clientKey: "r", operation: "RECOLOR", candidateCount: 3, instruction: undefined, recolor: { hueShift: 10, saturationPct: 100, brightnessPct: 100 } } });
    expect(recolor.statusCode).toBe(202);
    expect(repository.listDraftSlots(recolor.json<{ batch: { id: string } }>().batch.id)).toHaveLength(1);
  });

  it("不画笔迹的改稿就是整图改稿，快照里不带笔迹", async () => {
    const draftId = await createDraft();
    const provider = saveImageProvider();
    const candidateId = await seedCandidate(draftId, provider.id);
    const response = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/candidates/${candidateId}/edits`, payload: { clientKey: "whole", operation: "EDIT", candidateCount: 2, providerId: provider.id, imageModelId: "image", instruction: "整体调暖一点" } });
    expect(response.statusCode, response.body).toBe(202);
    const batchId = response.json<{ batch: { id: string } }>().batch.id;
    expect(repository.listDraftSlots(batchId)).toHaveLength(2);
    expect(snapshotOf(batchId)).toMatchObject({ annotation: null });
  });

  /*
   * 说明里的色值不再有"写坏了"这一档：色值就是 `#d9a441` 这样的文本本身，凑不满 3/4/6/8 位
   * 十六进制就压根不是 token（也就没有中间状态可拒绝），原来的 400 校验随之取消。
   * 这条钉住"带色值的说明照常受理"，免得哪天又把校验加回来拦掉合法颜色。
   */
  it("说明里的色值照常受理", async () => {
    const draftId = await createDraft();
    const provider = saveImageProvider();
    const candidateId = await seedCandidate(draftId, provider.id);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/pattern-drafts/${draftId}/candidates/${candidateId}/edits`,
      payload: { candidateCount: 1, providerId: provider.id, imageModelId: "image", clientKey: "palette", operation: "EDIT", instruction: "把叶子换成 #c94f4f，花心 #d9a441" },
    });
    expect(response.statusCode, response.body).toBe(202);
  });

  /*
   * 笔迹在界面上看不到也删不掉，额度就必须自己回收，否则用户改到第 N 次会撞上一句"最多保留 N 张"
   * 却没有任何办法腾位置。回收的判据是"还有没有任务会读它"，所以两边都要钉住：
   * 批次还能补偿时必须留着（删了那次补偿会读不到文件），批次全部成功之后必须收掉。
   */
  it("改稿笔迹用完即收：批次还能跑就留着，批次全部成功后随下一次上传清掉", async () => {
    const draftId = await createDraft();
    const provider = saveImageProvider();
    const candidateId = await seedCandidate(draftId, provider.id);
    const uploadMarks = async (): Promise<string> => {
      const response = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/media`, ...multipart({ role: "ANNOTATION", source: "UPLOAD" }, { name: "marks.png", content: await samplePng(), type: "image/png" }) });
      expect(response.statusCode, response.body).toBe(201);
      return response.json<{ id: string }>().id;
    };
    const annotations = () => repository.listDraftMedia(draftId).filter((media) => media.role === "ANNOTATION");

    const inFlight = await uploadMarks();
    const marked = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/candidates/${candidateId}/edits`, payload: { clientKey: "a", operation: "EDIT", candidateCount: 1, providerId: provider.id, imageModelId: "image", instruction: "把这朵花改成粉色", annotationMediaId: inFlight } });
    expect(marked.statusCode, marked.body).toBe(202);
    const batchId = marked.json<{ batch: { id: string } }>().batch.id;

    // 槽位还在队列里，Worker 随时要读这张笔迹：下一次上传不能把它收走。
    await uploadMarks();
    expect(annotations().map((media) => media.id)).toContain(inFlight);

    // 本批全部成功后补偿已无从触发（补偿只领失败槽位），这张笔迹不会再被读到，下次上传顺手清掉；
    // 上一次那张没被任何批次引用的上传同理，一起收走。
    for (const slot of repository.listDraftSlots(batchId)) repository.updateDraftSlot(batchId, slot.index, { status: "SUCCEEDED" });
    await uploadMarks();
    expect(annotations().map((media) => media.id)).not.toContain(inFlight);
    expect(annotations()).toHaveLength(1);
  });

  it("参考图与改稿笔迹各按自己的额度计数，互不挤占", async () => {
    const draftId = await createDraft();
    for (let index = 0; index < 6; index += 1) await uploadReference(draftId);

    const overflow = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/media`, ...multipart({ role: "REFERENCE", source: "UPLOAD" }, { name: "extra.png", content: await samplePng(), type: "image/png" }) });
    expect(overflow.statusCode).toBe(400);

    // 参考图额度用满不影响笔迹：否则改稿改多了就再也传不进参考图。
    const marks = await app.inject({ method: "POST", url: `/api/v1/pattern-drafts/${draftId}/media`, ...multipart({ role: "ANNOTATION", source: "UPLOAD" }, { name: "marks.png", content: await samplePng(), type: "image/png" }) });
    expect(marks.statusCode, marks.body).toBe(201);
  });
});
