import { randomUUID } from "node:crypto";
import type { AssetRole, JobStatus, JobType, ModelDefinition, OutputReviewDecision, PlatformTarget, StoryboardMode } from "@ecomgen/contracts";
import type { SqliteDatabase } from "./database.js";

export interface ProviderRecord {
  id: string;
  name: string;
  baseUrl: string;
  encryptedApiKey: string;
  models: ModelDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  category: string | null;
  productDescription: string | null;
  verifiedFacts: string[];
  prohibitedClaims: string[];
  brandGuidelines: Record<string, string>;
  platformTargets: PlatformTarget[];
  reasoningProviderId: string;
  reasoningModelId: string;
  imageProviderId: string;
  imageModelId: string;
  defaultMode: StoryboardMode;
  createdAt: string;
  updatedAt: string;
}

export interface VariantRecord { id: string; projectId: string; name: string; attributes: Record<string, string>; createdAt: string; }
export interface AssetRecord {
  id: string; projectId: string; variantId: string | null; role: AssetRole; storagePath: string; hash: string;
  originalName: string; mimeType: string; width: number | null; height: number | null; createdAt: string;
}
export interface StoryboardRecord { projectId: string; version: number; status: "DRAFT" | "CONFIRMED"; campaignStyleLock: string; createdAt: string; updatedAt: string; }
export interface StoryboardItemRecord {
  id: string; projectId: string; storyboardVersion: number; assetType: string; templateVariant: string | null; variantScope: string; mode: StoryboardMode;
  status: "DRAFT" | "READY" | "GENERATING" | "COMPLETED"; promptInstruction: string; compiledPrompt: string | null;
  factClaims: string[]; riskFlags: string[]; sortOrder: number; createdAt: string; updatedAt: string;
}
export interface JobRecord {
  id: string; projectId: string; storyboardItemId: string | null; type: JobType; status: JobStatus; progress: number; retryable: boolean;
  input: Record<string, unknown>; requestFingerprint: string | null; providerId: string | null; modelId: string | null;
  estimatedCost: Record<string, unknown> | null; actualCost: Record<string, unknown> | null; cancelRequested: boolean;
  providerTaskId: string | null; error: Record<string, unknown> | null; createdAt: string; updatedAt: string;
}
export interface OutputRecord {
  id: string; projectId: string; storyboardItemId: string; jobId: string; storagePath: string; hash: string;
  reviewDecision: OutputReviewDecision; reviewNote: string | null; createdAt: string;
}
export interface ExportRecord { id: string; projectId: string; jobId: string; status: string; storagePath: string | null; createdAt: string; updatedAt: string; }

type Row = Record<string, unknown>;
const now = (): string => new Date().toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;

export class EcomRepository {
  public constructor(private readonly db: SqliteDatabase) {}

  public listProviders(): ProviderRecord[] { return (this.db.prepare("SELECT * FROM providers ORDER BY created_at DESC").all() as Row[]).map(mapProvider); }
  public getProvider(id: string): ProviderRecord | undefined { const row = this.db.prepare("SELECT * FROM providers WHERE id = ?").get(id); return row ? mapProvider(row as Row) : undefined; }
  public saveProvider(input: Omit<ProviderRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }): ProviderRecord {
    const existing = input.id ? this.getProvider(input.id) : undefined;
    const record: ProviderRecord = { ...input, id: input.id ?? randomUUID(), createdAt: existing?.createdAt ?? now(), updatedAt: now() };
    this.db.prepare(`INSERT INTO providers (id,name,base_url,encrypted_api_key,models_json,created_at,updated_at)
      VALUES (@id,@name,@baseUrl,@encryptedApiKey,@models,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,encrypted_api_key=excluded.encrypted_api_key,models_json=excluded.models_json,updated_at=excluded.updated_at`)
      .run({ ...record, models: json(record.models) });
    return record;
  }
  public deleteProvider(id: string): "deleted" | "in_use" | "missing" {
    if (!this.getProvider(id)) return "missing";
    const usage = this.db.prepare("SELECT COUNT(*) AS count FROM projects WHERE reasoning_provider_id=? OR image_provider_id=?").get(id) as { count: number };
    if (usage.count > 0) return "in_use";
    this.db.prepare("DELETE FROM providers WHERE id=?").run(id); return "deleted";
  }

  public listProjects(): ProjectRecord[] { return (this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as Row[]).map(mapProject); }
  public getProject(id: string): ProjectRecord | undefined { const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id); return row ? mapProject(row as Row) : undefined; }
  public createProject(input: Omit<ProjectRecord, "id" | "createdAt" | "updatedAt">): ProjectRecord {
    const record: ProjectRecord = { ...input, id: randomUUID(), createdAt: now(), updatedAt: now() };
    this.db.prepare(`INSERT INTO projects (id,name,category,product_description,verified_facts_json,prohibited_claims_json,brand_guidelines_json,platform_targets_json,reasoning_provider_id,reasoning_model_id,image_provider_id,image_model_id,default_mode,created_at,updated_at)
      VALUES (@id,@name,@category,@productDescription,@verifiedFacts,@prohibitedClaims,@brandGuidelines,@platformTargets,@reasoningProviderId,@reasoningModelId,@imageProviderId,@imageModelId,@defaultMode,@createdAt,@updatedAt)`)
      .run({ ...record, platformTargets: json(record.platformTargets), verifiedFacts: json(record.verifiedFacts), prohibitedClaims: json(record.prohibitedClaims), brandGuidelines: json(record.brandGuidelines) });
    return record;
  }
  public updateProject(id: string, patch: Partial<Omit<ProjectRecord, "id" | "createdAt">>): ProjectRecord | undefined {
    const current = this.getProject(id); if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: now() };
    this.db.prepare(`UPDATE projects SET name=@name,category=@category,product_description=@productDescription,verified_facts_json=@verifiedFacts,prohibited_claims_json=@prohibitedClaims,brand_guidelines_json=@brandGuidelines,platform_targets_json=@platformTargets,reasoning_provider_id=@reasoningProviderId,reasoning_model_id=@reasoningModelId,image_provider_id=@imageProviderId,image_model_id=@imageModelId,default_mode=@defaultMode,updated_at=@updatedAt WHERE id=@id`)
      .run({ ...next, platformTargets: json(next.platformTargets), verifiedFacts: json(next.verifiedFacts), prohibitedClaims: json(next.prohibitedClaims), brandGuidelines: json(next.brandGuidelines) });
    return next;
  }

  public listVariants(projectId: string): VariantRecord[] { return (this.db.prepare("SELECT * FROM variants WHERE project_id=? ORDER BY created_at").all(projectId) as Row[]).map(mapVariant); }
  public createVariant(projectId: string, name: string, attributes: Record<string, string>): VariantRecord {
    const record: VariantRecord = { id: randomUUID(), projectId, name, attributes, createdAt: now() };
    this.db.prepare("INSERT INTO variants (id,project_id,name,attributes_json,created_at) VALUES (@id,@projectId,@name,@attributes,@createdAt)").run({ ...record, attributes: json(attributes) });
    return record;
  }
  public getVariant(id: string): VariantRecord | undefined { const row = this.db.prepare("SELECT * FROM variants WHERE id=?").get(id); return row ? mapVariant(row as Row) : undefined; }

  public listAssets(projectId: string): AssetRecord[] { return (this.db.prepare("SELECT * FROM assets WHERE project_id=? ORDER BY created_at").all(projectId) as Row[]).map(mapAsset); }
  public getAsset(id: string): AssetRecord | undefined { const row = this.db.prepare("SELECT * FROM assets WHERE id=?").get(id); return row ? mapAsset(row as Row) : undefined; }
  public createAsset(input: Omit<AssetRecord, "id" | "createdAt">): AssetRecord {
    const record: AssetRecord = { ...input, id: randomUUID(), createdAt: now() };
    this.db.prepare(`INSERT INTO assets (id,project_id,variant_id,role,storage_path,hash,original_name,mime_type,width,height,created_at)
      VALUES (@id,@projectId,@variantId,@role,@storagePath,@hash,@originalName,@mimeType,@width,@height,@createdAt)`).run(record);
    return record;
  }

  public getStoryboard(projectId: string): StoryboardRecord | undefined { const row = this.db.prepare("SELECT * FROM storyboards WHERE project_id=?").get(projectId); return row ? mapStoryboard(row as Row) : undefined; }
  public saveStoryboard(projectId: string, campaignStyleLock: string, status: StoryboardRecord["status"], items: Array<Omit<StoryboardItemRecord, "id" | "projectId" | "storyboardVersion" | "createdAt" | "updatedAt">>): StoryboardRecord {
    const previous = this.getStoryboard(projectId);
    const storyboard: StoryboardRecord = { projectId, version: (previous?.version ?? 0) + 1, status, campaignStyleLock, createdAt: previous?.createdAt ?? now(), updatedAt: now() };
    const write = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO storyboards (project_id,version,status,campaign_style_lock,created_at,updated_at) VALUES (@projectId,@version,@status,@campaignStyleLock,@createdAt,@updatedAt)
        ON CONFLICT(project_id) DO UPDATE SET version=excluded.version,status=excluded.status,campaign_style_lock=excluded.campaign_style_lock,updated_at=excluded.updated_at`).run(storyboard);
      this.db.prepare("DELETE FROM storyboard_items WHERE project_id=?").run(projectId);
      const insert = this.db.prepare(`INSERT INTO storyboard_items (id,project_id,storyboard_version,asset_type,template_variant,variant_scope,mode,status,prompt_instruction,compiled_prompt,fact_claims_json,risk_flags_json,sort_order,created_at,updated_at)
        VALUES (@id,@projectId,@storyboardVersion,@assetType,@templateVariant,@variantScope,@mode,@status,@promptInstruction,@compiledPrompt,@factClaims,@riskFlags,@sortOrder,@createdAt,@updatedAt)`);
      items.forEach((item, index) => insert.run({ ...item, id: randomUUID(), projectId, storyboardVersion: storyboard.version, sortOrder: item.sortOrder ?? index, factClaims: json(item.factClaims), riskFlags: json(item.riskFlags), createdAt: storyboard.updatedAt, updatedAt: storyboard.updatedAt }));
    }); write(); return storyboard;
  }
  public listStoryboardItems(projectId: string): StoryboardItemRecord[] { return (this.db.prepare("SELECT * FROM storyboard_items WHERE project_id=? ORDER BY sort_order").all(projectId) as Row[]).map(mapStoryboardItem); }
  public getStoryboardItem(id: string): StoryboardItemRecord | undefined { const row = this.db.prepare("SELECT * FROM storyboard_items WHERE id=?").get(id); return row ? mapStoryboardItem(row as Row) : undefined; }
  public updateStoryboardItem(id: string, patch: Partial<Pick<StoryboardItemRecord, "assetType" | "templateVariant" | "variantScope" | "mode" | "promptInstruction" | "compiledPrompt" | "status" | "sortOrder" | "factClaims" | "riskFlags">>): StoryboardItemRecord | undefined {
    const current = this.getStoryboardItem(id); if (!current) return undefined; const next = { ...current, ...patch, updatedAt: now() };
    this.db.prepare(`UPDATE storyboard_items SET asset_type=@assetType,template_variant=@templateVariant,variant_scope=@variantScope,mode=@mode,status=@status,prompt_instruction=@promptInstruction,compiled_prompt=@compiledPrompt,fact_claims_json=@factClaims,risk_flags_json=@riskFlags,sort_order=@sortOrder,updated_at=@updatedAt WHERE id=@id`)
      .run({ ...next, factClaims: json(next.factClaims), riskFlags: json(next.riskFlags) }); return next;
  }
  public confirmStoryboard(projectId: string): StoryboardRecord | undefined { const current = this.getStoryboard(projectId); if (!current) return undefined; this.db.prepare("UPDATE storyboards SET status='CONFIRMED',updated_at=? WHERE project_id=?").run(now(), projectId); return this.getStoryboard(projectId); }

  public createJob(input: Omit<JobRecord, "createdAt" | "updatedAt" | "progress" | "status" | "retryable" | "providerTaskId" | "error" | "requestFingerprint" | "providerId" | "modelId" | "estimatedCost" | "actualCost" | "cancelRequested"> & Partial<Pick<JobRecord, "status" | "progress" | "retryable" | "providerTaskId" | "error" | "requestFingerprint" | "providerId" | "modelId" | "estimatedCost" | "actualCost" | "cancelRequested">>): JobRecord {
    const record: JobRecord = { ...input, status: input.status ?? "QUEUED", progress: input.progress ?? 0, retryable: input.retryable ?? true, requestFingerprint: input.requestFingerprint ?? null, providerId: input.providerId ?? null, modelId: input.modelId ?? null, estimatedCost: input.estimatedCost ?? null, actualCost: input.actualCost ?? null, cancelRequested: input.cancelRequested ?? false, providerTaskId: input.providerTaskId ?? null, error: input.error ?? null, createdAt: now(), updatedAt: now() };
    this.db.prepare(`INSERT INTO jobs (id,project_id,storyboard_item_id,type,status,progress,retryable,input_json,request_fingerprint,provider_id,model_id,estimated_cost_json,actual_cost_json,cancel_requested,provider_task_id,error_json,created_at,updated_at)
      VALUES (@id,@projectId,@storyboardItemId,@type,@status,@progress,@retryable,@input,@requestFingerprint,@providerId,@modelId,@estimatedCost,@actualCost,@cancelRequested,@providerTaskId,@error,@createdAt,@updatedAt)`).run({ ...record, retryable: record.retryable ? 1 : 0, cancelRequested: record.cancelRequested ? 1 : 0, input: json(record.input), estimatedCost: record.estimatedCost ? json(record.estimatedCost) : null, actualCost: record.actualCost ? json(record.actualCost) : null, error: record.error ? json(record.error) : null }); return record;
  }
  public getJob(id: string): JobRecord | undefined { const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id); return row ? mapJob(row as Row) : undefined; }
  public updateJob(id: string, patch: Partial<Pick<JobRecord, "status" | "progress" | "providerTaskId" | "error" | "retryable" | "actualCost" | "cancelRequested">>): JobRecord | undefined {
    const current = this.getJob(id); if (!current) return undefined; const next = { ...current, ...patch, updatedAt: now() };
    this.db.prepare("UPDATE jobs SET status=@status,progress=@progress,retryable=@retryable,provider_task_id=@providerTaskId,error_json=@error,actual_cost_json=@actualCost,cancel_requested=@cancelRequested,updated_at=@updatedAt WHERE id=@id")
      .run({ ...next, retryable: next.retryable ? 1 : 0, cancelRequested: next.cancelRequested ? 1 : 0, actualCost: next.actualCost ? json(next.actualCost) : null, error: next.error ? json(next.error) : null }); return next;
  }
  public findJobByFingerprint(projectId: string, fingerprint: string): JobRecord | undefined { const row = this.db.prepare("SELECT * FROM jobs WHERE project_id=? AND request_fingerprint=? AND status IN ('QUEUED','RUNNING','SUCCEEDED') ORDER BY created_at DESC LIMIT 1").get(projectId, fingerprint); return row ? mapJob(row as Row) : undefined; }
  public recoverInterruptedJobs(): JobRecord[] { const rows = this.db.prepare("SELECT * FROM jobs WHERE status='RUNNING'").all() as Row[]; this.db.prepare("UPDATE jobs SET status='QUEUED',progress=0,cancel_requested=0,updated_at=? WHERE status='RUNNING'").run(now()); return rows.map((row) => mapJob({ ...row, status: "QUEUED", progress: 0, cancel_requested: 0 })); }
  public listJobs(projectId: string): JobRecord[] { return (this.db.prepare("SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC").all(projectId) as Row[]).map(mapJob); }

  public createOutput(input: Omit<OutputRecord, "id" | "createdAt">): OutputRecord { const record = { ...input, id: randomUUID(), createdAt: now() }; this.db.prepare("INSERT INTO outputs (id,project_id,storyboard_item_id,job_id,storage_path,hash,review_decision,review_note,created_at) VALUES (@id,@projectId,@storyboardItemId,@jobId,@storagePath,@hash,@reviewDecision,@reviewNote,@createdAt)").run(record); return record; }
  public getOutput(id: string): OutputRecord | undefined { const row = this.db.prepare("SELECT * FROM outputs WHERE id=?").get(id); return row ? mapOutput(row as Row) : undefined; }
  public listOutputs(projectId: string): OutputRecord[] { return (this.db.prepare("SELECT * FROM outputs WHERE project_id=? ORDER BY created_at DESC").all(projectId) as Row[]).map(mapOutput); }
  public reviewOutput(id: string, reviewDecision: OutputReviewDecision, reviewNote: string | null): OutputRecord | undefined { const output = this.getOutput(id); if (!output) return undefined; this.db.prepare("UPDATE outputs SET review_decision=?,review_note=? WHERE id=?").run(reviewDecision, reviewNote, id); return this.getOutput(id); }

  public createExport(input: Omit<ExportRecord, "id" | "createdAt" | "updatedAt">): ExportRecord { const record = { ...input, id: randomUUID(), createdAt: now(), updatedAt: now() }; this.db.prepare("INSERT INTO exports (id,project_id,job_id,status,storage_path,created_at,updated_at) VALUES (@id,@projectId,@jobId,@status,@storagePath,@createdAt,@updatedAt)").run(record); return record; }
  public getExport(id: string): ExportRecord | undefined { const row = this.db.prepare("SELECT * FROM exports WHERE id=?").get(id); return row ? mapExport(row as Row) : undefined; }
  public getExportByJobId(jobId: string): ExportRecord | undefined { const row = this.db.prepare("SELECT * FROM exports WHERE job_id=?").get(jobId); return row ? mapExport(row as Row) : undefined; }
  public updateExport(id: string, patch: Partial<Pick<ExportRecord, "status" | "storagePath">>): ExportRecord | undefined { const current = this.getExport(id); if (!current) return undefined; const next = { ...current, ...patch, updatedAt: now() }; this.db.prepare("UPDATE exports SET status=@status,storage_path=@storagePath,updated_at=@updatedAt WHERE id=@id").run(next); return next; }
}

function mapProvider(row: Row): ProviderRecord { return { id: String(row.id), name: String(row.name), baseUrl: String(row.base_url), encryptedApiKey: String(row.encrypted_api_key), models: parse(row.models_json), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapProject(row: Row): ProjectRecord { return { id: String(row.id), name: String(row.name), category: row.category ? String(row.category) : null, productDescription: row.product_description ? String(row.product_description) : null, verifiedFacts: parse(row.verified_facts_json ?? "[]"), prohibitedClaims: parse(row.prohibited_claims_json ?? "[]"), brandGuidelines: parse(row.brand_guidelines_json ?? "{}"), platformTargets: parse(row.platform_targets_json), reasoningProviderId: String(row.reasoning_provider_id), reasoningModelId: String(row.reasoning_model_id), imageProviderId: String(row.image_provider_id), imageModelId: String(row.image_model_id), defaultMode: row.default_mode as StoryboardMode, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapVariant(row: Row): VariantRecord { return { id: String(row.id), projectId: String(row.project_id), name: String(row.name), attributes: parse(row.attributes_json), createdAt: String(row.created_at) }; }
function mapAsset(row: Row): AssetRecord { return { id: String(row.id), projectId: String(row.project_id), variantId: row.variant_id ? String(row.variant_id) : null, role: row.role as AssetRole, storagePath: String(row.storage_path), hash: String(row.hash), originalName: String(row.original_name), mimeType: String(row.mime_type), width: row.width === null ? null : Number(row.width), height: row.height === null ? null : Number(row.height), createdAt: String(row.created_at) }; }
function mapStoryboard(row: Row): StoryboardRecord { return { projectId: String(row.project_id), version: Number(row.version), status: row.status as StoryboardRecord["status"], campaignStyleLock: String(row.campaign_style_lock), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapStoryboardItem(row: Row): StoryboardItemRecord { return { id: String(row.id), projectId: String(row.project_id), storyboardVersion: Number(row.storyboard_version), assetType: String(row.asset_type), templateVariant: row.template_variant ? String(row.template_variant) : null, variantScope: String(row.variant_scope), mode: row.mode as StoryboardMode, status: row.status as StoryboardItemRecord["status"], promptInstruction: String(row.prompt_instruction), compiledPrompt: row.compiled_prompt ? String(row.compiled_prompt) : null, factClaims: parse(row.fact_claims_json), riskFlags: parse(row.risk_flags_json), sortOrder: Number(row.sort_order), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapJob(row: Row): JobRecord { return { id: String(row.id), projectId: String(row.project_id), storyboardItemId: row.storyboard_item_id ? String(row.storyboard_item_id) : null, type: row.type as JobType, status: row.status as JobStatus, progress: Number(row.progress), retryable: Boolean(row.retryable), input: parse(row.input_json), requestFingerprint: row.request_fingerprint ? String(row.request_fingerprint) : null, providerId: row.provider_id ? String(row.provider_id) : null, modelId: row.model_id ? String(row.model_id) : null, estimatedCost: row.estimated_cost_json ? parse(row.estimated_cost_json) : null, actualCost: row.actual_cost_json ? parse(row.actual_cost_json) : null, cancelRequested: Boolean(row.cancel_requested), providerTaskId: row.provider_task_id ? String(row.provider_task_id) : null, error: row.error_json ? parse(row.error_json) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapOutput(row: Row): OutputRecord { return { id: String(row.id), projectId: String(row.project_id), storyboardItemId: String(row.storyboard_item_id), jobId: String(row.job_id), storagePath: String(row.storage_path), hash: String(row.hash), reviewDecision: row.review_decision as OutputReviewDecision, reviewNote: row.review_note ? String(row.review_note) : null, createdAt: String(row.created_at) }; }
function mapExport(row: Row): ExportRecord { return { id: String(row.id), projectId: String(row.project_id), jobId: String(row.job_id), status: String(row.status), storagePath: row.storage_path ? String(row.storage_path) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
