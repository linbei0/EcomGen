import { randomUUID } from "node:crypto";
import type {
  ImageAspectRatio,
  ImageResolution,
  PlatformTarget,
  SegmentationModelRef,
  StoryboardMode,
  TargetMarket,
} from "@ecomgen/contracts";
import type { SqliteDatabase } from "../database.js";
import { normalize } from "../fingerprint.js";
import { type Row, json, now, parse } from "./internal.js";

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
  // 引用可空：Provider 可随时删除，删除时级联置空，项目进入"待重新选择模型"状态
  reasoningProviderId: string | null;
  reasoningModelId: string | null;
  imageProviderId: string | null;
  imageModelId: string | null;
  // AI 分层导出使用的分割模型（如 fal.ai SAM 3）；未配置时分层导出任务直接失败
  /** 分割模型引用；protocol 显式声明 API 协议（fal | grounded_sam），未配置时任务直接失败。 */
  segmentationModel: { providerId: string; modelId: string; protocol: NonNullable<SegmentationModelRef["protocol"]> } | null;
  defaultMode: StoryboardMode;
  imageResolution: ImageResolution;
  imageAspectRatio: ImageAspectRatio;
  candidatesPerType: number;
  webResearchEnabled: boolean;
  archivedAt: string | null;
  /**
   * 规划修订号：规划相关项目事实（事实、品牌、平台、模型配置等）每次变化单调递增。
   * 规划任务指纹纳入该值，保证项目更新后不会复用基于旧事实的规划结果。
   */
  planningRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanningConfigSnapshotPayload {
  project: {
    name: string;
    category: string | null;
    productDescription: string | null;
    verifiedFacts: string[];
    prohibitedClaims: string[];
    brandGuidelines: Record<string, string>;
    platformTargets: PlatformTarget[];
    targetMarket: TargetMarket | null;
    copyLanguage: string | null;
    // 与 ProjectRecord 一致可空：快照可能来自引用被置空的项目，应用快照前由 API 层校验
    reasoningProviderId: string | null;
    reasoningModelId: string | null;
    imageProviderId: string | null;
    imageModelId: string | null;
    defaultMode: StoryboardMode;
    imageResolution: ImageResolution;
    imageAspectRatio: ImageAspectRatio;
    candidatesPerType: number;
    webResearchEnabled: boolean;
  };
  planning: {
    planningMode: "AI" | "MANUAL";
    requestedTypes: string[];
    // 手动规划可同时选择套图分镜；旧快照无此字段，保持可选以兼容历史数据
    requestedSuiteShots?: string[];
    targetImageCount: number | null;
    userInstruction: string | null;
  };
}

export interface PlanningConfigSnapshotRecord {
  id: string;
  projectId: string;
  sourceJobId: string;
  payload: PlanningConfigSnapshotPayload;
  createdAt: string;
}

/** 首页列表封面：原图取最早 PRODUCT_TRUTH 图片；封面输出取最新输出。 */
export interface ProjectCoverSummary {
  productAssetId: string | null;
  coverOutputId: string | null;
  previewOutputIds: string[];
  outputCount: number;
}

/**
 * 计算项目更新后的规划修订号：仅当 patch 中实际改变了规划相关事实时递增。
 * 规划提示词由这些字段派生，改名与归档不影响规划结果，因此不计入。
 */
const PLANNING_REVISION_FIELDS = [
  "category", "productDescription", "verifiedFacts", "prohibitedClaims", "brandGuidelines",
  "platformTargets", "targetMarket", "copyLanguage",
  "reasoningProviderId", "reasoningModelId", "imageProviderId", "imageModelId", "segmentationModel",
  "defaultMode", "imageResolution", "imageAspectRatio", "candidatesPerType", "webResearchEnabled",
] as const;

function nextPlanningRevision(current: ProjectRecord, patch: Partial<Omit<ProjectRecord, "id" | "createdAt">>): number {
  const changed = PLANNING_REVISION_FIELDS.some((field) => field in patch && !stableEquals(current[field], patch[field]));
  return changed ? current.planningRevision + 1 : current.planningRevision;
}

/** 结构化等值比较：对象键序无关，避免同内容的 brandGuidelines 触发误递增。 */
function stableEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function emptyCover(): ProjectCoverSummary {
  return { productAssetId: null, coverOutputId: null, previewOutputIds: [], outputCount: 0 };
}

export class ProjectRepository {
  public constructor(private readonly db: SqliteDatabase) { }

  public listProjects(archived = false): ProjectRecord[] {
    const order = archived ? "archived_at DESC, updated_at DESC" : "updated_at DESC";
    return (this.db.prepare(`SELECT * FROM projects WHERE archived_at IS ${archived ? "NOT " : ""}NULL ORDER BY ${order}`).all() as Row[]).map(mapProject);
  }
  /** 封面是项目列表的投影：直接读 assets/outputs 两张子表拼装，抽到资产仓库反而制造一次往返。 */
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
  public createProject(input: Omit<ProjectRecord, "id" | "createdAt" | "updatedAt" | "webResearchEnabled" | "archivedAt" | "planningRevision" | "segmentationModel"> & Partial<Pick<ProjectRecord, "webResearchEnabled" | "archivedAt">> & { segmentationModel?: { providerId: string; modelId: string; protocol?: NonNullable<SegmentationModelRef["protocol"]> } | null }): ProjectRecord {
    const record: ProjectRecord = { ...input, webResearchEnabled: input.webResearchEnabled ?? false, archivedAt: input.archivedAt ?? null, planningRevision: 0, segmentationModel: input.segmentationModel ? { ...input.segmentationModel, protocol: input.segmentationModel.protocol ?? "fal" } : null, id: randomUUID(), createdAt: now(), updatedAt: now() };
    this.db.prepare(`INSERT INTO projects (id,name,category,product_description,verified_facts_json,prohibited_claims_json,brand_guidelines_json,platform_targets_json,target_market,copy_language,reasoning_provider_id,reasoning_model_id,image_provider_id,image_model_id,segmentation_provider_id,segmentation_model_id,segmentation_protocol,default_mode,image_resolution,image_aspect_ratio,candidates_per_type,web_research_enabled,archived_at,planning_revision,created_at,updated_at)
      VALUES (@id,@name,@category,@productDescription,@verifiedFacts,@prohibitedClaims,@brandGuidelines,@platformTargets,@targetMarket,@copyLanguage,@reasoningProviderId,@reasoningModelId,@imageProviderId,@imageModelId,@segmentationProviderId,@segmentationModelId,@segmentationProtocol,@defaultMode,@imageResolution,@imageAspectRatio,@candidatesPerType,@webResearchEnabled,@archivedAt,@planningRevision,@createdAt,@updatedAt)`)
      .run({ ...record, webResearchEnabled: record.webResearchEnabled ? 1 : 0, platformTargets: json(record.platformTargets), verifiedFacts: json(record.verifiedFacts), prohibitedClaims: json(record.prohibitedClaims), brandGuidelines: json(record.brandGuidelines), segmentationProviderId: record.segmentationModel?.providerId ?? null, segmentationModelId: record.segmentationModel?.modelId ?? null, segmentationProtocol: record.segmentationModel?.protocol ?? null });
    return record;
  }
  public updateProject(id: string, patch: Partial<Omit<ProjectRecord, "id" | "createdAt">>): ProjectRecord | undefined {
    const current = this.getProject(id); if (!current) return undefined;
    const next = { ...current, ...patch, planningRevision: nextPlanningRevision(current, patch), updatedAt: now() };
    this.db.prepare(`UPDATE projects SET name=@name,category=@category,product_description=@productDescription,verified_facts_json=@verifiedFacts,prohibited_claims_json=@prohibitedClaims,brand_guidelines_json=@brandGuidelines,platform_targets_json=@platformTargets,target_market=@targetMarket,copy_language=@copyLanguage,reasoning_provider_id=@reasoningProviderId,reasoning_model_id=@reasoningModelId,image_provider_id=@imageProviderId,image_model_id=@imageModelId,segmentation_provider_id=@segmentationProviderId,segmentation_model_id=@segmentationModelId,segmentation_protocol=@segmentationProtocol,default_mode=@defaultMode,image_resolution=@imageResolution,image_aspect_ratio=@imageAspectRatio,candidates_per_type=@candidatesPerType,web_research_enabled=@webResearchEnabled,archived_at=@archivedAt,planning_revision=@planningRevision,updated_at=@updatedAt WHERE id=@id`)
      .run({ ...next, webResearchEnabled: next.webResearchEnabled ? 1 : 0, platformTargets: json(next.platformTargets), verifiedFacts: json(next.verifiedFacts), prohibitedClaims: json(next.prohibitedClaims), brandGuidelines: json(next.brandGuidelines), segmentationProviderId: next.segmentationModel?.providerId ?? null, segmentationModelId: next.segmentationModel?.modelId ?? null, segmentationProtocol: next.segmentationModel?.protocol ?? null });
    return next;
  }

  public deleteArchivedProject(id: string): "deleted" | "not_archived" | "missing" {
    const current = this.getProject(id);
    if (!current) return "missing";
    if (!current.archivedAt) return "not_archived";
    const result = this.db.prepare("DELETE FROM projects WHERE id=? AND archived_at IS NOT NULL").run(id);
    return result.changes > 0 ? "deleted" : "not_archived";
  }

  public createPlanningConfigSnapshot(input: Omit<PlanningConfigSnapshotRecord, "id" | "createdAt">): PlanningConfigSnapshotRecord {
    const existing = this.db.prepare("SELECT * FROM planning_config_snapshots WHERE source_job_id=?").get(input.sourceJobId) as Row | undefined;
    if (existing) return mapPlanningConfigSnapshot(existing);
    const record: PlanningConfigSnapshotRecord = { ...input, id: randomUUID(), createdAt: now() };
    const write = this.db.transaction(() => {
      this.db.prepare("INSERT INTO planning_config_snapshots (id,project_id,source_job_id,payload_json,created_at) VALUES (@id,@projectId,@sourceJobId,@payload,@createdAt)").run({ ...record, payload: json(record.payload) });
      this.db.prepare("DELETE FROM planning_config_snapshots WHERE project_id=? AND id NOT IN (SELECT id FROM planning_config_snapshots WHERE project_id=? ORDER BY created_at DESC, rowid DESC LIMIT 20)").run(record.projectId, record.projectId);
    });
    write();
    return record;
  }
  public listPlanningConfigSnapshots(projectId: string): PlanningConfigSnapshotRecord[] {
    return (this.db.prepare("SELECT * FROM planning_config_snapshots WHERE project_id=? ORDER BY created_at DESC, rowid DESC LIMIT 20").all(projectId) as Row[]).map(mapPlanningConfigSnapshot);
  }
  public getPlanningConfigSnapshot(id: string): PlanningConfigSnapshotRecord | undefined {
    const row = this.db.prepare("SELECT * FROM planning_config_snapshots WHERE id=?").get(id);
    return row ? mapPlanningConfigSnapshot(row as Row) : undefined;
  }
}

function mapProject(row: Row): ProjectRecord {  return {
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
    reasoningProviderId: row.reasoning_provider_id ? String(row.reasoning_provider_id) : null,
    reasoningModelId: row.reasoning_model_id ? String(row.reasoning_model_id) : null,
    imageProviderId: row.image_provider_id ? String(row.image_provider_id) : null,
    imageModelId: row.image_model_id ? String(row.image_model_id) : null,
    segmentationModel: row.segmentation_provider_id && row.segmentation_model_id ? { providerId: String(row.segmentation_provider_id), modelId: String(row.segmentation_model_id), protocol: row.segmentation_protocol === "grounded_sam" || row.segmentation_protocol === "seedream_layerize" ? row.segmentation_protocol : "fal" } : null,
    defaultMode: row.default_mode as StoryboardMode,
    imageResolution: (row.image_resolution as ImageResolution | undefined) ?? "1K",
    imageAspectRatio: (row.image_aspect_ratio as ImageAspectRatio | undefined) ?? "AUTO",
    candidatesPerType: Number(row.candidates_per_type ?? 1),
    webResearchEnabled: Boolean(row.web_research_enabled),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    planningRevision: Number(row.planning_revision ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
function mapPlanningConfigSnapshot(row: Row): PlanningConfigSnapshotRecord {
  return { id: String(row.id), projectId: String(row.project_id), sourceJobId: String(row.source_job_id), payload: parse(row.payload_json), createdAt: String(row.created_at) };
}
