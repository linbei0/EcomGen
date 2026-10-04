import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { EcomRepository, LocalAssetStore, openDatabase, type JobRecord } from "@ecomgen/core";
import type { WorkerContext } from "./context.js";
import { executeDraftEdit, executeDraftProcess } from "./job-pattern-drafts.js";

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

/**
 * 带假生成器的上下文：改稿走真实的源图装配链路，只把付费调用换掉。
 *
 * 同时记下每次调用的参数——"下发的源图长什么样"与"到底有没有给 Provider 带上 mask"
 * 都是这一层的契约，只看落盘结果就只能靠间接推断。
 */
function withGenerator(ctx: WorkerContext, generated: Buffer, modelId = "gpt-image-1.5") {
  const calls: Array<{ prompt: string; hasMask: boolean; source: Buffer }> = [];
  const model = { id: modelId, imageApiKind: "openai_images" as const };
  const wrapped = {
    ...ctx,
    imageModelForJob: () => ({ provider: { id: "provider" }, model }),
    imageGeneratorFor: () => ({
      editImage: async (request: { prompt: string; mask?: unknown; sourceImage: { data: Buffer } }) => {
        calls.push({ prompt: request.prompt, hasMask: request.mask !== undefined, source: request.sourceImage.data });
        return { image: generated, mimeType: "image/png" };
      },
    }),
  } as unknown as WorkerContext;
  return { ctx: wrapped, calls };
}

async function samplePng(): Promise<Buffer> {
  return sharp({ create: { width: 24, height: 24, channels: 4, background: { r: 120, g: 40, b: 200, alpha: 1 } } }).png().toBuffer();
}

/** 纯色方图，便于逐像素断言"选区外没有被改动"。 */
async function solidPng(size: number, color: [number, number, number, number]): Promise<Buffer> {
  const data = Buffer.alloc(size * size * 4);
  for (let index = 0; index < size * size; index += 1) {
    const at = index * 4;
    data[at] = color[0]; data[at + 1] = color[1]; data[at + 2] = color[2]; data[at + 3] = color[3];
  }
  return sharp(data, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

/** 居中的正方形笔迹：画到的像素有颜色，其余透明——与画布导出的一层笔迹同形。 */
async function squareAnnotation(size: number, inset: number, color: [number, number, number, number]): Promise<Buffer> {
  const data = Buffer.alloc(size * size * 4);
  for (let y = inset; y < size - inset; y += 1) for (let x = inset; x < size - inset; x += 1) {
    const at = (y * size + x) * 4;
    data[at] = color[0]; data[at + 1] = color[1]; data[at + 2] = color[2]; data[at + 3] = color[3];
  }
  return sharp(data, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

async function pixelAt(png: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * 4;
  return [data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]!];
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

describe("executeDraftEdit 改稿", () => {
  const SIZE = 64;
  const INSET = 16;
  const INSTRUCTION = "把这块改成蓝色";

  /**
   * 备好父候选与 EDIT 批次，返回可直接跑的任务。
   *
   * `annotationPng` 为 null 就是"不画笔迹"——那正是"整图改稿"：同一个操作、同一条链路，
   * 区别只在有没有笔迹，所以两者共用这一个装配函数。
   */
  async function prepareEdit(ctx: WorkerContext, draft: ReturnType<EcomRepository["createPatternDraft"]>, parent: Buffer, annotationPng: Buffer | null) {
    const { repository, storage } = ctx;
    const { batch: sourceBatch } = repository.createDraftBatch({ draftId: draft.id, operation: "GENERATE", parentCandidateId: null, providerId: null, imageModelId: null, candidateCount: 1, instruction: null, snapshot: {}, clientKey: "src" });
    const parentStored = await storage.putDraftCandidate(draft.id, "parent", parent);
    repository.createDraftCandidate({ id: "parent", draftId: draft.id, batchId: sourceBatch.id, slotIndex: 1, parentCandidateId: null, storagePath: parentStored.path, fileHash: parentStored.hash, mimeType: "image/png", width: SIZE, height: SIZE, transform: "GENERATE", hasAlpha: false });
    const snapshot: Record<string, unknown> = { parentCandidateId: "parent", instruction: INSTRUCTION, background: "WHITE" };
    if (annotationPng) {
      const marksStored = await storage.putDraftMedia(draft.id, "ANNOTATION", "marks.png", annotationPng);
      snapshot.annotation = { storagePath: marksStored.path, mimeType: "image/png" };
    }
    const { batch } = repository.createDraftBatch({
      draftId: draft.id, operation: "EDIT", parentCandidateId: "parent", providerId: null, imageModelId: "gpt-image-1.5", candidateCount: 1, instruction: INSTRUCTION,
      snapshot, clientKey: randomUUID(),
    });
    const job = repository.createJob({ id: randomUUID(), projectId: null, storyboardItemId: null, type: "PATTERN_DRAFT_EDIT", input: { draftId: draft.id, batchId: batch.id, slots: [1], task: "BATCH" }, requestFingerprint: null, providerId: null, modelId: "gpt-image-1.5" });
    return { batch, job };
  }

  it("带笔迹：下发的源图是父候选叠上笔迹，笔迹外仍是父候选，且不下发 mask", async () => {
    const { repository, storage, ctx } = await harness();
    const draft = repository.createPatternDraft({ name: "草稿", composeType: "PLACEMENT", conditions: {} });
    const { batch, job } = await prepareEdit(ctx, draft, await solidPng(SIZE, [255, 0, 0, 255]), await squareAnnotation(SIZE, INSET, [0, 200, 0, 255]));
    const { ctx: withGen, calls } = withGenerator(ctx, await solidPng(SIZE, [0, 0, 255, 255]));

    await executeDraftEdit(withGen, job, new AbortController().signal);

    expect(repository.listDraftSlots(batch.id)[0]).toMatchObject({ status: "SUCCEEDED" });
    const child = repository.listDraftCandidates(draft.id).find((candidate) => candidate.transform === "EDIT")!;
    expect(child.parentCandidateId).toBe("parent");
    // 笔迹叠在源图上：画到的像素按标注，没画到的仍是父候选——模型看到的就是这一张图。
    expect(calls).toHaveLength(1);
    expect(await pixelAt(calls[0]!.source, SIZE / 2, SIZE / 2)).toEqual([0, 200, 0, 255]);
    expect(await pixelAt(calls[0]!.source, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(await pixelAt(calls[0]!.source, INSET - 1, SIZE / 2)).toEqual([255, 0, 0, 255]);
    // 笔迹是"改这里"的标注，不是给 Provider 的蒙版通道：位置由像素本身表达，不靠第二个输入。
    expect(calls[0]!.hasMask).toBe(false);
    // 提示词必须交代"笔迹要抹掉"：worker 的职责是把 annotated=true 传进编译器，
    // 措辞本身由 ecom-skill 的测试逐字钉住，这里不重复。
    expect(calls[0]!.prompt).toContain("annotations, not artwork");
    // 落盘的是模型输出本身：没有蒙版就没有选区合成这一步。
    expect(await pixelAt(await storage.read(child.storagePath), 0, 0)).toEqual([0, 0, 255, 255]);
  });

  it("REPEAT 草稿：改稿落候选后自动写入验缝结论，不留未检测", async () => {
    const { repository, storage, ctx } = await harness();
    const draft = repository.createPatternDraft({ name: "草稿", composeType: "REPEAT", conditions: {} });
    const { batch, job } = await prepareEdit(ctx, draft, await solidPng(SIZE, [255, 0, 0, 255]), await squareAnnotation(SIZE, INSET, [0, 200, 0, 255]));

    await executeDraftEdit(withGenerator(ctx, await solidPng(SIZE, [0, 0, 255, 255])).ctx, job, new AbortController().signal);

    expect(repository.listDraftSlots(batch.id)[0]).toMatchObject({ status: "SUCCEEDED" });
    const child = repository.listDraftCandidates(draft.id).find((candidate) => candidate.transform === "EDIT")!;
    // 纯色图必然可平铺；分数非空即证明判定确实跑过，而不是停在"未检测"。
    expect(child.tileable).toBe("VERIFIED");
    expect(child.tileableScore).not.toBeNull();
    expect(await storage.exists(child.storagePath)).toBe(true);
  });

  it("不画笔迹：不下发 mask、不做合成，结果就是模型输出；范围句也换成整图那一句", async () => {
    const { repository, storage, ctx } = await harness();
    const draft = repository.createPatternDraft({ name: "草稿", composeType: "PLACEMENT", conditions: {} });
    const { batch, job } = await prepareEdit(ctx, draft, await solidPng(SIZE, [255, 0, 0, 255]), null);
    const { ctx: withGen, calls } = withGenerator(ctx, await solidPng(SIZE, [0, 0, 255, 255]));

    await executeDraftEdit(withGen, job, new AbortController().signal);

    expect(repository.listDraftSlots(batch.id)[0]).toMatchObject({ status: "SUCCEEDED" });
    const child = repository.listDraftCandidates(draft.id).find((candidate) => candidate.transform === "EDIT")!;
    const stored = await storage.read(child.storagePath);
    // 没有笔迹就没有合成步骤：连角落都是新色，而带笔迹时源图上那个角落仍是父候选。
    expect(await pixelAt(stored, 0, 0)).toEqual([0, 0, 255, 255]);
    // 给 Provider 的请求里不能出现 mask，否则等同于把"不画笔迹"又当成了一次全选。
    expect(calls).toHaveLength(1);
    expect(calls[0]!.hasMask).toBe(false);
    expect(await pixelAt(calls[0]!.source, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(calls[0]!.prompt).toContain("Change only what the instruction asks for");
    expect(calls[0]!.prompt).not.toContain("annotations");
  });
});
