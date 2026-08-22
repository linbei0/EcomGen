import { randomUUID } from "node:crypto";
import type {
  AssetRole,
  CopywritingTarget,
  ImageAspectRatio,
  ImageResolution,
  JobStatus,
  JobType,
  ModelDefinition,
  PlatformTarget,
  ReasoningProtocolProfile,
  SearchSourceKind,
  StoryboardMode,
  TargetMarket
} from "@ecomgen/contracts";
import type { EditOperation, EditSessionStatus, EditTurnStatus } from "@ecomgen/contracts";
import type { SqliteDatabase } from "./database.js";

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

export interface ProjectRecord {
  id: string;
  name: string;
  category: string | null;
  productDescription: string | null;
  verifiedFacts: string[];
  prohibitedClaims: string[];
  brandGuidelines: Record<string, string>;
  platformTargets: PlatformTarget[];
  targetMarket: TargetMarket | null;
  copyLanguage: string | null;
  reasoningProviderId: string;
  reasoningModelId: string;
  imageProviderId: string;
  imageModelId: string;
  defaultMode: StoryboardMode;
  imageResolution: ImageResolution;
  imageAspectRatio: ImageAspectRatio;
  candidatesPerType: number;
  webResearchEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

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

export interface StoryboardRecord {
  projectId: string;
  version: number;
  status: "DRAFT" | "CONFIRMED";
  campaignStyleLock: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryboardItemRecord {
  id: string;
  projectId: string;
  storyboardVersion: number;
  assetType: string;
  displayName: string;
  templateVariant: string | null;
  candidateCount: number;
  imageProviderId: string;
  imageModelId: string;
  imageResolution: ImageResolution;
  imageAspectRatio: ImageAspectRatio;
  referencedAssets: string[];
  mode: StoryboardMode;
  status: "DRAFT" | "CONFIRMED" | "GENERATING" | "GENERATED";
  promptInstruction: string;
  compiledPrompt: string | null;
  factClaims: string[];
  riskFlags: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  projectId: string;
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

export interface GenerationSnapshot {
  providerId: string;
  modelId: string;
  resolution: ImageResolution;
  aspectRatio: ImageAspectRatio;
  size: string;
  candidateIndex: number;
  operation?: EditOperation;
  sourceOutputId?: string;
  maskHash?: string | null;
  protectMaskHash?: string | null;
  compositePolicy?: "MASK_LOCKED" | "NATURAL_BLEND" | "OUTPAINT";
}

export interface OutputRecord {
  id: string;
  projectId: string;
  storyboardItemId: string;
  jobId: string;
  candidateIndex: number;
  generationSnapshot: GenerationSnapshot | null;
  storagePath: string;
  hash: string;
  parentOutputId?: string | null;
  rootOutputId?: string | null;
  editSessionId?: string | null;
  editTurnId?: string | null;
  createdAt: string;
}

export interface EditSessionRecord {
  id: string;
  projectId: string;
  currentOutputId: string;
  status: EditSessionStatus;
  memorySummary: { summary?: string; constraints?: string[] };
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
  plan: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportRecord {
  id: string;
  projectId: string;
  jobId: string;
  status: string;
  storagePath: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 首页列表封面：原图取最早 PRODUCT_TRUTH 图片；封面输出取最新输出。 */
export interface ProjectCoverSummary {
  productAssetId: string | null;
  coverOutputId: string | null;
  previewOutputIds: string[];
  outputCount: number;
}

function emptyCover(): ProjectCoverSummary {
  return { productAssetId: null, coverOutputId: null, previewOutputIds: [], outputCount: 0 };
}

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
    this.db.prepare(`INSERT INTO providers (id,name,base_url,reasoning_protocol,encrypted_api_key,models_json,created_at,updated_at)
      VALUES (@id,@name,@baseUrl,@reasoningProtocol,@encryptedApiKey,@models,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,reasoning_protocol=excluded.reasoning_protocol,encrypted_api_key=excluded.encrypted_api_key,models_json=excluded.models_json,updated_at=excluded.updated_at`)
      .run({ ...record, models: json(record.models) });
    return record;
  }
  public deleteProvider(id: string): "deleted" | "in_use" | "missing" {
    if (!this.getProvider(id)) return "missing";
    const usage = this.db.prepare("SELECT COUNT(*) AS count FROM projects WHERE reasoning_provider_id=? OR image_provider_id=?").get(id, id) as { count: number };
    if (usage.count > 0) return "in_use";
    this.db.prepare("DELETE FROM providers WHERE id=?").run(id); return "deleted";
  }

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

  public listProjects(): ProjectRecord[] { return (this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as Row[]).map(mapProject); }
  public listProjectCovers(projectIds: string[]): Map<string, ProjectCoverSummary> {
    const covers = new Map<string, ProjectCoverSummary>();
    for (const id of projectIds) covers.set(id, emptyCover());
    if (projectIds.length === 0) return covers;
    const placeholders = projectIds.map(() => "?").join(",");
    const assetRows = this.db.prepare(
      `SELECT id, project_id FROM assets
       WHERE project_id IN (${placeholders}) AND role='PRODUCT_TRUTH' AND mime_type LIKE 'image/%'
       ORDER BY created_at ASC, id ASC`
    ).all(...projectIds) as Array<{ id: string; project_id: string }>;
    for (const row of assetRows) {
      const cover = covers.get(row.project_id);
      if (cover && cover.productAssetId === null) cover.productAssetId = row.id;
    }
    const outputRows = this.db.prepare(
      `SELECT id, project_id FROM outputs
       WHERE project_id IN (${placeholders})
       ORDER BY created_at DESC, id DESC`
    ).all(...projectIds) as Array<{ id: string; project_id: string }>;
    const grouped = new Map<string, Array<{ id: string }>>();
    for (const row of outputRows) {
      const list = grouped.get(row.project_id) ?? [];
      list.push(row);
      grouped.set(row.project_id, list);
    }
    for (const [projectId, outputs] of grouped) {
      const cover = covers.get(projectId);
      if (!cover) continue;
      cover.outputCount = outputs.length;
      cover.coverOutputId = outputs[0]?.id ?? null;
      cover.previewOutputIds = outputs.filter((output) => output.id !== cover.coverOutputId).slice(0, 2).map((output) => output.id);
    }
    return covers;
  }
  public getProject(id: string): ProjectRecord | undefined { const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id); return row ? mapProject(row as Row) : undefined; }
  public createProject(input: Omit<ProjectRecord, "id" | "createdAt" | "updatedAt" | "webResearchEnabled"> & Partial<Pick<ProjectRecord, "webResearchEnabled">>): ProjectRecord {
    const record: ProjectRecord = { ...input, webResearchEnabled: input.webResearchEnabled ?? false, id: randomUUID(), createdAt: now(), updatedAt: now() };
    this.db.prepare(`INSERT INTO projects (id,name,category,product_description,verified_facts_json,prohibited_claims_json,brand_guidelines_json,platform_targets_json,target_market,copy_language,reasoning_provider_id,reasoning_model_id,image_provider_id,image_model_id,default_mode,image_resolution,image_aspect_ratio,candidates_per_type,web_research_enabled,created_at,updated_at)
      VALUES (@id,@name,@category,@productDescription,@verifiedFacts,@prohibitedClaims,@brandGuidelines,@platformTargets,@targetMarket,@copyLanguage,@reasoningProviderId,@reasoningModelId,@imageProviderId,@imageModelId,@defaultMode,@imageResolution,@imageAspectRatio,@candidatesPerType,@webResearchEnabled,@createdAt,@updatedAt)`)
      .run({ ...record, webResearchEnabled: record.webResearchEnabled ? 1 : 0, platformTargets: json(record.platformTargets), verifiedFacts: json(record.verifiedFacts), prohibitedClaims: json(record.prohibitedClaims), brandGuidelines: json(record.brandGuidelines) });
    return record;
  }
  public updateProject(id: string, patch: Partial<Omit<ProjectRecord, "id" | "createdAt">>): ProjectRecord | undefined {
    const current = this.getProject(id); if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: now() };
    this.db.prepare(`UPDATE projects SET name=@name,category=@category,product_description=@productDescription,verified_facts_json=@verifiedFacts,prohibited_claims_json=@prohibitedClaims,brand_guidelines_json=@brandGuidelines,platform_targets_json=@platformTargets,target_market=@targetMarket,copy_language=@copyLanguage,reasoning_provider_id=@reasoningProviderId,reasoning_model_id=@reasoningModelId,image_provider_id=@imageProviderId,image_model_id=@imageModelId,default_mode=@defaultMode,image_resolution=@imageResolution,image_aspect_ratio=@imageAspectRatio,candidates_per_type=@candidatesPerType,web_research_enabled=@webResearchEnabled,updated_at=@updatedAt WHERE id=@id`)
      .run({ ...next, webResearchEnabled: next.webResearchEnabled ? 1 : 0, platformTargets: json(next.platformTargets), verifiedFacts: json(next.verifiedFacts), prohibitedClaims: json(next.prohibitedClaims), brandGuidelines: json(next.brandGuidelines) });
    return next;
  }

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

  public getStoryboard(projectId: string): StoryboardRecord | undefined { const row = this.db.prepare("SELECT * FROM storyboards WHERE project_id=?").get(projectId); return row ? mapStoryboard(row as Row) : undefined; }
  public saveStoryboard(projectId: string, campaignStyleLock: string, status: StoryboardRecord["status"], items: Array<Omit<StoryboardItemRecord, "id" | "projectId" | "storyboardVersion" | "createdAt" | "updatedAt" | "imageProviderId" | "imageModelId" | "imageResolution" | "imageAspectRatio"> & Partial<Pick<StoryboardItemRecord, "imageProviderId" | "imageModelId" | "imageResolution" | "imageAspectRatio">>>): StoryboardRecord {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project not found for storyboard ${projectId}`);
    const previous = this.getStoryboard(projectId);
    const storyboard: StoryboardRecord = { projectId, version: (previous?.version ?? 0) + 1, status, campaignStyleLock, createdAt: previous?.createdAt ?? now(), updatedAt: now() };
    const write = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO storyboards (project_id,version,status,campaign_style_lock,created_at,updated_at) VALUES (@projectId,@version,@status,@campaignStyleLock,@createdAt,@updatedAt)
        ON CONFLICT(project_id) DO UPDATE SET version=excluded.version,status=excluded.status,campaign_style_lock=excluded.campaign_style_lock,updated_at=excluded.updated_at`).run(storyboard);
      const sortOffset = Number((this.db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM storyboard_items WHERE project_id=?").get(projectId) as { value: number }).value) + 1;
      const insert = this.db.prepare(`INSERT INTO storyboard_items (id,project_id,storyboard_version,asset_type,display_name,template_variant,candidate_count,image_provider_id,image_model_id,image_resolution,image_aspect_ratio,referenced_assets_json,mode,status,prompt_instruction,compiled_prompt,fact_claims_json,risk_flags_json,sort_order,created_at,updated_at)
        VALUES (@id,@projectId,@storyboardVersion,@assetType,@displayName,@templateVariant,@candidateCount,@imageProviderId,@imageModelId,@imageResolution,@imageAspectRatio,@referencedAssets,@mode,@status,@promptInstruction,@compiledPrompt,@factClaims,@riskFlags,@sortOrder,@createdAt,@updatedAt)`);
      items.forEach((item, index) => insert.run({
        ...item,
        imageProviderId: item.imageProviderId ?? project.imageProviderId,
        imageModelId: item.imageModelId ?? project.imageModelId,
        imageResolution: item.imageResolution ?? project.imageResolution,
        imageAspectRatio: item.imageAspectRatio ?? project.imageAspectRatio,
        id: randomUUID(),
        projectId,
        storyboardVersion: storyboard.version,
        sortOrder: sortOffset + (item.sortOrder ?? index),
        referencedAssets: json(item.referencedAssets),
        factClaims: json(item.factClaims),
        riskFlags: json(item.riskFlags),
        createdAt: storyboard.updatedAt,
        updatedAt: storyboard.updatedAt
      }));
    }); write(); return storyboard;
  }
  public listStoryboardItems(projectId: string): StoryboardItemRecord[] { return (this.db.prepare("SELECT * FROM storyboard_items WHERE project_id=? ORDER BY sort_order").all(projectId) as Row[]).map(mapStoryboardItem); }
  public getStoryboardItem(id: string): StoryboardItemRecord | undefined { const row = this.db.prepare("SELECT * FROM storyboard_items WHERE id=?").get(id); return row ? mapStoryboardItem(row as Row) : undefined; }
  public deleteStoryboardItem(id: string): StoryboardItemRecord | undefined {
    const row = this.db.prepare("SELECT * FROM storyboard_items WHERE id=?").get(id);
    if (!row) return undefined;
    this.db.prepare("DELETE FROM storyboard_items WHERE id=?").run(id);
    return mapStoryboardItem(row as Row);
  }
  public updateStoryboardItem(id: string, patch: Partial<Pick<StoryboardItemRecord, "assetType" | "displayName" | "templateVariant" | "candidateCount" | "imageProviderId" | "imageModelId" | "imageResolution" | "imageAspectRatio" | "referencedAssets" | "mode" | "promptInstruction" | "compiledPrompt" | "status" | "sortOrder" | "factClaims" | "riskFlags">>): StoryboardItemRecord | undefined {
    const current = this.getStoryboardItem(id); if (!current) return undefined; const next = { ...current, ...patch, updatedAt: now() };
    this.db.prepare(`UPDATE storyboard_items SET asset_type=@assetType,display_name=@displayName,template_variant=@templateVariant,candidate_count=@candidateCount,image_provider_id=@imageProviderId,image_model_id=@imageModelId,image_resolution=@imageResolution,image_aspect_ratio=@imageAspectRatio,referenced_assets_json=@referencedAssets,mode=@mode,status=@status,prompt_instruction=@promptInstruction,compiled_prompt=@compiledPrompt,fact_claims_json=@factClaims,risk_flags_json=@riskFlags,sort_order=@sortOrder,updated_at=@updatedAt WHERE id=@id`)
      .run({ ...next, referencedAssets: json(next.referencedAssets), factClaims: json(next.factClaims), riskFlags: json(next.riskFlags) }); return next;
  }
  public confirmStoryboard(projectId: string): StoryboardRecord | undefined {
    const current = this.getStoryboard(projectId); if (!current) return undefined;
    const updatedAt = now();
    const write = this.db.transaction(() => {
      this.db.prepare("UPDATE storyboards SET status='CONFIRMED',updated_at=? WHERE project_id=?").run(updatedAt, projectId);
      this.db.prepare("UPDATE storyboard_items SET status='CONFIRMED',updated_at=? WHERE project_id=? AND status='DRAFT'").run(updatedAt, projectId);
    });
    write(); return this.getStoryboard(projectId);
  }

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

  public createOutput(input: Omit<OutputRecord, "id" | "createdAt">): OutputRecord {
    const record: OutputRecord = { ...input, parentOutputId: input.parentOutputId ?? null, rootOutputId: input.rootOutputId ?? null, editSessionId: input.editSessionId ?? null, editTurnId: input.editTurnId ?? null, id: randomUUID(), createdAt: now() };
    this.db.prepare("INSERT INTO outputs (id,project_id,storyboard_item_id,job_id,candidate_index,generation_snapshot_json,storage_path,hash,created_at,parent_output_id,root_output_id,edit_session_id,edit_turn_id) VALUES (@id,@projectId,@storyboardItemId,@jobId,@candidateIndex,@generationSnapshot,@storagePath,@hash,@createdAt,@parentOutputId,@rootOutputId,@editSessionId,@editTurnId)")
      .run({ ...record, generationSnapshot: record.generationSnapshot ? json(record.generationSnapshot) : null });
    return record;
  }
  public getOutput(id: string): OutputRecord | undefined { const row = this.db.prepare("SELECT * FROM outputs WHERE id=?").get(id); return row ? mapOutput(row as Row) : undefined; }
  public listOutputs(projectId: string): OutputRecord[] { return (this.db.prepare("SELECT * FROM outputs WHERE project_id=? ORDER BY created_at DESC").all(projectId) as Row[]).map(mapOutput); }
  public listEditOutputs(sessionId: string): OutputRecord[] { return (this.db.prepare("SELECT * FROM outputs WHERE edit_session_id=? ORDER BY created_at ASC").all(sessionId) as Row[]).map(mapOutput); }
  public isOutputInEditSession(sessionId: string, outputId: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM edit_sessions s WHERE s.id=? AND (s.current_output_id=? OR EXISTS (SELECT 1 FROM outputs o WHERE o.id=? AND o.edit_session_id=s.id) OR EXISTS (SELECT 1 FROM outputs o WHERE o.edit_session_id=s.id AND o.root_output_id=?)) LIMIT 1").get(sessionId, outputId, outputId, outputId);
    return Boolean(row);
  }
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
  public createEditTurn(input: Omit<EditTurnRecord, "createdAt" | "updatedAt">): EditTurnRecord {
    const record = { ...input, createdAt: now(), updatedAt: now() };
    this.db.prepare("INSERT INTO edit_turns (id,session_id,project_id,base_output_id,status,message,annotations_json,edit_mask_path,edit_mask_hash,protect_mask_path,protect_mask_hash,reference_asset_ids_json,plan_json,error_json,created_at,updated_at) VALUES (@id,@sessionId,@projectId,@baseOutputId,@status,@message,@annotations,@editMaskPath,@editMaskHash,@protectMaskPath,@protectMaskHash,@referenceAssetIds,@plan,@error,@createdAt,@updatedAt)").run({ ...record, annotations: json(record.annotations), referenceAssetIds: json(record.referenceAssetIds), plan: record.plan ? json(record.plan) : null, error: record.error ? json(record.error) : null });
    return record;
  }
  public updateEditTurn(id: string, patch: Partial<Pick<EditTurnRecord, "status" | "plan" | "error">>): EditTurnRecord | undefined {
    const current = this.getEditTurn(id); if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: now() };
    this.db.prepare("UPDATE edit_turns SET status=@status,plan_json=@plan,error_json=@error,updated_at=@updatedAt WHERE id=@id").run({ ...next, plan: next.plan ? json(next.plan) : null, error: next.error ? json(next.error) : null });
    return next;
  }

  public createExport(input: Omit<ExportRecord, "id" | "createdAt" | "updatedAt">): ExportRecord { const record = { ...input, id: randomUUID(), createdAt: now(), updatedAt: now() }; this.db.prepare("INSERT INTO exports (id,project_id,job_id,status,storage_path,created_at,updated_at) VALUES (@id,@projectId,@jobId,@status,@storagePath,@createdAt,@updatedAt)").run(record); return record; }
  public getExport(id: string): ExportRecord | undefined { const row = this.db.prepare("SELECT * FROM exports WHERE id=?").get(id); return row ? mapExport(row as Row) : undefined; }
  public getExportByJobId(jobId: string): ExportRecord | undefined { const row = this.db.prepare("SELECT * FROM exports WHERE job_id=?").get(jobId); return row ? mapExport(row as Row) : undefined; }
  public updateExport(id: string, patch: Partial<Pick<ExportRecord, "status" | "storagePath">>): ExportRecord | undefined { const current = this.getExport(id); if (!current) return undefined; const next = { ...current, ...patch, updatedAt: now() }; this.db.prepare("UPDATE exports SET status=@status,storage_path=@storagePath,updated_at=@updatedAt WHERE id=@id").run(next); return next; }
}

function mapProvider(row: Row): ProviderRecord { return { id: String(row.id), name: String(row.name), baseUrl: String(row.base_url), reasoningProtocol: row.reasoning_protocol as ReasoningProtocolProfile, encryptedApiKey: String(row.encrypted_api_key), models: parse(row.models_json), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapSearchSource(row: Row): SearchSourceRecord { return { id: String(row.id), name: String(row.name), kind: row.kind as SearchSourceKind, baseUrl: String(row.base_url), encryptedApiKey: row.encrypted_api_key ? String(row.encrypted_api_key) : null, priority: Number(row.priority), enabled: Boolean(row.enabled), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapProject(row: Row): ProjectRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    category: row.category ? String(row.category) : null,
    productDescription: row.product_description ? String(row.product_description) : null,
    verifiedFacts: parse(row.verified_facts_json ?? "[]"),
    prohibitedClaims: parse(row.prohibited_claims_json ?? "[]"),
    brandGuidelines: parse(row.brand_guidelines_json ?? "{}"),
    platformTargets: parse(row.platform_targets_json),
    targetMarket: row.target_market ? row.target_market as TargetMarket : null,
    copyLanguage: row.copy_language ? String(row.copy_language) : null,
    reasoningProviderId: String(row.reasoning_provider_id),
    reasoningModelId: String(row.reasoning_model_id),
    imageProviderId: String(row.image_provider_id),
    imageModelId: String(row.image_model_id),
    defaultMode: row.default_mode as StoryboardMode,
    imageResolution: (row.image_resolution as ImageResolution | undefined) ?? "1K",
    imageAspectRatio: (row.image_aspect_ratio as ImageAspectRatio | undefined) ?? "AUTO",
    candidatesPerType: Number(row.candidates_per_type ?? 1),
    webResearchEnabled: Boolean(row.web_research_enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
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
function mapStoryboard(row: Row): StoryboardRecord { return { projectId: String(row.project_id), version: Number(row.version), status: row.status as StoryboardRecord["status"], campaignStyleLock: String(row.campaign_style_lock), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapStoryboardItem(row: Row): StoryboardItemRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    storyboardVersion: Number(row.storyboard_version),
    assetType: String(row.asset_type),
    displayName: String(row.display_name ?? row.asset_type),
    templateVariant: row.template_variant ? String(row.template_variant) : null,
    candidateCount: Number(row.candidate_count ?? 1),
    imageProviderId: String(row.image_provider_id),
    imageModelId: String(row.image_model_id),
    imageResolution: row.image_resolution as ImageResolution,
    imageAspectRatio: row.image_aspect_ratio as ImageAspectRatio,
    referencedAssets: parse(row.referenced_assets_json ?? "[]"),
    mode: row.mode as StoryboardMode,
    status: row.status as StoryboardItemRecord["status"],
    promptInstruction: String(row.prompt_instruction),
    compiledPrompt: row.compiled_prompt ? String(row.compiled_prompt) : null,
    factClaims: parse(row.fact_claims_json),
    riskFlags: parse(row.risk_flags_json),
    sortOrder: Number(row.sort_order),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
function mapJob(row: Row): JobRecord { return { id: String(row.id), projectId: String(row.project_id), storyboardItemId: row.storyboard_item_id ? String(row.storyboard_item_id) : null, type: row.type as JobType, status: row.status as JobStatus, progress: Number(row.progress), retryable: Boolean(row.retryable), input: parse(row.input_json), requestFingerprint: row.request_fingerprint ? String(row.request_fingerprint) : null, providerId: row.provider_id ? String(row.provider_id) : null, modelId: row.model_id ? String(row.model_id) : null, estimatedCost: row.estimated_cost_json ? parse(row.estimated_cost_json) : null, actualCost: row.actual_cost_json ? parse(row.actual_cost_json) : null, cancelRequested: Boolean(row.cancel_requested), providerTaskId: row.provider_task_id ? String(row.provider_task_id) : null, error: row.error_json ? parse(row.error_json) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapCopywritingResult(row: Row): CopywritingResultRecord { return { jobId: String(row.job_id), projectId: String(row.project_id), target: row.target as CopywritingTarget, content: String(row.content), createdAt: String(row.created_at) }; }
function mapWebResearchAudit(row: Row): WebResearchAuditRecord { return { jobId: String(row.job_id), availability: row.availability as WebResearchAvailability, invocationCount: Number(row.invocation_count), successfulAttemptCount: Number(row.successful_attempt_count), failedAttemptCount: Number(row.failed_attempt_count), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapWebResearchAttempt(row: Row): WebResearchAttemptRecord { return { id: String(row.id), jobId: String(row.job_id), query: String(row.query), sourceId: String(row.source_id), sourceName: String(row.source_name), sourceKind: String(row.source_kind), status: row.status as WebResearchAttemptStatus, resultCount: Number(row.result_count), errorMessage: row.error_message ? String(row.error_message) : null, createdAt: String(row.created_at) }; }
function mapOutput(row: Row): OutputRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    storyboardItemId: String(row.storyboard_item_id),
    jobId: String(row.job_id),
    candidateIndex: Number(row.candidate_index ?? 1),
    generationSnapshot: row.generation_snapshot_json ? parse(row.generation_snapshot_json) : null,
    storagePath: String(row.storage_path),
    hash: String(row.hash),
    parentOutputId: row.parent_output_id ? String(row.parent_output_id) : null,
    rootOutputId: row.root_output_id ? String(row.root_output_id) : null,
    editSessionId: row.edit_session_id ? String(row.edit_session_id) : null,
    editTurnId: row.edit_turn_id ? String(row.edit_turn_id) : null,
    createdAt: String(row.created_at)
  };
}
function mapEditSession(row: Row): EditSessionRecord { return { id: String(row.id), projectId: String(row.project_id), currentOutputId: String(row.current_output_id), status: row.status as EditSessionStatus, memorySummary: parse(row.memory_summary_json ?? "{}"), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapEditTurn(row: Row): EditTurnRecord { return { id: String(row.id), sessionId: String(row.session_id), projectId: String(row.project_id), baseOutputId: String(row.base_output_id), status: row.status as EditTurnStatus, message: String(row.message), annotations: parse(row.annotations_json ?? "{}"), editMaskPath: row.edit_mask_path ? String(row.edit_mask_path) : null, editMaskHash: row.edit_mask_hash ? String(row.edit_mask_hash) : null, protectMaskPath: row.protect_mask_path ? String(row.protect_mask_path) : null, protectMaskHash: row.protect_mask_hash ? String(row.protect_mask_hash) : null, referenceAssetIds: parse(row.reference_asset_ids_json ?? "[]"), plan: row.plan_json ? parse(row.plan_json) : null, error: row.error_json ? parse(row.error_json) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mapExport(row: Row): ExportRecord { return { id: String(row.id), projectId: String(row.project_id), jobId: String(row.job_id), status: String(row.status), storagePath: row.storage_path ? String(row.storage_path) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
