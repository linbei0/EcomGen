import { randomUUID } from "node:crypto";
import type { CopywritingTarget, JobStatus, JobType } from "@ecomgen/contracts";
import type { SqliteDatabase } from "../database.js";
import { type Row, json, now, parse } from "./internal.js";

/** 写入 jobs.provider_task_id 的内部标记：请求已发出但 Provider 尚未返回结果。 */
export const EXTERNAL_REQUEST_STARTED = "__EXTERNAL_REQUEST_STARTED__";

export interface JobRecord {
  id: string;
  /** 全局套图反推任务不绑定项目，projectId 为 null。 */
  projectId: string | null;
  storyboardItemId: string | null;
  type: JobType;
  status: JobStatus;
  progress: number;
  retryable: boolean;
  input: Record<string, unknown>;
  requestFingerprint: string | null;
  providerId: string | null;
  modelId: string | null;
  estimatedCost: Record<string, unknown> | null;
  actualCost: Record<string, unknown> | null;
  cancelRequested: boolean;
  providerTaskId: string | null;
  error: Record<string, unknown> | null;
  /** 运行中任务的进度明细；套图反推用它回报流式观察到的分镜数。 */
  progressDetail: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** AI 帮写结果单独保存，避免把临时文案混入项目配置或通用任务成本字段。 */
export interface CopywritingResultRecord {
  jobId: string;
  projectId: string;
  target: CopywritingTarget;
  content: string;
  createdAt: string;
}

export type WebResearchAvailability = "DISABLED" | "UNAVAILABLE" | "AVAILABLE";
export type WebResearchAttemptStatus = "SUCCEEDED" | "FAILED";

export interface WebResearchAuditRecord {
  jobId: string;
  availability: WebResearchAvailability;
  invocationCount: number;
  successfulAttemptCount: number;
  failedAttemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WebResearchAttemptRecord {
  id: string;
  jobId: string;
  query: string;
  sourceId: string;
  sourceName: string;
  sourceKind: string;
  status: WebResearchAttemptStatus;
  resultCount: number;
  errorMessage: string | null;
  createdAt: string;
}

export class JobRepository {
  public constructor(private readonly db: SqliteDatabase) { }

  public createJob(input: Omit<JobRecord, "createdAt" | "updatedAt" | "progress" | "status" | "retryable" | "providerTaskId" | "error" | "requestFingerprint" | "providerId" | "modelId" | "estimatedCost" | "actualCost" | "cancelRequested" | "progressDetail"> & Partial<Pick<JobRecord, "status" | "progress" | "retryable" | "providerTaskId" | "error" | "requestFingerprint" | "providerId" | "modelId" | "estimatedCost" | "actualCost" | "cancelRequested" | "progressDetail">>): JobRecord {
    const record: JobRecord = { ...input, status: input.status ?? "QUEUED", progress: input.progress ?? 0, retryable: input.retryable ?? true, requestFingerprint: input.requestFingerprint ?? null, providerId: input.providerId ?? null, modelId: input.modelId ?? null, estimatedCost: input.estimatedCost ?? null, actualCost: input.actualCost ?? null, cancelRequested: input.cancelRequested ?? false, providerTaskId: input.providerTaskId ?? null, error: input.error ?? null, progressDetail: input.progressDetail ?? null, createdAt: now(), updatedAt: now() };
    this.db.prepare(`INSERT INTO jobs (id,project_id,storyboard_item_id,type,status,progress,retryable,input_json,request_fingerprint,provider_id,model_id,estimated_cost_json,actual_cost_json,cancel_requested,provider_task_id,error_json,created_at,updated_at)
      VALUES (@id,@projectId,@storyboardItemId,@type,@status,@progress,@retryable,@input,@requestFingerprint,@providerId,@modelId,@estimatedCost,@actualCost,@cancelRequested,@providerTaskId,@error,@createdAt,@updatedAt)`).run({ ...record, retryable: record.retryable ? 1 : 0, cancelRequested: record.cancelRequested ? 1 : 0, input: json(record.input), estimatedCost: record.estimatedCost ? json(record.estimatedCost) : null, actualCost: record.actualCost ? json(record.actualCost) : null, error: record.error ? json(record.error) : null }); return record;
  }
  public getJob(id: string): JobRecord | undefined { const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id); return row ? mapJob(row as Row) : undefined; }
  public updateJob(id: string, patch: Partial<Pick<JobRecord, "status" | "progress" | "providerTaskId" | "error" | "retryable" | "actualCost" | "cancelRequested" | "progressDetail">>): JobRecord | undefined {
    const current = this.getJob(id); if (!current) return undefined; const next = { ...current, ...patch, updatedAt: now() };
    this.db.prepare("UPDATE jobs SET status=@status,progress=@progress,retryable=@retryable,provider_task_id=@providerTaskId,error_json=@error,actual_cost_json=@actualCost,cancel_requested=@cancelRequested,progress_detail_json=@progressDetail,updated_at=@updatedAt WHERE id=@id")
      .run({ ...next, retryable: next.retryable ? 1 : 0, cancelRequested: next.cancelRequested ? 1 : 0, actualCost: next.actualCost ? json(next.actualCost) : null, error: next.error ? json(next.error) : null, progressDetail: next.progressDetail ? json(next.progressDetail) : null }); return next;
  }
  /** 指纹去重同时覆盖项目任务与全局任务：projectId 为 null 时按 project_id IS NULL 匹配。 */
  public findJobByFingerprint(projectId: string | null, fingerprint: string): JobRecord | undefined { const row = this.db.prepare("SELECT * FROM jobs WHERE project_id IS ? AND request_fingerprint=? AND status IN ('QUEUED','RUNNING','SUCCEEDED') ORDER BY created_at DESC LIMIT 1").get(projectId, fingerprint); return row ? mapJob(row as Row) : undefined; }
  /**
   * 崩溃恢复把分层/规格包记录与 Job 同步推进：这是重启事务的一部分，三张伴随表的状态必须与
   * Job 终态在同一事务里改写，拆到各自仓库会让恢复出现"任务已重跑而记录仍 QUEUED"的窗口。
   */
  public recoverInterruptedJobs(): JobRecord[] {
    const rows = this.db.prepare("SELECT * FROM jobs WHERE status='RUNNING'").all() as Row[];
    const recovered = rows.filter((row) => row.provider_task_id !== EXTERNAL_REQUEST_STARTED);
    const unverifiable = rows.filter((row) => row.provider_task_id === EXTERNAL_REQUEST_STARTED);
    const updatedAt = now();
    const unknownMessage = JSON.stringify({ message: "外部图像请求结果未知，已停止自动重试以避免重复计费" });
    const write = this.db.transaction(() => {
      this.db.prepare("UPDATE jobs SET status='QUEUED',progress=0,cancel_requested=0,progress_detail_json=NULL,updated_at=? WHERE status='RUNNING' AND (provider_task_id IS NULL OR provider_task_id<>?)").run(updatedAt, EXTERNAL_REQUEST_STARTED);
      this.db.prepare("UPDATE jobs SET status='FAILED',progress=100,retryable=0,error_json=?,updated_at=? WHERE status='RUNNING' AND provider_task_id=?")
        .run(unknownMessage, updatedAt, EXTERNAL_REQUEST_STARTED);
      // 分层记录必须与 Job 同步进入终态，否则前端会一直看到 QUEUED/RUNNING 而任务其实已被重启或终止。
      for (const row of recovered) {
        this.db.prepare("UPDATE layer_plans SET status='QUEUED',error_json=NULL,updated_at=? WHERE job_id=?").run(updatedAt, row.id);
        this.db.prepare("UPDATE layer_exports SET status='QUEUED',error_json=NULL,updated_at=? WHERE job_id=?").run(updatedAt, row.id);
        // 规格包是纯本地合成，重启后随 Job 重新排队即可；pattern_extract/forge 无预建领域记录。
        this.db.prepare("UPDATE print_packs SET status='QUEUED',error_json=NULL,updated_at=? WHERE job_id=?").run(updatedAt, row.id);
      }
      for (const row of unverifiable) {
        this.db.prepare("UPDATE layer_plans SET status='FAILED',error_json=?,updated_at=? WHERE job_id=?").run(unknownMessage, updatedAt, row.id);
        // 已写出 PSD 的导出记录是完成事实的持久化证据：Job 崩溃在终态写入前也不改判它，PSD 与图层文件仍然可下载。
        this.db.prepare("UPDATE layer_exports SET status='FAILED',error_json=?,updated_at=? WHERE job_id=? AND psd_storage_path IS NULL").run(unknownMessage, updatedAt, row.id);
      }
    });
    write();
    return recovered.map((row) => mapJob({ ...row, status: "QUEUED", progress: 0, cancel_requested: 0 }));
  }
  public listJobs(projectId: string): JobRecord[] { return (this.db.prepare("SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC").all(projectId) as Row[]).map(mapJob); }
  /** 全局套图反推任务不绑定项目，无法走 listJobs；按 type 倒序取最近若干条供「最近反推」列表使用。 */
  public listJobsByType(type: JobType, limit: number): JobRecord[] { return (this.db.prepare("SELECT * FROM jobs WHERE type=? ORDER BY created_at DESC LIMIT ?").all(type, limit) as Row[]).map(mapJob); }
  public saveCopywritingResult(input: Omit<CopywritingResultRecord, "createdAt">): CopywritingResultRecord {
    const record: CopywritingResultRecord = { ...input, createdAt: now() };
    this.db.prepare("INSERT OR REPLACE INTO copywriting_results (job_id,project_id,target,content,created_at) VALUES (@jobId,@projectId,@target,@content,@createdAt)").run(record);
    return record;
  }
  public getCopywritingResult(jobId: string): CopywritingResultRecord | undefined {
    const row = this.db.prepare("SELECT * FROM copywriting_results WHERE job_id=?").get(jobId);
    return row ? mapCopywritingResult(row as Row) : undefined;
  }
  public createWebResearchAudit(jobId: string, availability: WebResearchAvailability): WebResearchAuditRecord {
    const record: WebResearchAuditRecord = { jobId, availability, invocationCount: 0, successfulAttemptCount: 0, failedAttemptCount: 0, createdAt: now(), updatedAt: now() };
    this.db.prepare("INSERT OR REPLACE INTO web_research_audits (job_id,availability,invocation_count,successful_attempt_count,failed_attempt_count,created_at,updated_at) VALUES (@jobId,@availability,@invocationCount,@successfulAttemptCount,@failedAttemptCount,@createdAt,@updatedAt)").run(record);
    return record;
  }
  public recordWebResearchSearch(jobId: string): void {
    this.db.prepare("UPDATE web_research_audits SET invocation_count=invocation_count+1,updated_at=? WHERE job_id=?").run(now(), jobId);
  }
  public recordWebResearchAttempt(input: Omit<WebResearchAttemptRecord, "id" | "createdAt">): WebResearchAttemptRecord {
    const record: WebResearchAttemptRecord = { ...input, id: randomUUID(), createdAt: now() };
    const column = record.status === "SUCCEEDED" ? "successful_attempt_count" : "failed_attempt_count";
    const write = this.db.transaction(() => {
      this.db.prepare("INSERT INTO web_research_attempts (id,job_id,query,source_id,source_name,source_kind,status,result_count,error_message,created_at) VALUES (@id,@jobId,@query,@sourceId,@sourceName,@sourceKind,@status,@resultCount,@errorMessage,@createdAt)").run(record);
      this.db.prepare(`UPDATE web_research_audits SET ${column}=${column}+1,updated_at=? WHERE job_id=?`).run(now(), record.jobId);
    });
    write(); return record;
  }
  public getWebResearchAudit(jobId: string): WebResearchAuditRecord | undefined { const row = this.db.prepare("SELECT * FROM web_research_audits WHERE job_id=?").get(jobId); return row ? mapWebResearchAudit(row as Row) : undefined; }
  /** 审计记录按插入顺序返回，避免同一毫秒内的随机 UUID 改变来源尝试顺序。 */
  public listWebResearchAttempts(jobId: string): WebResearchAttemptRecord[] { return (this.db.prepare("SELECT * FROM web_research_attempts WHERE job_id=? ORDER BY rowid").all(jobId) as Row[]).map(mapWebResearchAttempt); }
}

function mapJob(row: Row): JobRecord { return { id: String(row.id), projectId: row.project_id == null ? null : String(row.project_id), storyboardItemId: row.storyboard_item_id ? String(row.storyboard_item_id) : null, type: row.type as JobType, status: row.status as JobStatus, progress: Number(row.progress), retryable: Boolean(row.retryable), input: parse(row.input_json), requestFingerprint: row.request_fingerprint ? String(row.request_fingerprint) : null, providerId: row.provider_id ? String(row.provider_id) : null, modelId: row.model_id ? String(row.model_id) : null, estimatedCost: row.estimated_cost_json ? parse(row.estimated_cost_json) : null, actualCost: row.actual_cost_json ? parse(row.actual_cost_json) : null, cancelRequested: Boolean(row.cancel_requested), providerTaskId: row.provider_task_id ? String(row.provider_task_id) : null, error: row.error_json ? parse(row.error_json) : null, progressDetail: row.progress_detail_json ? parse(row.progress_detail_json) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapCopywritingResult(row: Row): CopywritingResultRecord { return { jobId: String(row.job_id), projectId: String(row.project_id), target: row.target as CopywritingTarget, content: String(row.content), createdAt: String(row.created_at) }; }
function mapWebResearchAudit(row: Row): WebResearchAuditRecord { return { jobId: String(row.job_id), availability: row.availability as WebResearchAvailability, invocationCount: Number(row.invocation_count), successfulAttemptCount: Number(row.successful_attempt_count), failedAttemptCount: Number(row.failed_attempt_count), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapWebResearchAttempt(row: Row): WebResearchAttemptRecord { return { id: String(row.id), jobId: String(row.job_id), query: String(row.query), sourceId: String(row.source_id), sourceName: String(row.source_name), sourceKind: String(row.source_kind), status: row.status as WebResearchAttemptStatus, resultCount: Number(row.result_count), errorMessage: row.error_message ? String(row.error_message) : null, createdAt: String(row.created_at) }; }
