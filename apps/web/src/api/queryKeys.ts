import type { LibraryFilters } from "./adapters/library";
import type { SuitePageFilters } from "./adapters/suites";

/** 统一 query key 工厂，SSE 事件失效映射也以此为准。 */
export const qk = {
  health: ["health"] as const,
  templates: ["ecom-templates"] as const,
  userTemplates: ["user-templates"] as const,
  suites: ["suites"] as const,
  suiteCategories: ["suite-categories"] as const,
  /** 套图列表分页查询：筛选条件进 key，游标由服务端游标链维护。 */
  suitePages: (filters: SuitePageFilters) => ["suites", "page", filters] as const,
  /** 已选分镜所属套图的精确回读，用于解析名称而不拉全库。 */
  suiteSummaries: (idsKey: string) => ["suites", "summary", idsKey] as const,
  suite: (id: string) => ["suites", "detail", id] as const,
  suiteForgeJob: (id: string) => ["suite-forge-jobs", id] as const,
  suiteForgeResult: (id: string) => ["suite-forge-jobs", id, "result"] as const,
  /** 「最近反推」列表刻意独立于单任务 key，避免按前缀失效时把列表和详情混在一起。 */
  suiteForgeJobList: ["suite-forge-job-list"] as const,
  providers: ["providers"] as const,
  searchSources: ["search-sources"] as const,
  /** 全局模特库：列表与单模特详情、候选列表按模特隔离。 */
  models: ["models"] as const,
  modelPortraits: (id: string) => ["models", id, "portraits"] as const,
  /** 全局花型库：列表、规格目录与按花型隔离的规格包/文案结果。 */
  patterns: ["patterns"] as const,
  podPrintSpecs: ["pod", "print-specs"] as const,
  printPacks: (patternId: string) => ["patterns", patternId, "print-packs"] as const,
  patternListingJob: (patternId: string, jobId: string) => ["patterns", patternId, "listing-jobs", jobId] as const,
  /** 成包流水线：列表按花型隔离；重跑/裁决/取消后失效这一条列表键即完成刷新。 */
  patternPipelines: (patternId: string) => ["patterns", patternId, "pipelines"] as const,
  /** AI 起稿草稿：列表、单草稿、媒体、批次与候选；候选/批次按草稿隔离，失效一条键即完成刷新。 */
  patternDrafts: ["pattern-drafts"] as const,
  patternDraft: (id: string) => ["pattern-drafts", id] as const,
  draftMedia: (id: string) => ["pattern-drafts", id, "media"] as const,
  draftBatches: (id: string) => ["pattern-drafts", id, "batches"] as const,
  draftCandidates: (id: string) => ["pattern-drafts", id, "candidates"] as const,
  projects: (archived?: boolean) => ["projects", { archived: archived ?? false }] as const,
  project: (id: string) => ["projects", id] as const,
  /** 资产库分页查询：类型/关键词/来源项目/素材用途全部进 key，筛选变化即从首个游标重新查询。 */
  libraryAssets: (filters: LibraryFilters) => ["library-assets", filters] as const,
  storyboard: (id: string) => ["projects", id, "storyboard"] as const,
  planningSnapshots: (id: string) => ["projects", id, "planning-config-snapshots"] as const,
  job: (id: string) => ["jobs", id] as const,
  editTurn: (id: string) => ["edit-turns", id] as const,
  export: (id: string) => ["exports", id] as const,
  exports: (id: string) => ["projects", id, "exports"] as const,
};
