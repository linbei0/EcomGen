import { randomUUID } from "node:crypto";
import type { EditSessionStatus, EditTurnStatus, ReferencePurpose, ReferenceSelection } from "@ecomgen/contracts";
import type { SqliteDatabase } from "../database.js";
import { type Row, json, now, parse } from "./internal.js";

export interface EditSessionRecord {
  id: string;
  projectId: string;
  currentOutputId: string;
  status: EditSessionStatus;
  memorySummary: {
    summary?: string;
    constraints?: string[];
    /** 以输出节点为键保存分支记忆，避免同一会话中的兄弟分支互相污染。 */
    scopes?: Record<string, { summary?: string; constraints?: string[] }>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface EditTurnRecord {
  id: string;
  sessionId: string;
  projectId: string;
  baseOutputId: string;
  status: EditTurnStatus;
  message: string;
  annotations: Record<string, unknown>;
  editMaskPath: string | null;
  editMaskHash: string | null;
  protectMaskPath: string | null;
  protectMaskHash: string | null;
  referenceAssetIds: string[];
  referenceSelections: ReferenceSelection[];
  plan: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
export interface EditReferenceAssetRecord { id: string; projectId: string; sessionId: string; turnId: string | null; storagePath: string; hash: string; originalName: string; mimeType: string; purpose: ReferencePurpose; createdAt: string; expiresAt: string; }

export class EditSessionRepository {
  public constructor(private readonly db: SqliteDatabase) { }

  public getEditSession(id: string): EditSessionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM edit_sessions WHERE id=?").get(id);
    return row ? mapEditSession(row as Row) : undefined;
  }
  public getActiveEditSession(projectId: string, outputId: string): EditSessionRecord | undefined {
    const row = this.db.prepare("SELECT DISTINCT edit_sessions.* FROM edit_sessions LEFT JOIN outputs ON outputs.edit_session_id=edit_sessions.id WHERE edit_sessions.project_id=? AND edit_sessions.status='ACTIVE' AND (edit_sessions.current_output_id=? OR outputs.id=?) ORDER BY edit_sessions.updated_at DESC LIMIT 1").get(projectId, outputId, outputId);
    return row ? mapEditSession(row as Row) : undefined;
  }
  public createEditSession(input: Omit<EditSessionRecord, "createdAt" | "updatedAt">): EditSessionRecord {
    const record = { ...input, createdAt: now(), updatedAt: now() };
    this.db.prepare("INSERT INTO edit_sessions (id,project_id,current_output_id,status,memory_summary_json,created_at,updated_at) VALUES (@id,@projectId,@currentOutputId,@status,@memorySummary,@createdAt,@updatedAt)").run({ ...record, memorySummary: json(record.memorySummary) });
    return record;
  }
  public updateEditSession(id: string, patch: Partial<Pick<EditSessionRecord, "currentOutputId" | "status" | "memorySummary">>): EditSessionRecord | undefined {
    const current = this.getEditSession(id); if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: now() };
    this.db.prepare("UPDATE edit_sessions SET current_output_id=@currentOutputId,status=@status,memory_summary_json=@memorySummary,updated_at=@updatedAt WHERE id=@id").run({ ...next, memorySummary: json(next.memorySummary) });
    return next;
  }
  public getEditTurn(id: string): EditTurnRecord | undefined {
    const row = this.db.prepare("SELECT * FROM edit_turns WHERE id=?").get(id);
    return row ? mapEditTurn(row as Row) : undefined;
  }
  public listEditTurns(sessionId: string): EditTurnRecord[] { return (this.db.prepare("SELECT * FROM edit_turns WHERE session_id=? ORDER BY created_at ASC").all(sessionId) as Row[]).map(mapEditTurn); }
  public createEditTurn(input: Omit<EditTurnRecord, "createdAt" | "updatedAt" | "referenceSelections"> & { referenceSelections?: ReferenceSelection[] }): EditTurnRecord {
    const referenceSelections = input.referenceSelections ?? input.referenceAssetIds.map((id, order) => ({ id, source: "PROJECT" as const, purpose: "PRODUCT_APPEARANCE" as const, order }));
    const record: EditTurnRecord = { ...input, referenceSelections, createdAt: now(), updatedAt: now() };
    this.db.prepare("INSERT INTO edit_turns (id,session_id,project_id,base_output_id,status,message,annotations_json,edit_mask_path,edit_mask_hash,protect_mask_path,protect_mask_hash,reference_asset_ids_json,reference_selections_json,plan_json,error_json,created_at,updated_at) VALUES (@id,@sessionId,@projectId,@baseOutputId,@status,@message,@annotations,@editMaskPath,@editMaskHash,@protectMaskPath,@protectMaskHash,@referenceAssetIds,@referenceSelections,@plan,@error,@createdAt,@updatedAt)").run({ ...record, annotations: json(record.annotations), referenceAssetIds: json(record.referenceAssetIds), referenceSelections: json(record.referenceSelections), plan: record.plan ? json(record.plan) : null, error: record.error ? json(record.error) : null });
    return record;
  }
  public listEditReferenceAssets(sessionId: string): EditReferenceAssetRecord[] { return (this.db.prepare("SELECT * FROM edit_reference_assets WHERE session_id=? ORDER BY created_at ASC").all(sessionId) as Row[]).map(mapEditReferenceAsset); }
  public createEditReferenceAsset(input: Omit<EditReferenceAssetRecord, "createdAt">): EditReferenceAssetRecord { const record = { ...input, createdAt: now() }; this.db.prepare("INSERT INTO edit_reference_assets (id,project_id,session_id,turn_id,storage_path,hash,original_name,mime_type,purpose,created_at,expires_at) VALUES (@id,@projectId,@sessionId,@turnId,@storagePath,@hash,@originalName,@mimeType,@purpose,@createdAt,@expiresAt)").run(record); return record; }
  public getEditReferenceAsset(id: string): EditReferenceAssetRecord | undefined { const row = this.db.prepare("SELECT * FROM edit_reference_assets WHERE id=?").get(id); return row ? mapEditReferenceAsset(row as Row) : undefined; }
  public deleteEditReferenceAsset(id: string): void { this.db.prepare("DELETE FROM edit_reference_assets WHERE id=?").run(id); }
  public attachEditReferenceAssets(sessionId: string, turnId: string, ids: string[]): void {
    if (!ids.length) return;
    const statement = this.db.prepare("UPDATE edit_reference_assets SET turn_id=? WHERE id=? AND session_id=? AND turn_id IS NULL");
    const transaction = this.db.transaction(() => { for (const id of ids) statement.run(turnId, id, sessionId); });
    transaction();
  }
  public listExpiredEditReferenceAssets(at = now()): EditReferenceAssetRecord[] { return (this.db.prepare("SELECT * FROM edit_reference_assets WHERE expires_at <= ?").all(at) as Row[]).map(mapEditReferenceAsset); }
  public updateEditTurn(id: string, patch: Partial<Pick<EditTurnRecord, "status" | "plan" | "error">>): EditTurnRecord | undefined {
    const current = this.getEditTurn(id); if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: now() };
    this.db.prepare("UPDATE edit_turns SET status=@status,plan_json=@plan,error_json=@error,updated_at=@updatedAt WHERE id=@id").run({ ...next, plan: next.plan ? json(next.plan) : null, error: next.error ? json(next.error) : null });
    return next;
  }
}

function mapEditSession(row: Row): EditSessionRecord { return { id: String(row.id), projectId: String(row.project_id), currentOutputId: String(row.current_output_id), status: row.status as EditSessionStatus, memorySummary: parse(row.memory_summary_json ?? "{}"), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapEditTurn(row: Row): EditTurnRecord { const ids = parse(row.reference_asset_ids_json ?? "[]") as string[]; const selections = parse(row.reference_selections_json ?? "[]") as ReferenceSelection[]; return { id: String(row.id), sessionId: String(row.session_id), projectId: String(row.project_id), baseOutputId: String(row.base_output_id), status: row.status as EditTurnStatus, message: String(row.message), annotations: parse(row.annotations_json ?? "{}"), editMaskPath: row.edit_mask_path ? String(row.edit_mask_path) : null, editMaskHash: row.edit_mask_hash ? String(row.edit_mask_hash) : null, protectMaskPath: row.protect_mask_path ? String(row.protect_mask_path) : null, protectMaskHash: row.protect_mask_hash ? String(row.protect_mask_hash) : null, referenceAssetIds: ids, referenceSelections: selections.length ? selections : ids.map((id, order) => ({ id, source: "PROJECT", purpose: "PRODUCT_APPEARANCE", order })), plan: row.plan_json ? parse(row.plan_json) : null, error: row.error_json ? parse(row.error_json) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapEditReferenceAsset(row: Row): EditReferenceAssetRecord { return { id: String(row.id), projectId: String(row.project_id), sessionId: String(row.session_id), turnId: row.turn_id ? String(row.turn_id) : null, storagePath: String(row.storage_path), hash: String(row.hash), originalName: String(row.original_name), mimeType: String(row.mime_type), purpose: row.purpose as ReferencePurpose, createdAt: String(row.created_at), expiresAt: String(row.expires_at) }; }
