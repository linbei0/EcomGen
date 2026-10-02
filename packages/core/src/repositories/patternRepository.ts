import { randomUUID } from "node:crypto";
import type { ListingCopy, ListingPlatform, PatternSource, TileableStatus } from "@ecomgen/contracts";
import type { SqliteDatabase } from "../database.js";
import { type Row, json, now, parse } from "./internal.js";

/** 全局花型库条目；来源血缘（提取源图 hash / 起稿任务 / 父花型）是自检与追溯的留痕基础。 */
export interface PatternRecord {
  id: string;
  name: string;
  sourceType: PatternSource;
  sourceJobId: string | null;
  sourceAssetHash: string | null;
  parentPatternId: string | null;
  storagePath: string | null;
  fileHash: string | null;
  width: number | null;
  height: number | null;
  tags: string[];
  /** 可平铺判定；只有 PATTERN_TILE_CHECK 任务会改写它，花型图内容本身不被验缝修改。 */
  tileable: TileableStatus;
  /** 验缝归一化相似度 0..1；未校验为 null。 */
  tileableScore: number | null;
  /** 写入该判定时的算法版本；与当前版本不一致表示判定过期。 */
  tileableCheckedWith: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 规格包产物文件；PRINT_FILE 为可投产 PNG，MOCKUP 为品类示意图，SEAMLESS_TILE 为满印无缝单元，MANIFEST 为溯源清单。 */
export interface PrintPackFileRecord {
  name: string;
  kind: "PRINT_FILE" | "MOCKUP" | "MANIFEST" | "SEAMLESS_TILE";
  storagePath: string;
  hash: string;
}

/** 规格包领域记录；一任务一记录（job_id 唯一），文件清单与 manifest 在成功后写入。 */
export interface PrintPackRecord {
  id: string;
  patternId: string;
  jobId: string;
  specId: string;
  specVersion: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  files: PrintPackFileRecord[] | null;
  manifest: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** 花型 Listing 文案结果；独立于 copywriting_results（后者归属项目域且 project_id 非空）。 */
export interface PatternListingResultRecord {
  jobId: string;
  patternId: string;
  platform: ListingPlatform;
  copy: ListingCopy;
  createdAt: string;
}

export class PatternRepository {
  public constructor(private readonly db: SqliteDatabase) { }

  public listPatterns(): PatternRecord[] { return (this.db.prepare("SELECT * FROM patterns ORDER BY created_at DESC, id DESC").all() as Row[]).map(mapPattern); }
  /** 指纹复用判定用：某次提取/起稿任务当前还挂着的花型（用户删除后为空）。 */
  public listPatternsByJobId(jobId: string): PatternRecord[] {
    return (this.db.prepare("SELECT * FROM patterns WHERE source_job_id=? ORDER BY created_at DESC, id DESC").all(jobId) as Row[]).map(mapPattern);
  }
  /** 同一判定但只需布尔答案（API 的指纹复用）时用这条：EXISTS 一行即返回，不把候选行整表 map 出来。 */
  public hasPatternArtifactsByJobId(jobId: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM patterns WHERE source_job_id=? AND storage_path IS NOT NULL AND file_hash IS NOT NULL LIMIT 1").get(jobId);
    return row !== undefined;
  }
  public getPattern(id: string): PatternRecord | undefined {
    const row = this.db.prepare("SELECT * FROM patterns WHERE id=?").get(id);
    return row ? mapPattern(row as Row) : undefined;
  }
  /** Worker 落一条花型；同 (sourceJobId, fileHash) 幂等返回既有行，重试不产生重复花型。 */
  public createPattern(input: Omit<PatternRecord, "id" | "createdAt" | "updatedAt" | "tileable" | "tileableScore" | "tileableCheckedWith"> & Partial<Pick<PatternRecord, "id" | "tileable" | "tileableScore" | "tileableCheckedWith">>): PatternRecord {
    const existing = input.sourceJobId && input.fileHash
      ? this.db.prepare("SELECT * FROM patterns WHERE source_job_id=? AND file_hash=? LIMIT 1").get(input.sourceJobId, input.fileHash) as Row | undefined
      : undefined;
    if (existing) return mapPattern(existing);
    // 新花型一律从 NONE 起步：可平铺是"已验过"的事实，不能在入库时就假定成立。
    const record: PatternRecord = { tileable: "NONE", tileableScore: null, tileableCheckedWith: null, ...input, id: input.id ?? randomUUID(), createdAt: now(), updatedAt: now() };
    this.db.prepare(`INSERT INTO patterns (id,name,source_type,source_job_id,source_asset_hash,parent_pattern_id,storage_path,file_hash,width,height,tags_json,tileable_status,tileable_score,tileable_checked_with,created_at,updated_at)
      VALUES (@id,@name,@sourceType,@sourceJobId,@sourceAssetHash,@parentPatternId,@storagePath,@fileHash,@width,@height,@tags,@tileable,@tileableScore,@tileableCheckedWith,@createdAt,@updatedAt)`)
      .run({ ...record, tags: json(record.tags) });
    return record;
  }
  public updatePattern(id: string, patch: Partial<Pick<PatternRecord, "name" | "tags">>): PatternRecord | undefined {
    const current = this.getPattern(id);
    if (!current) return undefined;
    const record: PatternRecord = { ...current, ...patch, updatedAt: now() };
    this.db.prepare("UPDATE patterns SET name=@name,tags_json=@tags,updated_at=@updatedAt WHERE id=@id")
      .run({ id: record.id, name: record.name, tags: json(record.tags), updatedAt: record.updatedAt });
    return record;
  }
  public deletePattern(id: string): boolean {
    return this.db.prepare("DELETE FROM patterns WHERE id=?").run(id).changes > 0;
  }

  /** Worker 回填花型产物：文件落盘后一次性写入主图路径、hash 与尺寸；此前该行在资产库不可见。 */
  public setPatternArtifact(id: string, artifact: { storagePath: string; fileHash: string; width: number | null; height: number | null }): PatternRecord | undefined {
    const current = this.getPattern(id);
    if (!current) return undefined;
    const record: PatternRecord = { ...current, ...artifact, updatedAt: now() };
    this.db.prepare("UPDATE patterns SET storage_path=@storagePath,file_hash=@fileHash,width=@width,height=@height,updated_at=@updatedAt WHERE id=@id")
      .run({ id: record.id, storagePath: record.storagePath, fileHash: record.fileHash, width: record.width, height: record.height, updatedAt: record.updatedAt });
    return record;
  }

  /**
   * Worker 回写验缝判定；这是 tileable* 三列的唯一写入方。花型图内容不可变，所以判定只在
   * 验缝算法版本变更时才需要重算，写入时一并记录算法版本以便识别过期判定。
   */
  public setPatternTileable(id: string, verdict: { status: TileableStatus; score: number | null; algorithmVersion: string }): PatternRecord | undefined {
    const current = this.getPattern(id);
    if (!current) return undefined;
    const updatedAt = now();
    this.db.prepare("UPDATE patterns SET tileable_status=@status,tileable_score=@score,tileable_checked_with=@algorithmVersion,updated_at=@updatedAt WHERE id=@id")
      .run({ id, status: verdict.status, score: verdict.score, algorithmVersion: verdict.algorithmVersion, updatedAt });
    return { ...current, tileable: verdict.status, tileableScore: verdict.score, tileableCheckedWith: verdict.algorithmVersion, updatedAt };
  }

  public createPrintPack(input: Omit<PrintPackRecord, "id" | "createdAt" | "updatedAt" | "status" | "files" | "manifest" | "error"> & Partial<Pick<PrintPackRecord, "status">>): PrintPackRecord {
    const record: PrintPackRecord = { ...input, status: input.status ?? "QUEUED", files: null, manifest: null, error: null, id: randomUUID(), createdAt: now(), updatedAt: now() };
    this.db.prepare(`INSERT INTO print_packs (id,pattern_id,job_id,spec_id,spec_version,status,files_json,manifest_json,error_json,created_at,updated_at)
      VALUES (@id,@patternId,@jobId,@specId,@specVersion,@status,@files,@manifest,@error,@createdAt,@updatedAt)`)
      .run({ ...record, files: record.files ? json(record.files) : null, manifest: record.manifest ? json(record.manifest) : null, error: record.error ? json(record.error) : null });
    return record;
  }
  public getPrintPack(id: string): PrintPackRecord | undefined {
    const row = this.db.prepare("SELECT * FROM print_packs WHERE id=?").get(id);
    return row ? mapPrintPack(row as Row) : undefined;
  }
  public getPrintPackByJobId(jobId: string): PrintPackRecord | undefined {
    const row = this.db.prepare("SELECT * FROM print_packs WHERE job_id=?").get(jobId);
    return row ? mapPrintPack(row as Row) : undefined;
  }
  public listPrintPacks(patternId: string): PrintPackRecord[] {
    return (this.db.prepare("SELECT * FROM print_packs WHERE pattern_id=? ORDER BY created_at DESC, id DESC").all(patternId) as Row[]).map(mapPrintPack);
  }
  public updatePrintPack(id: string, patch: Partial<Pick<PrintPackRecord, "status" | "files" | "manifest" | "error">>): PrintPackRecord | undefined {
    const current = this.getPrintPack(id);
    if (!current) return undefined;
    const record: PrintPackRecord = { ...current, ...patch, updatedAt: now() };
    this.db.prepare("UPDATE print_packs SET status=@status,files_json=@files,manifest_json=@manifest,error_json=@error,updated_at=@updatedAt WHERE id=@id")
      .run({ id: record.id, status: record.status, files: record.files ? json(record.files) : null, manifest: record.manifest ? json(record.manifest) : null, error: record.error ? json(record.error) : null, updatedAt: record.updatedAt });
    return record;
  }
  public deletePrintPack(id: string): boolean {
    return this.db.prepare("DELETE FROM print_packs WHERE id=?").run(id).changes > 0;
  }

  public savePatternListingResult(input: Omit<PatternListingResultRecord, "createdAt">): PatternListingResultRecord {
    const record: PatternListingResultRecord = { ...input, createdAt: now() };
    this.db.prepare("INSERT OR REPLACE INTO pattern_listing_results (job_id,pattern_id,platform,content_json,created_at) VALUES (@jobId,@patternId,@platform,@copy,@createdAt)")
      .run({ ...record, copy: json(record.copy) });
    return record;
  }
  public getPatternListingResult(jobId: string): PatternListingResultRecord | undefined {
    const row = this.db.prepare("SELECT * FROM pattern_listing_results WHERE job_id=?").get(jobId);
    return row ? mapPatternListingResult(row as Row) : undefined;
  }
}

function mapPattern(row: Row): PatternRecord { return { id: String(row.id), name: String(row.name), sourceType: row.source_type as PatternSource, sourceJobId: row.source_job_id == null ? null : String(row.source_job_id), sourceAssetHash: row.source_asset_hash == null ? null : String(row.source_asset_hash), parentPatternId: row.parent_pattern_id == null ? null : String(row.parent_pattern_id), storagePath: row.storage_path == null ? null : String(row.storage_path), fileHash: row.file_hash == null ? null : String(row.file_hash), width: row.width == null ? null : Number(row.width), height: row.height == null ? null : Number(row.height), tags: parse(row.tags_json ?? "[]"), tileable: (row.tileable_status ?? "NONE") as TileableStatus, tileableScore: row.tileable_score == null ? null : Number(row.tileable_score), tileableCheckedWith: row.tileable_checked_with == null ? null : String(row.tileable_checked_with), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapPrintPack(row: Row): PrintPackRecord { return { id: String(row.id), patternId: String(row.pattern_id), jobId: String(row.job_id), specId: String(row.spec_id), specVersion: String(row.spec_version), status: row.status as PrintPackRecord["status"], files: row.files_json ? parse(row.files_json) : null, manifest: row.manifest_json ? parse(row.manifest_json) : null, error: row.error_json ? parse(row.error_json) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapPatternListingResult(row: Row): PatternListingResultRecord { return { jobId: String(row.job_id), patternId: String(row.pattern_id), platform: String(row.platform) as ListingPlatform, copy: parse(row.content_json) as ListingCopy, createdAt: String(row.created_at) }; }
