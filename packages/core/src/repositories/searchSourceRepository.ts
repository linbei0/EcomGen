import { randomUUID } from "node:crypto";
import type { SearchSourceKind } from "@ecomgen/contracts";
import type { SqliteDatabase } from "../database.js";
import { type Row, now } from "./internal.js";

export interface SearchSourceRecord {
  id: string;
  name: string;
  kind: SearchSourceKind;
  baseUrl: string;
  encryptedApiKey: string | null;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export class SearchSourceRepository {
  public constructor(private readonly db: SqliteDatabase) { }

  public listSearchSources(): SearchSourceRecord[] {
    return (this.db.prepare("SELECT * FROM search_sources ORDER BY priority ASC, created_at ASC").all() as Row[]).map(mapSearchSource);
  }
  public getSearchSource(id: string): SearchSourceRecord | undefined {
    const row = this.db.prepare("SELECT * FROM search_sources WHERE id = ?").get(id);
    return row ? mapSearchSource(row as Row) : undefined;
  }
  public saveSearchSource(input: Omit<SearchSourceRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }): SearchSourceRecord {
    const existing = input.id ? this.getSearchSource(input.id) : undefined;
    const record: SearchSourceRecord = { ...input, id: input.id ?? randomUUID(), createdAt: existing?.createdAt ?? now(), updatedAt: now() };
    this.db.prepare(`INSERT INTO search_sources (id,name,kind,base_url,encrypted_api_key,priority,enabled,created_at,updated_at)
      VALUES (@id,@name,@kind,@baseUrl,@encryptedApiKey,@priority,@enabled,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,base_url=excluded.base_url,encrypted_api_key=excluded.encrypted_api_key,priority=excluded.priority,enabled=excluded.enabled,updated_at=excluded.updated_at`)
      .run({ ...record, enabled: record.enabled ? 1 : 0 });
    return record;
  }
  public deleteSearchSource(id: string): boolean {
    return this.db.prepare("DELETE FROM search_sources WHERE id=?").run(id).changes > 0;
  }
}

function mapSearchSource(row: Row): SearchSourceRecord { return { id: String(row.id), name: String(row.name), kind: row.kind as SearchSourceKind, baseUrl: String(row.base_url), encryptedApiKey: row.encrypted_api_key ? String(row.encrypted_api_key) : null, priority: Number(row.priority), enabled: Boolean(row.enabled), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
