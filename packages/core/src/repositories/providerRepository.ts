import { randomUUID } from "node:crypto";
import type { ModelDefinition, ReasoningProtocolProfile } from "@ecomgen/contracts";
import type { SqliteDatabase } from "../database.js";
import { type Row, json, now, parse } from "./internal.js";

export interface ProviderRecord {
  id: string;
  name: string;
  baseUrl: string;
  reasoningProtocol: ReasoningProtocolProfile;
  encryptedApiKey: string;
  models: ModelDefinition[];
  createdAt: string;
  updatedAt: string;
}

export class ProviderRepository {
  public constructor(private readonly db: SqliteDatabase) { }

  public listProviders(): ProviderRecord[] { return (this.db.prepare("SELECT * FROM providers ORDER BY created_at DESC").all() as Row[]).map(mapProvider); }
  public getProvider(id: string): ProviderRecord | undefined { const row = this.db.prepare("SELECT * FROM providers WHERE id = ?").get(id); return row ? mapProvider(row as Row) : undefined; }
  public saveProvider(input: Omit<ProviderRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }): ProviderRecord {
    const existing = input.id ? this.getProvider(input.id) : undefined;
    const record: ProviderRecord = { ...input, id: input.id ?? randomUUID(), createdAt: existing?.createdAt ?? now(), updatedAt: now() };
    this.db.prepare(`INSERT INTO providers (id,name,base_url,reasoning_protocol,encrypted_api_key,models_json,created_at,updated_at)
      VALUES (@id,@name,@baseUrl,@reasoningProtocol,@encryptedApiKey,@models,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,reasoning_protocol=excluded.reasoning_protocol,encrypted_api_key=excluded.encrypted_api_key,models_json=excluded.models_json,updated_at=excluded.updated_at`)
      .run({ ...record, models: json(record.models) });
    return record;
  }
  /**
   * 删除 Provider 并把引用它的项目置空（Provider 只在生成时使用，项目随后重新选择模型即可）。
   * 级联面横跨 projects/storyboard_items/jobs 三张表：这是 Provider 聚合删除的完整定义，
   * 拆到各表仓库会让同一事务的语句散落，任何一处遗漏都会留下悬挂引用。
   */
  public deleteProvider(id: string): "deleted" | "missing" {
    if (!this.getProvider(id)) return "missing";
    const clear = this.db.transaction(() => {
      this.db.prepare("UPDATE projects SET reasoning_provider_id=NULL, reasoning_model_id=NULL, updated_at=? WHERE reasoning_provider_id=?").run(now(), id);
      this.db.prepare("UPDATE projects SET image_provider_id=NULL, image_model_id=NULL, updated_at=? WHERE image_provider_id=?").run(now(), id);
      this.db.prepare("UPDATE projects SET segmentation_provider_id=NULL, segmentation_model_id=NULL, updated_at=? WHERE segmentation_provider_id=?").run(now(), id);
      this.db.prepare("UPDATE storyboard_items SET image_provider_id=NULL, image_model_id=NULL, updated_at=? WHERE image_provider_id=?").run(now(), id);
      this.db.prepare("UPDATE jobs SET status='CANCELLED', retryable=0, cancel_requested=1, updated_at=? WHERE provider_id=? AND status IN ('QUEUED','RUNNING')").run(now(), id);
      this.db.prepare("DELETE FROM providers WHERE id=?").run(id);
    });
    clear();
    return "deleted";
  }
}

function mapProvider(row: Row): ProviderRecord { return { id: String(row.id), name: String(row.name), baseUrl: String(row.base_url), reasoningProtocol: row.reasoning_protocol as ReasoningProtocolProfile, encryptedApiKey: String(row.encrypted_api_key), models: parse(row.models_json), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
