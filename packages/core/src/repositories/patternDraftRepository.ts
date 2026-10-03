import { randomUUID } from "node:crypto";
import type { DraftBatchOperation, DraftComposeType, DraftMediaRole, DraftMediaSource, DraftSlotStatus, TileableStatus } from "@ecomgen/contracts";
import type { SqliteDatabase } from "../database.js";
import { type Row, json, now, parse } from "./internal.js";

/**
 * 创作草稿聚合：草稿、参考/蒙版媒体、批次、槽位与候选。
 *
 * 与正式 patterns 分离是有意的边界：候选只是探索结果，只有 API 的显式定稿才写 patterns。
 * 批次把「提交时的完整输入」存成不可变快照；槽位序号稳定，失败补偿只重跑失败槽位，
 * 已成功槽位不会被新 attempt 清掉。候选像素不可变，任何改稿都产生新候选并保留父候选。
 */
export interface PatternDraftRecord {
  id: string;
  name: string;
  composeType: DraftComposeType;
  conditions: Record<string, unknown>;
  revision: number;
  selectedCandidateId: string | null;
  compareCandidateId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DraftMediaRecord {
  id: string;
  draftId: string;
  role: DraftMediaRole;
  source: DraftMediaSource;
  sourcePatternId: string | null;
  storagePath: string;
  fileHash: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  originalName: string;
  notes: string | null;
  /** 参考图的引用编号（界面上的「图N」）；蒙版为 null。 */
  ordinal: number | null;
  createdAt: string;
}

export interface DraftBatchRecord {
  id: string;
  draftId: string;
  operation: DraftBatchOperation;
  parentCandidateId: string | null;
  providerId: string | null;
  imageModelId: string | null;
  candidateCount: number;
  instruction: string | null;
  snapshot: Record<string, unknown>;
  clientKey: string;
  createdAt: string;
}

export interface DraftSlotRecord {
  batchId: string;
  index: number;
  status: DraftSlotStatus;
  attempt: number;
  jobId: string | null;
  error: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface DraftCandidateRecord {
  id: string;
  draftId: string;
  batchId: string;
  slotIndex: number;
  parentCandidateId: string | null;
  storagePath: string;
  fileHash: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  transform: DraftBatchOperation;
  hasAlpha: boolean;
  tileable: TileableStatus;
  tileableScore: number | null;
  tileableCheckedWith: string | null;
  /** 逐轴验缝得分（水平/垂直），供界面指出具体是哪条边接不上；未检测为 null。 */
  tileableHorizontal: number | null;
  tileableVertical: number | null;
  createdAt: string;
}

export type UpdateDraftResult =
  | { status: "updated"; draft: PatternDraftRecord }
  | { status: "conflict"; draft: PatternDraftRecord }
  | { status: "missing" };

export class PatternDraftRepository {
  public constructor(private readonly db: SqliteDatabase) { }

  // ---- drafts ----

  public listDrafts(includeArchived = false): PatternDraftRecord[] {
    const sql = includeArchived
      ? "SELECT * FROM pattern_drafts ORDER BY updated_at DESC, id DESC"
      : "SELECT * FROM pattern_drafts WHERE archived_at IS NULL ORDER BY updated_at DESC, id DESC";
    return (this.db.prepare(sql).all() as Row[]).map(mapDraft);
  }

  public getDraft(id: string): PatternDraftRecord | undefined {
    const row = this.db.prepare("SELECT * FROM pattern_drafts WHERE id=?").get(id);
    return row ? mapDraft(row as Row) : undefined;
  }

  public createDraft(input: { name: string; composeType: DraftComposeType; conditions: Record<string, unknown> }): PatternDraftRecord {
    const record: PatternDraftRecord = {
      id: randomUUID(),
      name: input.name,
      composeType: input.composeType,
      conditions: input.conditions,
      revision: 1,
      selectedCandidateId: null,
      compareCandidateId: null,
      archivedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.db.prepare(`INSERT INTO pattern_drafts (id,name,compose_type,conditions_json,revision,selected_candidate_id,compare_candidate_id,archived_at,created_at,updated_at)
      VALUES (@id,@name,@composeType,@conditions,@revision,@selectedCandidateId,@compareCandidateId,@archivedAt,@createdAt,@updatedAt)`)
      .run({ ...record, conditions: json(record.conditions) });
    return record;
  }

  /**
   * 自动保存走 revision CAS：只有期望版本与服务端一致才写入并 +1，否则返回服务端版本。
   * 迟到的保存响应不能覆盖新选择，因此冲突时调用方必须基于返回的 draft 重新合并。
   */
  public updateDraft(id: string, patch: Partial<Pick<PatternDraftRecord, "name" | "conditions" | "selectedCandidateId" | "compareCandidateId" | "archivedAt">>, expectedRevision: number): UpdateDraftResult {
    const update = this.db.transaction((): UpdateDraftResult => {
      const current = this.getDraft(id);
      if (!current) return { status: "missing" };
      if (current.revision !== expectedRevision) return { status: "conflict", draft: current };
      const record: PatternDraftRecord = { ...current, ...patch, revision: current.revision + 1, updatedAt: now() };
      this.db.prepare("UPDATE pattern_drafts SET name=@name,conditions_json=@conditions,revision=@revision,selected_candidate_id=@selectedCandidateId,compare_candidate_id=@compareCandidateId,archived_at=@archivedAt,updated_at=@updatedAt WHERE id=@id")
        .run({ ...record, conditions: json(record.conditions) });
      return { status: "updated", draft: record };
    });
    return update();
  }

  /** 无 revision 影响的内部更新：定稿回写选中关系等由服务端决定的状态。 */
  public setDraftSelectedCandidate(id: string, selectedCandidateId: string | null): PatternDraftRecord | undefined {
    const current = this.getDraft(id);
    if (!current) return undefined;
    const updatedAt = now();
    this.db.prepare("UPDATE pattern_drafts SET selected_candidate_id=?,updated_at=? WHERE id=?").run(selectedCandidateId, updatedAt, id);
    return { ...current, selectedCandidateId, updatedAt };
  }

  public deleteDraft(id: string): boolean {
    return this.db.prepare("DELETE FROM pattern_drafts WHERE id=?").run(id).changes > 0;
  }

  // ---- media ----

  public listMedia(draftId: string): DraftMediaRecord[] {
    // 参考图按编号升序（编号即创建顺序）；蒙版没有编号，排在参考之后。
    return (this.db.prepare("SELECT * FROM draft_media WHERE draft_id=? ORDER BY ordinal IS NULL, ordinal ASC, created_at ASC, id ASC").all(draftId) as Row[]).map(mapMedia);
  }

  public getMedia(id: string): DraftMediaRecord | undefined {
    const row = this.db.prepare("SELECT * FROM draft_media WHERE id=?").get(id);
    return row ? mapMedia(row as Row) : undefined;
  }

  public countMedia(draftId: string, role: DraftMediaRole): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM draft_media WHERE draft_id=? AND role=?").get(draftId, role) as { count: number };
    return Number(row.count);
  }

  /**
   * 新建参考/蒙版媒体。参考图在同一个事务里领取编号，避免并发上传拿到同一个号。
   *
   * 编号只升不降：删除参考图不回收编号，所以旧编号永远不会被发给另一张图，
   * 已经写进主题框的 `@图N` 要么仍然指对，要么在提交时被明确拒绝，不会悄悄改指。
   */
  public createMedia(input: Omit<DraftMediaRecord, "id" | "createdAt" | "ordinal">): DraftMediaRecord {
    return this.db.transaction(() => {
      const ordinal = input.role === "REFERENCE" ? this.takeNextMediaOrdinal(input.draftId) : null;
      const record: DraftMediaRecord = { ...input, ordinal, id: randomUUID(), createdAt: now() };
      this.db.prepare(`INSERT INTO draft_media (id,draft_id,role,source,source_pattern_id,storage_path,file_hash,mime_type,width,height,original_name,notes,ordinal,created_at)
        VALUES (@id,@draftId,@role,@source,@sourcePatternId,@storagePath,@fileHash,@mimeType,@width,@height,@originalName,@notes,@ordinal,@createdAt)`)
        .run(record);
      return record;
    })();
  }

  private takeNextMediaOrdinal(draftId: string): number {
    const row = this.db.prepare("SELECT next_media_ordinal AS next FROM pattern_drafts WHERE id=?").get(draftId) as { next: number } | undefined;
    const next = Number(row?.next ?? 1);
    this.db.prepare("UPDATE pattern_drafts SET next_media_ordinal=? WHERE id=?").run(next + 1, draftId);
    return next;
  }

  /** 修改参考备注；已提交批次不受影响（它们引用的是不可变快照）。 */
  public updateMedia(id: string, patch: Partial<Pick<DraftMediaRecord, "notes">>): DraftMediaRecord | undefined {
    const current = this.getMedia(id);
    if (!current) return undefined;
    const record: DraftMediaRecord = { ...current, ...patch };
    this.db.prepare("UPDATE draft_media SET notes=? WHERE id=?").run(record.notes, record.id);
    return record;
  }

  /** 删除参考/蒙版媒体记录；文件由调用方在确认未被在途批次引用后清理。 */
  public deleteMedia(id: string): boolean {
    return this.db.prepare("DELETE FROM draft_media WHERE id=?").run(id).changes > 0;
  }

  // ---- batches ----

  public listBatches(draftId: string): DraftBatchRecord[] {
    return (this.db.prepare("SELECT * FROM draft_batches WHERE draft_id=? ORDER BY created_at ASC, id ASC").all(draftId) as Row[]).map(mapBatch);
  }

  public getBatch(id: string): DraftBatchRecord | undefined {
    const row = this.db.prepare("SELECT * FROM draft_batches WHERE id=?").get(id);
    return row ? mapBatch(row as Row) : undefined;
  }

  public getBatchByClientKey(draftId: string, clientKey: string): DraftBatchRecord | undefined {
    const row = this.db.prepare("SELECT * FROM draft_batches WHERE draft_id=? AND client_key=? LIMIT 1").get(draftId, clientKey);
    return row ? mapBatch(row as Row) : undefined;
  }

  /** 建批次并一次性生成固定槽位；槽位从 1 起编号，之后只改状态不换序号。 */
  public createBatch(input: Omit<DraftBatchRecord, "id" | "createdAt">): { batch: DraftBatchRecord; slots: DraftSlotRecord[] } {
    const create = this.db.transaction(() => {
      const batch: DraftBatchRecord = { ...input, id: randomUUID(), createdAt: now() };
      this.db.prepare(`INSERT INTO draft_batches (id,draft_id,operation,parent_candidate_id,provider_id,image_model_id,candidate_count,instruction,snapshot_json,client_key,created_at)
        VALUES (@id,@draftId,@operation,@parentCandidateId,@providerId,@imageModelId,@candidateCount,@instruction,@snapshot,@clientKey,@createdAt)`)
        .run({ ...batch, snapshot: json(batch.snapshot) });
      const slots: DraftSlotRecord[] = [];
      const insertSlot = this.db.prepare("INSERT INTO draft_slots (batch_id,slot_index,status,attempt,job_id,error_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)");
      const timestamp = now();
      for (let index = 1; index <= batch.candidateCount; index += 1) {
        insertSlot.run(batch.id, index, "QUEUED", 1, null, null, timestamp, timestamp);
        slots.push({ batchId: batch.id, index, status: "QUEUED", attempt: 1, jobId: null, error: null, createdAt: timestamp, updatedAt: timestamp });
      }
      return { batch, slots };
    });
    return create();
  }

  // ---- slots ----

  public listSlots(batchId: string): DraftSlotRecord[] {
    return (this.db.prepare("SELECT * FROM draft_slots WHERE batch_id=? ORDER BY slot_index ASC").all(batchId) as Row[]).map(mapSlot);
  }

  public listSlotsByJobId(jobId: string): DraftSlotRecord[] {
    return (this.db.prepare("SELECT * FROM draft_slots WHERE job_id=? ORDER BY slot_index ASC").all(jobId) as Row[]).map(mapSlot);
  }

  public updateSlot(batchId: string, index: number, patch: Partial<Pick<DraftSlotRecord, "status" | "attempt" | "jobId" | "error">>): DraftSlotRecord | undefined {
    const row = this.db.prepare("SELECT * FROM draft_slots WHERE batch_id=? AND slot_index=?").get(batchId, index) as Row | undefined;
    if (!row) return undefined;
    const current = mapSlot(row);
    const record: DraftSlotRecord = { ...current, ...patch, updatedAt: now() };
    this.db.prepare("UPDATE draft_slots SET status=@status,attempt=@attempt,job_id=@jobId,error_json=@error,updated_at=@updatedAt WHERE batch_id=@batchId AND slot_index=@index")
      .run({ ...record, error: record.error ? json(record.error) : null });
    return record;
  }

  /**
   * 把槽位挂到任务上。首次提交 bumpAttempt=false（保持 attempt=1）；失败补偿 bumpAttempt=true
   * 记录新 attempt。已成功槽位不在这里处理——失败补偿只传失败序号。
   */
  public assignSlotsToJob(batchId: string, indices: number[], jobId: string, bumpAttempt = true): DraftSlotRecord[] {
    const assign = this.db.transaction(() => indices.map((index) => {
      const row = this.db.prepare("SELECT * FROM draft_slots WHERE batch_id=? AND slot_index=?").get(batchId, index) as Row | undefined;
      if (!row) return undefined;
      const current = mapSlot(row);
      const record: DraftSlotRecord = { ...current, status: "QUEUED", attempt: bumpAttempt ? current.attempt + 1 : current.attempt, jobId, error: null, updatedAt: now() };
      this.db.prepare("UPDATE draft_slots SET status=@status,attempt=@attempt,job_id=@jobId,error_json=NULL,updated_at=@updatedAt WHERE batch_id=@batchId AND slot_index=@index")
        .run({ status: record.status, attempt: record.attempt, jobId: record.jobId, updatedAt: record.updatedAt, batchId: record.batchId, index: record.index });
      return record;
    }).filter((slot): slot is DraftSlotRecord => slot !== undefined));
    return assign();
  }

  // ---- candidates ----

  public listCandidates(draftId: string): DraftCandidateRecord[] {
    return (this.db.prepare("SELECT * FROM draft_candidates WHERE draft_id=? ORDER BY created_at ASC, id ASC").all(draftId) as Row[]).map(mapCandidate);
  }

  public listCandidatesByBatch(batchId: string): DraftCandidateRecord[] {
    return (this.db.prepare("SELECT * FROM draft_candidates WHERE batch_id=? ORDER BY slot_index ASC").all(batchId) as Row[]).map(mapCandidate);
  }

  public getCandidate(id: string): DraftCandidateRecord | undefined {
    const row = this.db.prepare("SELECT * FROM draft_candidates WHERE id=?").get(id);
    return row ? mapCandidate(row as Row) : undefined;
  }

  /**
   * 草稿列表的预览摘要：每份草稿的候选总数与最近一张候选。
   * 一次取齐，避免首页为每份草稿再发一轮候选查询。
   */
  public summarizeCandidates(draftIds: string[]): Map<string, { count: number; latest: DraftCandidateRecord }> {
    const summary = new Map<string, { count: number; latest: DraftCandidateRecord }>();
    if (draftIds.length === 0) return summary;
    const placeholders = draftIds.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT * FROM draft_candidates WHERE draft_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`).all(...draftIds) as Row[];
    for (const row of rows) {
      const candidate = mapCandidate(row);
      const current = summary.get(candidate.draftId);
      // 查询已按时间升序，后到者即更新的一张。
      summary.set(candidate.draftId, { count: (current?.count ?? 0) + 1, latest: candidate });
    }
    return summary;
  }

  /** 某批次已成功的槽位序号；恢复/重试据此只补缺失槽位，不重跑已成功项。 */
  public listCandidateSlotIndices(batchId: string): number[] {
    return (this.db.prepare("SELECT slot_index FROM draft_candidates WHERE batch_id=? ORDER BY slot_index").all(batchId) as Array<{ slot_index: number }>).map((row) => Number(row.slot_index));
  }

  /**
   * 落一个候选。像素不可变；同槽位已有成功产物时返回既有行（worker 重试幂等），
   * 不产生第二份候选，也不覆盖旧像素。
   */
  public createCandidate(input: Omit<DraftCandidateRecord, "id" | "createdAt" | "tileable" | "tileableScore" | "tileableCheckedWith" | "tileableHorizontal" | "tileableVertical"> & Partial<Pick<DraftCandidateRecord, "id" | "tileable" | "tileableScore" | "tileableCheckedWith" | "tileableHorizontal" | "tileableVertical">>): DraftCandidateRecord {
    const existing = this.db.prepare("SELECT * FROM draft_candidates WHERE batch_id=? AND slot_index=? LIMIT 1").get(input.batchId, input.slotIndex) as Row | undefined;
    if (existing) return mapCandidate(existing);
    const record: DraftCandidateRecord = { tileable: "NONE", tileableScore: null, tileableCheckedWith: null, tileableHorizontal: null, tileableVertical: null, ...input, id: input.id ?? randomUUID(), createdAt: now() };
    this.db.prepare(`INSERT INTO draft_candidates (id,draft_id,batch_id,slot_index,parent_candidate_id,storage_path,file_hash,mime_type,width,height,transform,has_alpha,tileable_status,tileable_score,tileable_checked_with,tileable_horizontal,tileable_vertical,created_at)
      VALUES (@id,@draftId,@batchId,@slotIndex,@parentCandidateId,@storagePath,@fileHash,@mimeType,@width,@height,@transform,@hasAlpha,@tileable,@tileableScore,@tileableCheckedWith,@tileableHorizontal,@tileableVertical,@createdAt)`)
      .run({ ...record, hasAlpha: record.hasAlpha ? 1 : 0 });
    return record;
  }

  public setCandidateTileable(id: string, verdict: { status: TileableStatus; score: number | null; algorithmVersion: string; horizontal?: number | null; vertical?: number | null }): DraftCandidateRecord | undefined {
    const current = this.getCandidate(id);
    if (!current) return undefined;
    const horizontal = verdict.horizontal ?? null;
    const vertical = verdict.vertical ?? null;
    this.db.prepare("UPDATE draft_candidates SET tileable_status=?,tileable_score=?,tileable_checked_with=?,tileable_horizontal=?,tileable_vertical=? WHERE id=?")
      .run(verdict.status, verdict.score, verdict.algorithmVersion, horizontal, vertical, id);
    return { ...current, tileable: verdict.status, tileableScore: verdict.score, tileableCheckedWith: verdict.algorithmVersion, tileableHorizontal: horizontal, tileableVertical: vertical };
  }

  /** 以该候选为父的候选 id；删除父候选前用它判断有无派生结果。 */
  public listChildCandidateIds(parentCandidateId: string): string[] {
    return (this.db.prepare("SELECT id FROM draft_candidates WHERE parent_candidate_id=? ORDER BY created_at ASC").all(parentCandidateId) as Array<{ id: string }>).map((row) => String(row.id));
  }

  /** 引用该候选作为快照父图的批次 id；在途批次要据此拒绝删除。 */
  public listParentBatches(draftId: string, candidateId: string): string[] {
    return this.listBatches(draftId)
      .filter((batch) => {
        const parent = batch.snapshot["parentCandidateId"];
        return typeof parent === "string" && parent === candidateId;
      })
      .map((batch) => batch.id);
  }

  /**
   * 该存储路径是否被本草稿的任一已提交批次快照引用。
   *
   * 快照里只有参考图与蒙版携带存储路径（候选只以 id 出现，见 resolveReferences 与 submitDraftBatch 的
   * snapshot 构造），所以用 json_extract 直接命中这两个位置，不再把整份快照字符串化后做子串扫描。
   */
  public isStoragePathReferenced(draftId: string, storagePath: string): boolean {
    const row = this.db.prepare(
      `SELECT 1 AS hit FROM draft_batches
        WHERE draft_id=? AND (
          json_extract(snapshot_json, '$.mask.storagePath')=?
          OR EXISTS (SELECT 1 FROM json_each(snapshot_json, '$.references') WHERE json_extract(value, '$.storagePath')=?)
        ) LIMIT 1`,
    ).get(draftId, storagePath, storagePath) as Row | undefined;
    return Boolean(row);
  }

  /** 按内容 hash 找一张草稿图（参考图/蒙版/候选）的存储路径，供缩略图惰性生成。 */
  public findImageSourcePath(hash: string): string | undefined {
    const media = this.db.prepare("SELECT storage_path FROM draft_media WHERE file_hash=? LIMIT 1").get(hash) as Row | undefined;
    if (media?.storage_path) return String(media.storage_path);
    const candidate = this.db.prepare("SELECT storage_path FROM draft_candidates WHERE file_hash=? LIMIT 1").get(hash) as Row | undefined;
    return candidate?.storage_path ? String(candidate.storage_path) : undefined;
  }

  /**
   * 删除一个候选。
   *
   * 同一事务内断开所有指向它的引用：草稿的选中/比较指针、子候选的父指针。
   * 不删除派生候选本身——它们是独立产物，只是父节点消失后不再有来源可指。
   * 候选像素文件由调用方在事务外清理。已定稿的正式花型是独立拷贝，不受影响。
   */
  public deleteCandidate(id: string): boolean {
    return this.db.transaction(() => {
      const candidate = this.getCandidate(id);
      if (!candidate) return false;
      this.db.prepare("UPDATE pattern_drafts SET selected_candidate_id=NULL WHERE selected_candidate_id=?").run(id);
      this.db.prepare("UPDATE pattern_drafts SET compare_candidate_id=NULL WHERE compare_candidate_id=?").run(id);
      this.db.prepare("UPDATE draft_candidates SET parent_candidate_id=NULL WHERE parent_candidate_id=?").run(id);
      return this.db.prepare("DELETE FROM draft_candidates WHERE id=?").run(id).changes > 0;
    })();
  }
}

function mapDraft(row: Row): PatternDraftRecord {
  return {
    id: String(row.id), name: String(row.name), composeType: row.compose_type as DraftComposeType,
    conditions: parse(row.conditions_json ?? "{}"), revision: Number(row.revision),
    selectedCandidateId: row.selected_candidate_id == null ? null : String(row.selected_candidate_id),
    compareCandidateId: row.compare_candidate_id == null ? null : String(row.compare_candidate_id),
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}
function mapMedia(row: Row): DraftMediaRecord {
  return {
    id: String(row.id), draftId: String(row.draft_id), role: row.role as DraftMediaRole, source: row.source as DraftMediaSource,
    sourcePatternId: row.source_pattern_id == null ? null : String(row.source_pattern_id),
    storagePath: String(row.storage_path), fileHash: String(row.file_hash), mimeType: String(row.mime_type),
    width: row.width == null ? null : Number(row.width), height: row.height == null ? null : Number(row.height),
    originalName: String(row.original_name), notes: row.notes == null ? null : String(row.notes),
    ordinal: row.ordinal == null ? null : Number(row.ordinal), createdAt: String(row.created_at),
  };
}
function mapBatch(row: Row): DraftBatchRecord {
  return {
    id: String(row.id), draftId: String(row.draft_id), operation: row.operation as DraftBatchOperation,
    parentCandidateId: row.parent_candidate_id == null ? null : String(row.parent_candidate_id),
    providerId: row.provider_id == null ? null : String(row.provider_id),
    imageModelId: row.image_model_id == null ? null : String(row.image_model_id),
    candidateCount: Number(row.candidate_count), instruction: row.instruction == null ? null : String(row.instruction),
    snapshot: parse(row.snapshot_json ?? "{}"), clientKey: String(row.client_key), createdAt: String(row.created_at),
  };
}
function mapSlot(row: Row): DraftSlotRecord {
  return {
    batchId: String(row.batch_id), index: Number(row.slot_index), status: row.status as DraftSlotStatus,
    attempt: Number(row.attempt), jobId: row.job_id == null ? null : String(row.job_id),
    error: row.error_json ? parse(row.error_json) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}
function mapCandidate(row: Row): DraftCandidateRecord {
  return {
    id: String(row.id), draftId: String(row.draft_id), batchId: String(row.batch_id), slotIndex: Number(row.slot_index),
    parentCandidateId: row.parent_candidate_id == null ? null : String(row.parent_candidate_id),
    storagePath: String(row.storage_path), fileHash: String(row.file_hash), mimeType: String(row.mime_type),
    width: row.width == null ? null : Number(row.width), height: row.height == null ? null : Number(row.height),
    transform: row.transform as DraftBatchOperation, hasAlpha: Number(row.has_alpha) === 1,
    tileable: (row.tileable_status ?? "NONE") as TileableStatus,
    tileableScore: row.tileable_score == null ? null : Number(row.tileable_score),
    tileableCheckedWith: row.tileable_checked_with == null ? null : String(row.tileable_checked_with),
    tileableHorizontal: row.tileable_horizontal == null ? null : Number(row.tileable_horizontal),
    tileableVertical: row.tileable_vertical == null ? null : Number(row.tileable_vertical),
    createdAt: String(row.created_at),
  };
}
