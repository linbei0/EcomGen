import { randomUUID } from "node:crypto";
import type { AssetRole } from "@ecomgen/contracts";
import type { SqliteDatabase } from "../database.js";
import { type Row, now } from "./internal.js";

export interface AssetRecord {
  id: string;
  projectId: string;
  role: AssetRole;
  storagePath: string;
  hash: string;
  originalName: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export class AssetRepository {
  public constructor(private readonly db: SqliteDatabase) { }

  public listAssets(projectId: string): AssetRecord[] { return (this.db.prepare("SELECT * FROM assets WHERE project_id=? ORDER BY created_at").all(projectId) as Row[]).map(mapAsset); }
  public getAsset(id: string): AssetRecord | undefined { const row = this.db.prepare("SELECT * FROM assets WHERE id=?").get(id); return row ? mapAsset(row as Row) : undefined; }
  public createAsset(input: Omit<AssetRecord, "id" | "createdAt">): AssetRecord {
    const record: AssetRecord = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare(`INSERT INTO assets (id,project_id,role,storage_path,hash,original_name,mime_type,width,height,created_at)
      VALUES (@id,@projectId,@role,@storagePath,@hash,@originalName,@mimeType,@width,@height,@createdAt)`).run(record);
    return record;
  }

  /** 先查后删：返回被删记录供 API 删除存储文件；不存在返回 undefined。 */
  public deleteAsset(id: string): AssetRecord | undefined {
    const row = this.db.prepare("SELECT * FROM assets WHERE id=?").get(id);
    if (!row) return undefined;
    this.db.prepare("DELETE FROM assets WHERE id=?").run(id);
    return mapAsset(row as Row);
  }
}

function mapAsset(row: Row): AssetRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    role: row.role as AssetRole,
    storagePath: String(row.storage_path),
    hash: String(row.hash),
    originalName: String(row.original_name),
    mimeType: String(row.mime_type),
    width: row.width === null || row.width === undefined ? null : Number(row.width),
    height: row.height === null || row.height === undefined ? null : Number(row.height),
    createdAt: String(row.created_at)
  };
}
