import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "./database.js";
import { EcomRepository } from "./repository.js";

const directories: string[] = [];
const databases: Array<ReturnType<typeof openDatabase>> = [];
function testRepository(): EcomRepository {
  const directory = mkdtempSync(join(tmpdir(), "ecomgen-draft-"));
  directories.push(directory);
  const database = openDatabase(join(directory, "ecomgen.sqlite"));
  databases.push(database);
  return new EcomRepository(database);
}
afterEach(() => {
  // WAL 连接不关闭会在 Windows 上锁住文件，清理临时目录前必须先关闭连接。
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createDraft(repository: EcomRepository) {
  return repository.createPatternDraft({ name: "测试草稿", composeType: "PLACEMENT", conditions: { theme: "", aspectRatio: "1:1", background: "WHITE", candidateCount: 1 } });
}

describe("创作草稿聚合", () => {
  it("PATCH 走 revision CAS：旧版本冲突且不改写，正确版本递增", () => {
    const repository = testRepository();
    const draft = createDraft(repository);

    const conflict = repository.updatePatternDraft(draft.id, { name: "新名字" }, draft.revision + 1);
    expect(conflict.status).toBe("conflict");
    expect(repository.getPatternDraft(draft.id)?.name).toBe("测试草稿");

    const updated = repository.updatePatternDraft(draft.id, { name: "新名字" }, draft.revision);
    expect(updated.status).toBe("updated");
    if (updated.status === "updated") expect(updated.draft.revision).toBe(draft.revision + 1);
    expect(repository.getPatternDraft(draft.id)?.name).toBe("新名字");
  });

  it("失败补偿只把失败槽位挂到新 attempt，已成功槽位保持不动", () => {
    const repository = testRepository();
    const draft = createDraft(repository);
    const { batch } = repository.createDraftBatch({ draftId: draft.id, operation: "GENERATE", parentCandidateId: null, providerId: null, imageModelId: null, candidateCount: 3, instruction: null, snapshot: {}, clientKey: "k1" });
    const slots = repository.listDraftSlots(batch.id);
    expect(slots.map((slot) => slot.index)).toEqual([1, 2, 3]);

    // 首次提交：attempt 不递增
    repository.assignDraftSlotsToJob(batch.id, [1, 2, 3], "job-initial", false);
    expect(repository.listDraftSlots(batch.id).every((slot) => slot.attempt === 1 && slot.status === "QUEUED")).toBe(true);

    repository.updateDraftSlot(batch.id, 1, { status: "SUCCEEDED" });
    repository.updateDraftSlot(batch.id, 3, { status: "FAILED", error: { message: "boom" } });

    repository.assignDraftSlotsToJob(batch.id, [3], "job-retry", true);
    const after = repository.listDraftSlots(batch.id);
    expect(after.find((slot) => slot.index === 1)).toMatchObject({ status: "SUCCEEDED", attempt: 1 });
    expect(after.find((slot) => slot.index === 2)).toMatchObject({ status: "QUEUED", attempt: 1 });
    expect(after.find((slot) => slot.index === 3)).toMatchObject({ status: "QUEUED", attempt: 2, jobId: "job-retry" });
  });

  it("同一槽位落候选幂等：重复写入返回同一份，不产生第二张", () => {
    const repository = testRepository();
    const draft = createDraft(repository);
    const { batch } = repository.createDraftBatch({ draftId: draft.id, operation: "GENERATE", parentCandidateId: null, providerId: null, imageModelId: null, candidateCount: 1, instruction: null, snapshot: {}, clientKey: "k2" });
    const input = { draftId: draft.id, batchId: batch.id, slotIndex: 1, parentCandidateId: null, storagePath: "drafts/x/candidates/a.png", fileHash: "hash-a", mimeType: "image/png", width: 8, height: 8, transform: "GENERATE" as const, hasAlpha: true };
    const first = repository.createDraftCandidate(input);
    const second = repository.createDraftCandidate({ ...input, storagePath: "drafts/x/candidates/b.png", fileHash: "hash-b" });
    expect(second.id).toBe(first.id);
    expect(repository.listDraftCandidates(draft.id)).toHaveLength(1);
    expect(repository.listDraftCandidateSlotIndices(batch.id)).toEqual([1]);
  });

  it("定稿按来源候选幂等：重复定稿返回同一 Pattern，另一候选产生新 Pattern", () => {
    const repository = testRepository();
    const base = { name: "p", sourceType: "GENERATED" as const, sourceJobId: null, sourceAssetHash: null, parentPatternId: null, storagePath: "patterns/a.png", fileHash: "h", width: 8, height: 8, tags: [] };
    const first = repository.createPattern({ ...base, sourceDraftCandidateId: "candidate-1" });
    const again = repository.createPattern({ ...base, sourceDraftCandidateId: "candidate-1" });
    const other = repository.createPattern({ ...base, sourceDraftCandidateId: "candidate-2" });
    expect(again.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
    expect(repository.getPatternByDraftCandidateId("candidate-1")?.id).toBe(first.id);
  });

  it("删除草稿级联清空草稿域数据，不触碰正式花型", () => {
    const repository = testRepository();
    const draft = createDraft(repository);
    const { batch } = repository.createDraftBatch({ draftId: draft.id, operation: "GENERATE", parentCandidateId: null, providerId: null, imageModelId: null, candidateCount: 1, instruction: null, snapshot: {}, clientKey: "k3" });
    repository.createDraftCandidate({ draftId: draft.id, batchId: batch.id, slotIndex: 1, parentCandidateId: null, storagePath: "drafts/x/candidates/a.png", fileHash: "h", mimeType: "image/png", width: 4, height: 4, transform: "GENERATE", hasAlpha: false });
    const pattern = repository.createPattern({ name: "正式", sourceType: "GENERATED", sourceJobId: null, sourceAssetHash: null, parentPatternId: null, storagePath: "patterns/a.png", fileHash: "h2", width: 4, height: 4, tags: [], sourceDraftCandidateId: "candidate-keep" });

    expect(repository.deletePatternDraft(draft.id)).toBe(true);
    expect(repository.getPatternDraft(draft.id)).toBeUndefined();
    expect(repository.listDraftSlots(batch.id)).toHaveLength(0);
    expect(repository.getPattern(pattern.id)).toBeDefined();
  });
});
