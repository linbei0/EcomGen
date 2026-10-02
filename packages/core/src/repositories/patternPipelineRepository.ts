import { randomUUID } from "node:crypto";
import type {
  ListingPlatform,
  PatternPipelineBlockReason,
  PatternPipelineStatus,
  PatternPipelineStepName,
  PatternPipelineStepStatus,
  PodPrintLayout,
  PodRepeatLayout,
} from "@ecomgen/contracts";
import type { SqliteDatabase } from "../database.js";
import { type Row, json, now, parse } from "./internal.js";

/** 成包流水线：一次「图案 × 品类规格 × 平台」的串联执行；步骤各自对应一个任务行。 */
export interface PatternPipelineRecord {
  id: string;
  /** SOURCE 步骤完成后回填；从既有花型起链时创建即有值。 */
  patternId: string | null;
  specId: string;
  specVersion: string;
  layout: PodPrintLayout;
  /** 平铺排列（仅 layout=TILE 生效）；创建时缺省直排，裁决出口 USE_MIRROR 改写为 MIRROR。 */
  repeatLayout: PodRepeatLayout;
  listingPlatform: ListingPlatform;
  listingProviderId: string;
  listingModelId: string;
  listingHints: { sellingPoints: string | null; bannedWords: string | null };
  status: PatternPipelineStatus;
  /** AWAITING_INPUT 的原因，其它状态为 null。 */
  blockReason: PatternPipelineBlockReason | null;
  requestFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 流水线步骤；position 决定推进顺序，job_id 是 worker 从完成任务反查流水线的唯一键。 */
export interface PatternPipelineStepRecord {
  id: string;
  pipelineId: string;
  step: PatternPipelineStepName;
  position: number;
  status: PatternPipelineStepStatus;
  jobId: string | null;
  /** 步骤补充事实（验缝分数、接缝风险提示等），不参与状态机。 */
  detail: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** 流水线及其步骤（API 序列化用；步骤按 position 升序）。 */
export interface PatternPipelineWithSteps extends PatternPipelineRecord {
  steps: PatternPipelineStepRecord[];
}

export class PatternPipelineRepository {
  public constructor(private readonly db: SqliteDatabase) { }

  /**
   * 建一条流水线及其全部步骤（同一事务，避免出现没有步骤的流水线）。
   * 步骤由调用方给出（见 pattern-pipeline.ts 的 pipelineStepPlan）：从来源动作起链时含 SOURCE，
   * 从既有花型起链时跳过它。首步若要立刻开跑，由调用方在建好后调 createPipelineStepJob 并入队。
   */
  public createPatternPipeline(input: Omit<PatternPipelineRecord, "id" | "createdAt" | "updatedAt" | "status" | "blockReason"> & { steps: Array<Pick<PatternPipelineStepRecord, "step" | "position">> }): PatternPipelineWithSteps {
    const record: PatternPipelineRecord = { ...input, status: "QUEUED", blockReason: null, id: randomUUID(), createdAt: now(), updatedAt: now() };
    const steps: PatternPipelineStepRecord[] = input.steps.map((step) => ({ ...step, id: randomUUID(), pipelineId: record.id, status: "PENDING", jobId: null, detail: null, error: null, createdAt: record.createdAt, updatedAt: record.updatedAt }));
    const insertPipeline = this.db.prepare(`INSERT INTO pattern_pipelines (id,pattern_id,spec_id,spec_version,layout,repeat_layout,listing_platform,listing_provider_id,listing_model_id,listing_hints_json,status,block_reason,request_fingerprint,created_at,updated_at)
      VALUES (@id,@patternId,@specId,@specVersion,@layout,@repeatLayout,@listingPlatform,@listingProviderId,@listingModelId,@listingHints,@status,@blockReason,@requestFingerprint,@createdAt,@updatedAt)`);
    const insertStep = this.db.prepare(`INSERT INTO pattern_pipeline_steps (id,pipeline_id,step,position,status,job_id,detail_json,error_json,created_at,updated_at)
      VALUES (@id,@pipelineId,@step,@position,@status,@jobId,@detail,@error,@createdAt,@updatedAt)`);
    const write = this.db.transaction(() => {
      insertPipeline.run({ ...record, listingHints: json(record.listingHints) });
      for (const step of steps) insertStep.run({ ...step, detail: null, error: null });
    });
    write();
    return { ...record, steps };
  }
  public listPatternPipelines(patternId: string): PatternPipelineWithSteps[] {
    const rows = this.db.prepare("SELECT * FROM pattern_pipelines WHERE pattern_id=? ORDER BY created_at DESC, id DESC").all(patternId) as Row[];
    return rows.map((row) => this.withSteps(mapPatternPipeline(row)));
  }
  public getPatternPipeline(id: string): PatternPipelineWithSteps | undefined {
    const row = this.db.prepare("SELECT * FROM pattern_pipelines WHERE id=?").get(id);
    return row ? this.withSteps(mapPatternPipeline(row as Row)) : undefined;
  }
  /** 进行中的同参数流水线复用依据；已完成的不复用（用户重跑是有意义的意图，不该被静默吞掉）。 */
  public findReusablePatternPipeline(fingerprint: string): PatternPipelineWithSteps | undefined {
    const row = this.db.prepare("SELECT * FROM pattern_pipelines WHERE request_fingerprint=? AND status IN ('QUEUED','RUNNING','AWAITING_INPUT') ORDER BY created_at DESC, id DESC LIMIT 1").get(fingerprint);
    return row ? this.withSteps(mapPatternPipeline(row as Row)) : undefined;
  }
  public updatePatternPipeline(id: string, patch: Partial<Pick<PatternPipelineRecord, "status" | "blockReason" | "patternId" | "layout" | "repeatLayout">>): PatternPipelineWithSteps | undefined {
    const current = this.getPatternPipeline(id);
    if (!current) return undefined;
    const record = { ...current, ...patch, updatedAt: now() };
    this.db.prepare("UPDATE pattern_pipelines SET pattern_id=@patternId,layout=@layout,repeat_layout=@repeatLayout,status=@status,block_reason=@blockReason,updated_at=@updatedAt WHERE id=@id")
      .run({ id, patternId: record.patternId, layout: record.layout, repeatLayout: record.repeatLayout, status: record.status, blockReason: record.blockReason, updatedAt: record.updatedAt });
    return { ...current, patternId: record.patternId, layout: record.layout, repeatLayout: record.repeatLayout, status: record.status, blockReason: record.blockReason, updatedAt: record.updatedAt };
  }
  /** worker 从完成的任务反查流水线步骤；job_id 上有唯一索引，一条任务最多属于一个步骤。 */
  public getPatternPipelineStepByJobId(jobId: string): PatternPipelineStepRecord | undefined {
    const row = this.db.prepare("SELECT * FROM pattern_pipeline_steps WHERE job_id=?").get(jobId);
    return row ? mapPatternPipelineStep(row as Row) : undefined;
  }
  public updatePatternPipelineStep(id: string, patch: Partial<Pick<PatternPipelineStepRecord, "status" | "jobId" | "detail" | "error">>): PatternPipelineStepRecord | undefined {
    const row = this.db.prepare("SELECT * FROM pattern_pipeline_steps WHERE id=?").get(id);
    if (!row) return undefined;
    const record: PatternPipelineStepRecord = { ...mapPatternPipelineStep(row as Row), ...patch, updatedAt: now() };
    this.db.prepare("UPDATE pattern_pipeline_steps SET status=@status,job_id=@jobId,detail_json=@detail,error_json=@error,updated_at=@updatedAt WHERE id=@id")
      .run({ id, status: record.status, jobId: record.jobId, detail: record.detail ? json(record.detail) : null, error: record.error ? json(record.error) : null, updatedAt: record.updatedAt });
    return record;
  }

  private withSteps(pipeline: PatternPipelineRecord): PatternPipelineWithSteps {
    const rows = this.db.prepare("SELECT * FROM pattern_pipeline_steps WHERE pipeline_id=? ORDER BY position ASC, id ASC").all(pipeline.id) as Row[];
    return { ...pipeline, steps: rows.map(mapPatternPipelineStep) };
  }
}

function mapPatternPipeline(row: Row): PatternPipelineRecord {
  const hints = row.listing_hints_json ? parse(row.listing_hints_json) as { sellingPoints?: string | null; bannedWords?: string | null } : {};
  return {
    id: String(row.id),
    patternId: row.pattern_id == null ? null : String(row.pattern_id),
    specId: String(row.spec_id),
    specVersion: String(row.spec_version),
    layout: row.layout as PodPrintLayout,
    repeatLayout: row.repeat_layout as PodRepeatLayout,
    listingPlatform: row.listing_platform as ListingPlatform,
    listingProviderId: String(row.listing_provider_id),
    listingModelId: String(row.listing_model_id),
    listingHints: { sellingPoints: hints.sellingPoints ?? null, bannedWords: hints.bannedWords ?? null },
    status: row.status as PatternPipelineStatus,
    blockReason: row.block_reason == null ? null : String(row.block_reason) as PatternPipelineBlockReason,
    requestFingerprint: row.request_fingerprint == null ? null : String(row.request_fingerprint),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
function mapPatternPipelineStep(row: Row): PatternPipelineStepRecord {
  return {
    id: String(row.id),
    pipelineId: String(row.pipeline_id),
    step: String(row.step) as PatternPipelineStepName,
    position: Number(row.position),
    status: String(row.status) as PatternPipelineStepStatus,
    jobId: row.job_id == null ? null : String(row.job_id),
    detail: row.detail_json ? parse(row.detail_json) : null,
    error: row.error_json ? parse(row.error_json) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
