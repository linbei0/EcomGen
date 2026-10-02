import { randomUUID } from "node:crypto";
import type { SuiteDocumentInput } from "@ecomgen/ecom-suite";
import type { SqliteDatabase } from "../database.js";
import { type Row, json, now } from "./internal.js";

/** 用户自定义提示词模板（简化格式）；ID 形如 custom-xxxxxxxx，由 API 层生成。 */
export interface UserTemplateRecord {
  id: string;
  name: string;
  prompt: string;
  defaultSize: "1024x1024" | "1024x1536";
  supportsImageReference: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 用户导入的套图；payload 保存完整套图文档，索引列用于列表归类与搜索。 */
export interface UserSuiteRecord {
  id: string;
  name: string;
  l1: string;
  l2: string;
  leaf: string;
  productFamily: string | null;
  payload: SuiteDocumentInput;
  createdAt: string;
  updatedAt: string;
}

/** 全局套图反推任务的结果草稿；确认入库后写入 user_suites 并置为 COMMITTED。 */
export type SuiteForgeStatus = "DRAFT" | "COMMITTED";
export interface SuiteForgeResultRecord {
  jobId: string;
  payload: SuiteDocumentInput;
  status: SuiteForgeStatus;
  suiteId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 用户内容域：自定义模板、导入套图与反推草稿共享"由用户产生、可随时增删"的生命周期。 */
export class UserContentRepository {
  public constructor(private readonly db: SqliteDatabase) { }

  public listUserTemplates(): UserTemplateRecord[] {
    return (this.db.prepare("SELECT * FROM user_templates ORDER BY created_at ASC").all() as Row[]).map(mapUserTemplate);
  }
  public getUserTemplate(id: string): UserTemplateRecord | undefined {
    const row = this.db.prepare("SELECT * FROM user_templates WHERE id = ?").get(id);
    return row ? mapUserTemplate(row as Row) : undefined;
  }
  public saveUserTemplate(input: Omit<UserTemplateRecord, "createdAt" | "updatedAt"> & { id?: string }): UserTemplateRecord {
    const existing = input.id ? this.getUserTemplate(input.id) : undefined;
    const record: UserTemplateRecord = { ...input, id: input.id ?? randomUUID(), createdAt: existing?.createdAt ?? now(), updatedAt: now() };
    this.db.prepare(`INSERT INTO user_templates (id,name,prompt,default_size,supports_image_reference,created_at,updated_at)
      VALUES (@id,@name,@prompt,@defaultSize,@supportsImageReference,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,prompt=excluded.prompt,default_size=excluded.default_size,supports_image_reference=excluded.supports_image_reference,updated_at=excluded.updated_at`)
      .run({ ...record, supportsImageReference: record.supportsImageReference ? 1 : 0 });
    return record;
  }
  public deleteUserTemplate(id: string): boolean {
    return this.db.prepare("DELETE FROM user_templates WHERE id=?").run(id).changes > 0;
  }

  public listUserSuites(): UserSuiteRecord[] {
    return (this.db.prepare("SELECT * FROM user_suites ORDER BY created_at ASC").all() as Row[]).map(mapUserSuite);
  }
  public getUserSuite(id: string): UserSuiteRecord | undefined {
    const row = this.db.prepare("SELECT * FROM user_suites WHERE id = ?").get(id);
    return row ? mapUserSuite(row as Row) : undefined;
  }
  public saveUserSuite(input: Omit<UserSuiteRecord, "createdAt" | "updatedAt"> & { id?: string }): UserSuiteRecord {
    const existing = input.id ? this.getUserSuite(input.id) : undefined;
    const record: UserSuiteRecord = { ...input, id: input.id ?? randomUUID(), createdAt: existing?.createdAt ?? now(), updatedAt: now() };
    this.db.prepare(`INSERT INTO user_suites (id,name,l1,l2,leaf,product_family,payload_json,created_at,updated_at)
      VALUES (@id,@name,@l1,@l2,@leaf,@productFamily,@payloadJson,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,l1=excluded.l1,l2=excluded.l2,leaf=excluded.leaf,product_family=excluded.product_family,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .run({
        id: record.id,
        name: record.name,
        l1: record.l1,
        l2: record.l2,
        leaf: record.leaf,
        productFamily: record.productFamily,
        payloadJson: JSON.stringify(record.payload),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      });
    return record;
  }
  public deleteUserSuite(id: string): boolean {
    return this.db.prepare("DELETE FROM user_suites WHERE id=?").run(id).changes > 0;
  }

  /** 套图反推成功即落草稿；重复写同一 job 会覆盖为最新草稿。 */
  public saveSuiteForgeResult(input: { jobId: string; payload: SuiteDocumentInput }): SuiteForgeResultRecord {
    const createdAt = now();
    const record: SuiteForgeResultRecord = { jobId: input.jobId, payload: input.payload, status: "DRAFT", suiteId: null, createdAt, updatedAt: createdAt };
    this.db.prepare(`INSERT INTO suite_forge_results (job_id,payload_json,status,suite_id,created_at,updated_at)
      VALUES (@jobId,@payload,'DRAFT',NULL,@createdAt,@updatedAt)
      ON CONFLICT(job_id) DO UPDATE SET payload_json=excluded.payload_json,status='DRAFT',suite_id=NULL,updated_at=excluded.updated_at`)
      .run({ jobId: record.jobId, payload: json(record.payload), createdAt, updatedAt: createdAt });
    return record;
  }
  public getSuiteForgeResult(jobId: string): SuiteForgeResultRecord | undefined {
    const row = this.db.prepare("SELECT * FROM suite_forge_results WHERE job_id=?").get(jobId);
    return row ? mapSuiteForgeResult(row as Row) : undefined;
  }
  /** 确认入库：记录已写入的 user_suites.id，状态转为 COMMITTED，草稿仍可回看。 */
  public commitSuiteForgeResult(jobId: string, suiteId: string): SuiteForgeResultRecord | undefined {
    const current = this.getSuiteForgeResult(jobId);
    if (!current) return undefined;
    const updatedAt = now();
    this.db.prepare("UPDATE suite_forge_results SET status='COMMITTED',suite_id=?,updated_at=? WHERE job_id=?").run(suiteId, updatedAt, jobId);
    return { ...current, status: "COMMITTED", suiteId, updatedAt };
  }
}

function mapUserTemplate(row: Row): UserTemplateRecord { return { id: String(row.id), name: String(row.name), prompt: String(row.prompt), defaultSize: row.default_size === "1024x1536" ? "1024x1536" : "1024x1024", supportsImageReference: Boolean(row.supports_image_reference), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapUserSuite(row: Row): UserSuiteRecord { return { id: String(row.id), name: String(row.name), l1: String(row.l1), l2: String(row.l2), leaf: String(row.leaf), productFamily: row.product_family == null ? null : String(row.product_family), payload: JSON.parse(String(row.payload_json)) as SuiteDocumentInput, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapSuiteForgeResult(row: Row): SuiteForgeResultRecord { return { jobId: String(row.job_id), payload: JSON.parse(String(row.payload_json)) as SuiteDocumentInput, status: row.status as SuiteForgeStatus, suiteId: row.suite_id == null ? null : String(row.suite_id), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
