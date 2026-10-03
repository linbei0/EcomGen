import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { EcomRepository, LocalAssetStore, openDatabase, type JobRecord } from "@ecomgen/core";
import type { WorkerContext } from "./context.js";
import { executeDraftProcess } from "./job-pattern-drafts.js";

const directories: string[] = [];
const databases: Array<ReturnType<typeof openDatabase>> = [];

async function harness() {
  const directory = mkdtempSync(join(tmpdir(), "ecomgen-draft-worker-"));
  directories.push(directory);
  const database = openDatabase(join(directory, "ecomgen.sqlite"));
  databases.push(database);
  const repository = new EcomRepository(database);
  const storage = new LocalAssetStore(directory);
  await storage.initialize();
  // executeDraftProcess 只依赖这四个能力，其余上下文（Provider/事件）在本用例不参与。
  const ctx = {
    repository,
    storage,
    updateJob: async (job: JobRecord, patch: Parameters<EcomRepository["updateJob"]>[1]) => { repository.updateJob(job.id, patch); },
    throwIfCancelled: () => undefined,
  } as unknown as WorkerContext;
  return { repository, storage, ctx };
}

async function samplePng(): Promise<Buffer> {
  return sharp({ create: { width: 24, height: 24, channels: 4, background: { r: 120, g: 40, b: 200, alpha: 1 } } }).png().toBuffer();
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("executeDraftProcess", () => {
  it("本地调色由父候选产生新候选并保留父谱系", async () => {
    const { repository, storage, ctx } = await harness();
    const draft = repository.createPatternDraft({ name: "草稿", composeType: "PLACEMENT", conditions: {} });
    // 父候选属于此前的一次生成批次；调色批次有自己的槽位 1，不会被父候选占用。
    const { batch: sourceBatch } = repository.createDraftBatch({ draftId: draft.id, operation: "GENERATE", parentCandidateId: null, providerId: null, imageModelId: null, candidateCount: 1, instruction: null, snapshot: {}, clientKey: "src" });
    const stored = await storage.putDraftCandidate(draft.id, "parent", await samplePng());
    repository.createDraftCandidate({ id: "parent", draftId: draft.id, batchId: sourceBatch.id, slotIndex: 1, parentCandidateId: null, storagePath: stored.path, fileHash: stored.hash, mimeType: "image/png", width: 24, height: 24, transform: "GENERATE", hasAlpha: false });
    const { batch } = repository.createDraftBatch({ draftId: draft.id, operation: "RECOLOR", parentCandidateId: "parent", providerId: null, imageModelId: null, candidateCount: 1, instruction: null, snapshot: { parentCandidateId: "parent", recolor: { hueShift: 90, saturationPct: 120, brightnessPct: 100 } }, clientKey: "k" });
    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: "PATTERN_DRAFT_PROCESS", input: { draftId: draft.id, batchId: batch.id, slots: [1], task: "BATCH" }, requestFingerprint: null, providerId: null, modelId: null });

    await executeDraftProcess(ctx, job);

    expect(repository.listDraftSlots(batch.id)[0]).toMatchObject({ status: "SUCCEEDED" });
    const candidates = repository.listDraftCandidates(draft.id);
    expect(candidates).toHaveLength(2);
    const recolored = candidates.find((candidate) => candidate.transform === "RECOLOR")!;
    expect(recolored.parentCandidateId).toBe("parent");
    expect(recolored.storagePath).not.toBe(stored.path);
  });

  it("验缝任务只写判定与逐轴证据，不动候选像素", async () => {
    const { repository, storage, ctx } = await harness();
    const draft = repository.createPatternDraft({ name: "草稿", composeType: "REPEAT", conditions: {} });
    const { batch } = repository.createDraftBatch({ draftId: draft.id, operation: "GENERATE", parentCandidateId: null, providerId: null, imageModelId: null, candidateCount: 1, instruction: null, snapshot: {}, clientKey: "k2" });
    const candidateId = randomUUID();
    const stored = await storage.putDraftCandidate(draft.id, candidateId, await samplePng());
    repository.createDraftCandidate({ id: candidateId, draftId: draft.id, batchId: batch.id, slotIndex: 1, parentCandidateId: null, storagePath: stored.path, fileHash: stored.hash, mimeType: "image/png", width: 24, height: 24, transform: "GENERATE", hasAlpha: false });
    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: "PATTERN_DRAFT_PROCESS", input: { draftId: draft.id, candidateId, task: "TILE_CHECK" }, requestFingerprint: null, providerId: null, modelId: null });

    await executeDraftProcess(ctx, job);

    const checked = repository.getDraftCandidate(candidateId)!;
    expect(checked.tileable).toBe("VERIFIED");
    expect(checked.tileableScore).not.toBeNull();
    expect(checked.tileableHorizontal).not.toBeNull();
    expect(checked.tileableVertical).not.toBeNull();
    // 判定不改像素：文件哈希与存储路径保持不变
    expect(checked.fileHash).toBe(stored.hash);
  });
});
