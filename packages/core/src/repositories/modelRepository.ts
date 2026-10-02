import { randomUUID } from "node:crypto";
import type { ImageAspectRatio, ModelSpec } from "@ecomgen/contracts";
import type { SqliteDatabase } from "../database.js";
import { type Row, json, now, parse } from "./internal.js";

/** 全局模特库条目；spec 是定妆照 prompt 的唯一持久化真相，不绑定项目。 */
export interface ModelRecord {
  id: string;
  name: string;
  spec: ModelSpec;
  notes: string;
  referenceFacePath: string | null;
  referenceFaceHash: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 模选定妆照；selected 在事务内先清后设，保证每模特至多一张。 */
export interface ModelPortraitRecord {
  id: string;
  modelId: string;
  jobId: string;
  storagePath: string;
  hash: string;
  width: number | null;
  height: number | null;
  providerId: string;
  imageModelId: string;
  aspectRatio: ImageAspectRatio;
  selected: boolean;
  createdAt: string;
}

export class ModelRepository {
  public constructor(private readonly db: SqliteDatabase) { }

  public listModels(): ModelRecord[] { return (this.db.prepare("SELECT * FROM models ORDER BY updated_at DESC").all() as Row[]).map(mapModel); }
  public getModel(id: string): ModelRecord | undefined {
    const row = this.db.prepare("SELECT * FROM models WHERE id=?").get(id);
    return row ? mapModel(row as Row) : undefined;
  }
  public createModel(input: { name: string; spec: ModelSpec; notes: string }): ModelRecord {
    const record: ModelRecord = { id: randomUUID(), name: input.name, spec: input.spec, notes: input.notes, referenceFacePath: null, referenceFaceHash: null, createdAt: now(), updatedAt: now() };
    this.writeModel(record);
    return record;
  }
  public updateModel(id: string, patch: { name?: string; spec?: ModelSpec; notes?: string }): ModelRecord | undefined {
    const current = this.getModel(id);
    if (!current) return undefined;
    const record: ModelRecord = { ...current, ...patch, updatedAt: now() };
    this.writeModel(record);
    return record;
  }
  /** 上传/清除参考脸共用：path 与 hash 同时置空即清除；参考脸是模特的唯一身份基准。 */
  public setModelReferenceFace(id: string, path: string | null, hash: string | null): ModelRecord | undefined {
    const current = this.getModel(id);
    if (!current) return undefined;
    const record: ModelRecord = { ...current, referenceFacePath: path, referenceFaceHash: hash, updatedAt: now() };
    this.writeModel(record);
    return record;
  }
  public deleteModel(id: string): boolean {
    return this.db.prepare("DELETE FROM models WHERE id=?").run(id).changes > 0;
  }
  private writeModel(record: ModelRecord): void {
    this.db.prepare(`INSERT INTO models (id,name,spec_json,notes,reference_face_path,reference_face_hash,created_at,updated_at)
      VALUES (@id,@name,@spec,@notes,@referenceFacePath,@referenceFaceHash,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,spec_json=excluded.spec_json,notes=excluded.notes,reference_face_path=excluded.reference_face_path,reference_face_hash=excluded.reference_face_hash,updated_at=excluded.updated_at`)
      .run({ ...record, spec: json(record.spec) });
  }

  public listModelPortraits(modelId: string): ModelPortraitRecord[] {
    return (this.db.prepare("SELECT * FROM model_portraits WHERE model_id=? ORDER BY created_at DESC, id DESC").all(modelId) as Row[]).map(mapModelPortrait);
  }
  public getModelPortrait(portraitId: string): ModelPortraitRecord | undefined {
    const row = this.db.prepare("SELECT * FROM model_portraits WHERE id=?").get(portraitId);
    return row ? mapModelPortrait(row as Row) : undefined;
  }
  /** Worker 落库一张候选定妆照；同 hash 已存在时幂等返回既有行，避免重试产生重复图。 */
  public createModelPortrait(input: Omit<ModelPortraitRecord, "id" | "selected" | "createdAt">): ModelPortraitRecord {
    const existing = this.db.prepare("SELECT * FROM model_portraits WHERE model_id=? AND hash=? LIMIT 1").get(input.modelId, input.hash) as Row | undefined;
    if (existing) return mapModelPortrait(existing);
    const record: ModelPortraitRecord = { ...input, id: randomUUID(), selected: false, createdAt: now() };
    this.db.prepare(`INSERT INTO model_portraits (id,model_id,job_id,storage_path,hash,width,height,provider_id,image_model_id,aspect_ratio,selected,created_at)
      VALUES (@id,@modelId,@jobId,@storagePath,@hash,@width,@height,@providerId,@imageModelId,@aspectRatio,0,@createdAt)`).run(record);
    return record;
  }
  /** 选定切换必须在事务内先清后设，配合部分唯一索引保证每模特至多一张选定。 */
  public selectModelPortrait(modelId: string, portraitId: string): "selected" | "missing" {
    const portrait = this.getModelPortrait(portraitId);
    if (!portrait || portrait.modelId !== modelId) return "missing";
    const write = this.db.transaction(() => {
      this.db.prepare("UPDATE model_portraits SET selected=0 WHERE model_id=? AND selected=1").run(modelId);
      this.db.prepare("UPDATE model_portraits SET selected=1 WHERE id=?").run(portraitId);
    });
    write();
    return "selected";
  }
  public deleteModelPortrait(portraitId: string): boolean {
    return this.db.prepare("DELETE FROM model_portraits WHERE id=?").run(portraitId).changes > 0;
  }
  /** 全部定妆照：模特列表一次取回后按模特分组，避免逐个模特各查一次。 */
  public listAllModelPortraits(): ModelPortraitRecord[] {
    return (this.db.prepare("SELECT * FROM model_portraits ORDER BY created_at DESC, id DESC").all() as Row[]).map(mapModelPortrait);
  }
  /** 指纹复用判定用：某次选角任务当前还挂着的候选定妆照。 */
  public listModelPortraitsByJobId(jobId: string): ModelPortraitRecord[] {
    return (this.db.prepare("SELECT * FROM model_portraits WHERE job_id=? ORDER BY created_at DESC, id DESC").all(jobId) as Row[]).map(mapModelPortrait);
  }
}

function mapModel(row: Row): ModelRecord { return { id: String(row.id), name: String(row.name), spec: parse(row.spec_json), notes: String(row.notes ?? ""), referenceFacePath: row.reference_face_path == null ? null : String(row.reference_face_path), referenceFaceHash: row.reference_face_hash == null ? null : String(row.reference_face_hash), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapModelPortrait(row: Row): ModelPortraitRecord { return { id: String(row.id), modelId: String(row.model_id), jobId: String(row.job_id), storagePath: String(row.storage_path), hash: String(row.hash), width: row.width == null ? null : Number(row.width), height: row.height == null ? null : Number(row.height), providerId: String(row.provider_id), imageModelId: String(row.image_model_id), aspectRatio: row.aspect_ratio as ImageAspectRatio, selected: Boolean(row.selected), createdAt: String(row.created_at) }; }
