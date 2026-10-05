import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

import { MODEL_SPEC_DEFAULTS } from "@ecomgen/contracts";

export type SqliteDatabase = Database.Database;

export function openDatabase(filename: string): SqliteDatabase {
  mkdirSync(dirname(filename), { recursive: true });
  const database = new Database(filename);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  try {
    migrate(database);
  } catch (error) {
    // 迁移失败必须释放文件句柄，否则 Windows 上后续清理临时库会 EBUSY
    database.close();
    throw error;
  }
  return database;
}

function tableNames(database: SqliteDatabase): Set<string> {
  const rows = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function columnNames(database: SqliteDatabase, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

/** 一次性清理审核字段，保留已有输出及编辑版本血缘。 */
function removeLegacyOutputReviewColumns(database: SqliteDatabase): void {
  const tables = tableNames(database);
  if (!tables.has("outputs") || !columnNames(database, "outputs").has("review_decision")) return;
  database.pragma("foreign_keys = OFF");
  try {
    database.exec(`
      CREATE TABLE outputs_without_review (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        storyboard_item_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        candidate_index INTEGER NOT NULL DEFAULT 1,
        generation_key TEXT,
        generation_snapshot_json TEXT,
        storage_path TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        parent_output_id TEXT,
        root_output_id TEXT,
        edit_session_id TEXT,
        edit_turn_id TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (storyboard_item_id) REFERENCES storyboard_items(id) ON DELETE CASCADE,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );
      INSERT INTO outputs_without_review (
        id,project_id,storyboard_item_id,job_id,candidate_index,generation_key,generation_snapshot_json,storage_path,hash,created_at,parent_output_id,root_output_id,edit_session_id,edit_turn_id
      )
      SELECT
        id,project_id,storyboard_item_id,job_id,candidate_index,NULL,generation_snapshot_json,storage_path,hash,created_at,parent_output_id,root_output_id,edit_session_id,edit_turn_id
      FROM outputs;
      DROP TABLE outputs;
      ALTER TABLE outputs_without_review RENAME TO outputs;
    `);
  } finally {
    database.pragma("foreign_keys = ON");
  }
}

/** 旧库补齐 shot_role 列；历史行保持 NULL，由上层按"未标注"处理。 */
function addStoryboardItemShotRole(database: SqliteDatabase): void {
  const tables = tableNames(database);
  if (!tables.has("storyboard_items") || columnNames(database, "storyboard_items").has("shot_role")) return;
  database.exec("ALTER TABLE storyboard_items ADD COLUMN shot_role TEXT");
}

/** 旧库补齐 jobs.progress_detail_json 列；历史行保持 NULL，由上层按"没有进度明细"处理。 */
function addJobProgressDetail(database: SqliteDatabase): void {
  const tables = tableNames(database);
  if (!tables.has("jobs") || columnNames(database, "jobs").has("progress_detail_json")) return;
  database.exec("ALTER TABLE jobs ADD COLUMN progress_detail_json TEXT");
}

/** 旧库补齐 projects.prompt_language 列；存量项目落产品默认值（中文提示词）。 */
function addProjectPromptLanguage(database: SqliteDatabase): void {
  const tables = tableNames(database);
  if (!tables.has("projects") || columnNames(database, "projects").has("prompt_language")) return;
  database.exec("ALTER TABLE projects ADD COLUMN prompt_language TEXT NOT NULL DEFAULT 'CHINESE'");
}

/** Provider 可随时删除：旧库的 projects.provider 引用列为 NOT NULL，重建表放宽为可空（删除 Provider 时级联置空）。 */
function makeProjectProviderReferencesNullable(database: SqliteDatabase): void {
  const columns = database.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string; notnull: number }>;
  if (columns.length === 0 || !columns.some((column) => (column.name === "reasoning_provider_id" || column.name === "image_provider_id") && column.notnull !== 0)) return;
  // 重建 SELECT 依赖这些后补列；更早版本的旧库可能一个都还没有
  for (const column of ["archived_at", "target_market", "copy_language"]) {
    if (!columns.some((existing) => existing.name === column)) database.exec(`ALTER TABLE projects ADD COLUMN ${column} TEXT`);
  }
  database.exec("DROP TABLE IF EXISTS projects_nullable_providers");
  database.pragma("foreign_keys = OFF");
  try {
    const rebuild = database.transaction(() => database.exec(`
      CREATE TABLE projects_nullable_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        product_description TEXT,
        verified_facts_json TEXT NOT NULL DEFAULT '[]',
        prohibited_claims_json TEXT NOT NULL DEFAULT '[]',
        brand_guidelines_json TEXT NOT NULL DEFAULT '{}',
        platform_targets_json TEXT NOT NULL,
        target_market TEXT,
        copy_language TEXT,
        reasoning_provider_id TEXT,
        reasoning_model_id TEXT,
        image_provider_id TEXT,
        image_model_id TEXT,
        default_mode TEXT NOT NULL,
        image_resolution TEXT NOT NULL DEFAULT '1K',
        image_aspect_ratio TEXT NOT NULL DEFAULT 'AUTO',
        candidates_per_type INTEGER NOT NULL DEFAULT 1,
        web_research_enabled INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (reasoning_provider_id) REFERENCES providers(id),
        FOREIGN KEY (image_provider_id) REFERENCES providers(id)
      );
      INSERT INTO projects_nullable_providers (
        id,name,category,product_description,verified_facts_json,prohibited_claims_json,brand_guidelines_json,platform_targets_json,target_market,copy_language,reasoning_provider_id,reasoning_model_id,image_provider_id,image_model_id,default_mode,image_resolution,image_aspect_ratio,candidates_per_type,web_research_enabled,archived_at,created_at,updated_at
      )
      SELECT
        id,name,category,product_description,verified_facts_json,prohibited_claims_json,brand_guidelines_json,platform_targets_json,target_market,copy_language,reasoning_provider_id,reasoning_model_id,image_provider_id,image_model_id,default_mode,image_resolution,image_aspect_ratio,candidates_per_type,web_research_enabled,archived_at,created_at,updated_at
      FROM projects;
      DROP TABLE projects;
      ALTER TABLE projects_nullable_providers RENAME TO projects;
    `));
    rebuild();
  } finally {
    database.pragma("foreign_keys = ON");
  }
}

/**
 * 分层导出支持无识别方案（画框/提示词直接分层）：旧库 layer_exports.plan_id 为 NOT NULL，重建表放宽为可空。
 */
function makeLayerExportPlanReferenceNullable(database: SqliteDatabase): void {
  const columns = database.prepare("PRAGMA table_info(layer_exports)").all() as Array<{ name: string; notnull: number }>;
  if (columns.length === 0 || !columns.some((column) => column.name === "plan_id" && column.notnull !== 0)) return;
  database.exec("DROP TABLE IF EXISTS layer_exports_nullable_plan");
  database.pragma("foreign_keys = OFF");
  try {
    const rebuild = database.transaction(() => database.exec(`
      CREATE TABLE layer_exports_nullable_plan (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        output_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        plan_id TEXT,
        status TEXT NOT NULL,
        include_background INTEGER NOT NULL DEFAULT 0,
        psd_storage_path TEXT,
        layer_files_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      INSERT INTO layer_exports_nullable_plan (id,project_id,output_id,job_id,plan_id,status,include_background,psd_storage_path,layer_files_json,error_json,created_at,updated_at)
      SELECT id,project_id,output_id,job_id,plan_id,status,include_background,psd_storage_path,layer_files_json,error_json,created_at,updated_at FROM layer_exports;
      DROP TABLE layer_exports;
      ALTER TABLE layer_exports_nullable_plan RENAME TO layer_exports;
    `));
    rebuild();
  } finally {
    database.pragma("foreign_keys = ON");
  }
}

/**
 * 全局套图反推任务不绑定项目：旧库 jobs.project_id 为 NOT NULL，重建表放宽为可空。
 * 项目任务的级联删除语义保持不变（project_id 为空的行不受影响）。
 */
function makeJobsProjectNullable(database: SqliteDatabase): void {
  const columns = database.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string; notnull: number }>;
  if (columns.length === 0 || !columns.some((column) => column.name === "project_id" && column.notnull !== 0)) return;
  database.exec("DROP TABLE IF EXISTS jobs_nullable_project");
  database.pragma("foreign_keys = OFF");
  try {
    const rebuild = database.transaction(() => database.exec(`
      CREATE TABLE jobs_nullable_project (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        storyboard_item_id TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL,
        retryable INTEGER NOT NULL,
        input_json TEXT NOT NULL,
        request_fingerprint TEXT,
        provider_id TEXT,
        model_id TEXT,
        estimated_cost_json TEXT,
        actual_cost_json TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        provider_task_id TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (storyboard_item_id) REFERENCES storyboard_items(id) ON DELETE SET NULL
      );
      INSERT INTO jobs_nullable_project (
        id,project_id,storyboard_item_id,type,status,progress,retryable,input_json,request_fingerprint,provider_id,model_id,estimated_cost_json,actual_cost_json,cancel_requested,provider_task_id,error_json,created_at,updated_at
      )
      SELECT
        id,project_id,storyboard_item_id,type,status,progress,retryable,input_json,request_fingerprint,provider_id,model_id,estimated_cost_json,actual_cost_json,cancel_requested,provider_task_id,error_json,created_at,updated_at
      FROM jobs;
      DROP TABLE jobs;
      ALTER TABLE jobs_nullable_project RENAME TO jobs;
    `));
    rebuild();
  } finally {
    database.pragma("foreign_keys = ON");
  }
}

/**
 * 开发初期以本 schema 为唯一规范，不保留历史状态；
 * 新增可空列走一次性 ALTER，旧行保持 NULL 由上层按"未标注"处理。
 */
function migrate(database: SqliteDatabase): void {
  removeLegacyOutputReviewColumns(database);
  makeProjectProviderReferencesNullable(database);
  makeLayerExportPlanReferenceNullable(database);
  makeJobsProjectNullable(database);
  addStoryboardItemShotRole(database);
  addJobProgressDetail(database);
  addProjectPromptLanguage(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      product_description TEXT,
      verified_facts_json TEXT NOT NULL DEFAULT '[]',
      prohibited_claims_json TEXT NOT NULL DEFAULT '[]',
      brand_guidelines_json TEXT NOT NULL DEFAULT '{}',
      base_url TEXT NOT NULL,
      reasoning_protocol TEXT NOT NULL DEFAULT 'openai',
      encrypted_api_key TEXT NOT NULL,
      models_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS search_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      base_url TEXT NOT NULL,
      encrypted_api_key TEXT,
      priority INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      product_description TEXT,
      verified_facts_json TEXT NOT NULL DEFAULT '[]',
      prohibited_claims_json TEXT NOT NULL DEFAULT '[]',
      brand_guidelines_json TEXT NOT NULL DEFAULT '{}',
      platform_targets_json TEXT NOT NULL,
      target_market TEXT,
      copy_language TEXT,
      prompt_language TEXT NOT NULL DEFAULT 'CHINESE',
      reasoning_provider_id TEXT,
      reasoning_model_id TEXT,
      image_provider_id TEXT,
      image_model_id TEXT,
      default_mode TEXT NOT NULL,
      image_resolution TEXT NOT NULL DEFAULT '1K',
      image_aspect_ratio TEXT NOT NULL DEFAULT 'AUTO',
      candidates_per_type INTEGER NOT NULL DEFAULT 1,
      web_research_enabled INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      planning_revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (reasoning_provider_id) REFERENCES providers(id),
      FOREIGN KEY (image_provider_id) REFERENCES providers(id)
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS storyboards (
      project_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      campaign_style_lock TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS storyboard_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      storyboard_version INTEGER NOT NULL,
      asset_type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      shot_role TEXT,
      template_variant TEXT,
      candidate_count INTEGER NOT NULL DEFAULT 1,
      image_provider_id TEXT,
      image_model_id TEXT,
      image_resolution TEXT,
      image_aspect_ratio TEXT,
      referenced_assets_json TEXT NOT NULL DEFAULT '[]',
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt_instruction TEXT NOT NULL,
      compiled_prompt TEXT,
      fact_claims_json TEXT NOT NULL,
      risk_flags_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      storyboard_item_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL,
      retryable INTEGER NOT NULL,
      input_json TEXT NOT NULL,
      request_fingerprint TEXT,
      provider_id TEXT,
      model_id TEXT,
      estimated_cost_json TEXT,
      actual_cost_json TEXT,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      provider_task_id TEXT,
      error_json TEXT,
      progress_detail_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (storyboard_item_id) REFERENCES storyboard_items(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS copywriting_results (
      job_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      target TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS web_research_audits (
      job_id TEXT PRIMARY KEY,
      availability TEXT NOT NULL,
      invocation_count INTEGER NOT NULL DEFAULT 0,
      successful_attempt_count INTEGER NOT NULL DEFAULT 0,
      failed_attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS web_research_attempts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      query TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      result_count INTEGER NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS outputs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      storyboard_item_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      candidate_index INTEGER NOT NULL DEFAULT 1,
      generation_batch_id TEXT,
      generation_key TEXT,
      generation_snapshot_json TEXT,
      storage_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL,
      parent_output_id TEXT,
      root_output_id TEXT,
      edit_session_id TEXT,
      edit_turn_id TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (storyboard_item_id) REFERENCES storyboard_items(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS planning_config_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_job_id TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (source_job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL,
      storage_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS edit_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      current_output_id TEXT NOT NULL,
      status TEXT NOT NULL,
      memory_summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (current_output_id) REFERENCES outputs(id)
    );
    CREATE TABLE IF NOT EXISTS edit_turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      base_output_id TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      annotations_json TEXT NOT NULL DEFAULT '{}',
      edit_mask_path TEXT,
      edit_mask_hash TEXT,
      protect_mask_path TEXT,
      protect_mask_hash TEXT,
      reference_asset_ids_json TEXT NOT NULL DEFAULT '[]',
      reference_selections_json TEXT NOT NULL DEFAULT '[]',
      plan_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES edit_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (base_output_id) REFERENCES outputs(id)
    );
    CREATE TABLE IF NOT EXISTS edit_reference_assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT,
      storage_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES edit_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_assets_project_created ON assets(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_storyboard_items_project_sort ON storyboard_items(project_id, storyboard_version, sort_order);
    CREATE INDEX IF NOT EXISTS idx_jobs_project_status_updated ON jobs(project_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_outputs_project_created ON outputs(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_outputs_root_created ON outputs(root_output_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_exports_project_updated ON exports(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_edit_turns_project_updated ON edit_turns(project_id, updated_at);
    CREATE TABLE IF NOT EXISTS user_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      default_size TEXT NOT NULL DEFAULT '1024x1024',
      supports_image_reference INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_suites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      l1 TEXT NOT NULL,
      l2 TEXT NOT NULL,
      leaf TEXT NOT NULL,
      product_family TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS suite_forge_results (
      job_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      suite_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      spec_json TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      reference_face_path TEXT,
      reference_face_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_portraits (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      provider_id TEXT NOT NULL,
      image_model_id TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      selected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_model_portraits_model_created ON model_portraits(model_id, created_at DESC);
  `);
  if (!columnNames(database, "projects").has("archived_at")) {
    database.exec("ALTER TABLE projects ADD COLUMN archived_at TEXT");
  }
  if (!columnNames(database, "projects").has("segmentation_provider_id")) {
    database.exec("ALTER TABLE projects ADD COLUMN segmentation_provider_id TEXT");
  }
  if (!columnNames(database, "projects").has("segmentation_model_id")) {
    database.exec("ALTER TABLE projects ADD COLUMN segmentation_model_id TEXT");
  }
  if (!columnNames(database, "projects").has("segmentation_protocol")) {
    database.exec("ALTER TABLE projects ADD COLUMN segmentation_protocol TEXT");
  }
  // 规划修订号：项目规划相关事实变化时单调递增，旧规划任务按指纹失效；旧行从 0 起算
  if (!columnNames(database, "projects").has("planning_revision")) {
    database.exec("ALTER TABLE projects ADD COLUMN planning_revision INTEGER NOT NULL DEFAULT 0");
  }
  if (!columnNames(database, "outputs").has("generation_key")) {
    database.exec("ALTER TABLE outputs ADD COLUMN generation_key TEXT");
  }
  if (!columnNames(database, "outputs").has("generation_batch_id")) {
    database.exec("ALTER TABLE outputs ADD COLUMN generation_batch_id TEXT");
    database.exec("UPDATE outputs SET generation_batch_id=job_id WHERE edit_session_id IS NULL AND generation_batch_id IS NULL");
  }
  // 验缝判定（本地确定性接缝比较，常量见 contracts/pod-tileability.ts）：判定的唯一写入方是
  // PATTERN_TILE_CHECK 任务。这段守卫必须放在 CREATE TABLE patterns 之前，所以要先判定表是否存在
  // ——columnNames 对不存在的表返回空集，只有 size > 0 才说明是历史库、才需要补列；
  // 新库由下面的建表语句直接带上这三列。
  const patternColumns = columnNames(database, "patterns");
  if (patternColumns.size > 0) {
    if (!patternColumns.has("tileable_status")) {
      database.exec("ALTER TABLE patterns ADD COLUMN tileable_status TEXT NOT NULL DEFAULT 'NONE'");
    }
    if (!patternColumns.has("tileable_score")) {
      database.exec("ALTER TABLE patterns ADD COLUMN tileable_score REAL");
    }
    // 写入该判定时的算法版本：与当前版本不一致即判定过期，需要重算（花型像素不可变，判定只在算法变更时失效）。
    if (!patternColumns.has("tileable_checked_with")) {
      database.exec("ALTER TABLE patterns ADD COLUMN tileable_checked_with TEXT");
    }
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS edit_reference_assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT,
      storage_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES edit_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_edit_reference_assets_session ON edit_reference_assets(session_id, created_at);
  `);
  if (!columnNames(database, "edit_turns").has("reference_selections_json")) {
    database.exec("ALTER TABLE edit_turns ADD COLUMN reference_selections_json TEXT NOT NULL DEFAULT '[]'");
    const rows = database.prepare("SELECT id, reference_asset_ids_json FROM edit_turns WHERE reference_asset_ids_json <> '[]'").all() as Array<{ id: string; reference_asset_ids_json: string }>;
    const update = database.prepare("UPDATE edit_turns SET reference_selections_json=? WHERE id=?");
    const migrateSelections = database.transaction(() => { for (const row of rows) { const ids = JSON.parse(row.reference_asset_ids_json) as string[]; update.run(JSON.stringify(ids.map((id, order) => ({ id, source: "PROJECT", purpose: "PRODUCT_APPEARANCE", order }))), row.id); } });
    migrateSelections();
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS layer_plans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      output_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      output_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      elements_json TEXT NOT NULL DEFAULT '[]',
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS layer_exports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      output_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      plan_id TEXT,
      status TEXT NOT NULL,
      include_background INTEGER NOT NULL DEFAULT 0,
      psd_storage_path TEXT,
      layer_files_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_layer_plans_job ON layer_plans(job_id);
    CREATE INDEX IF NOT EXISTS idx_layer_plans_output ON layer_plans(output_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_layer_exports_job ON layer_exports(job_id);
    CREATE INDEX IF NOT EXISTS idx_layer_exports_output ON layer_exports(output_id, created_at DESC);
  `);
  // 花型工坊：patterns 是全局实体（无项目外键，同 models）；print_packs 是「一任务一记录」的领域记录（同 layer_exports）。
  // Listing 文案结果独立成表而不是复用 copywriting_results：后者 project_id NOT NULL 且外键到 projects，
  // 而 Listing 由花型发起、归属花型域，硬塞进项目域需要把列约束改可空（SQLite 只能重建表）。
  database.exec(`
    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_job_id TEXT,
      source_asset_hash TEXT,
      parent_pattern_id TEXT,
      storage_path TEXT,
      file_hash TEXT,
      width INTEGER,
      height INTEGER,
      tags_json TEXT NOT NULL DEFAULT '[]',
      tileable_status TEXT NOT NULL DEFAULT 'NONE',
      tileable_score REAL,
      tileable_checked_with TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_pattern_id) REFERENCES patterns(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_patterns_created ON patterns(created_at DESC);
    -- source_job_id：每个花型任务的指纹复用判定与断点续跑都按它查；file_hash：资产库缩略图按 hash 找回花型。
    CREATE INDEX IF NOT EXISTS idx_patterns_source_job ON patterns(source_job_id);
    CREATE INDEX IF NOT EXISTS idx_patterns_file_hash ON patterns(file_hash);
    CREATE TABLE IF NOT EXISTS print_packs (
      id TEXT PRIMARY KEY,
      pattern_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      spec_id TEXT NOT NULL,
      spec_version TEXT NOT NULL,
      status TEXT NOT NULL,
      files_json TEXT,
      manifest_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_print_packs_job ON print_packs(job_id);
    CREATE INDEX IF NOT EXISTS idx_print_packs_pattern ON print_packs(pattern_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS pattern_listing_results (
      job_id TEXT PRIMARY KEY,
      pattern_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE CASCADE
    );
    -- 成包流水线：一条流水线是「图案 × 品类规格 × 平台」的一次串联执行，步骤各自对应一个任务行。
    -- pattern_id 可空：从花型墙的来源动作（提取/起稿/上传）起链时，花型要等 SOURCE 步骤完成才存在；
    -- 因此外键用 SET NULL 而不是 CASCADE——删花型不该连流水线历史一起抹掉（用户仍要看到它产过什么）。
    CREATE TABLE IF NOT EXISTS pattern_pipelines (
      id TEXT PRIMARY KEY,
      pattern_id TEXT,
      spec_id TEXT NOT NULL,
      spec_version TEXT NOT NULL,
      layout TEXT NOT NULL,
      repeat_layout TEXT NOT NULL,
      listing_platform TEXT NOT NULL,
      listing_provider_id TEXT NOT NULL,
      listing_model_id TEXT NOT NULL,
      listing_hints_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      block_reason TEXT,
      request_fingerprint TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pattern_pipelines_pattern ON pattern_pipelines(pattern_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pattern_pipelines_fingerprint ON pattern_pipelines(request_fingerprint);
    -- 步骤表：position 决定推进顺序，不依赖枚举顺序；job_id 是唯一反查键（worker 靠它从完成的任务找回流水线）。
    CREATE TABLE IF NOT EXISTS pattern_pipeline_steps (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL,
      step TEXT NOT NULL,
      position INTEGER NOT NULL,
      status TEXT NOT NULL,
      job_id TEXT,
      detail_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (pipeline_id) REFERENCES pattern_pipelines(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pattern_pipeline_steps_job ON pattern_pipeline_steps(job_id) WHERE job_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_pattern_pipeline_steps_pipeline ON pattern_pipeline_steps(pipeline_id, position);
  `);
  // AI 起稿工作台：创作草稿及其批次/槽位/候选，与正式 patterns 严格分离。
  // 候选只有经显式定稿才写成 patterns 行；草稿删除级联清空草稿域数据，不触及正式花型。
  database.exec(`
    CREATE TABLE IF NOT EXISTS pattern_drafts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      compose_type TEXT NOT NULL,
      conditions_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      selected_candidate_id TEXT,
      compare_candidate_id TEXT,
      archived_at TEXT,
      -- 参考图编号的发号器：只增不减，删除参考图不回收编号，因此编号允许出现空档。
      next_media_ordinal INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pattern_drafts_updated ON pattern_drafts(archived_at, updated_at DESC);
    CREATE TABLE IF NOT EXISTS draft_media (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      role TEXT NOT NULL,
      source TEXT NOT NULL,
      source_pattern_id TEXT,
      storage_path TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      original_name TEXT NOT NULL,
      notes TEXT,
      -- 仅参考图有编号；蒙版为 NULL，不占用编号。
      ordinal INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (draft_id) REFERENCES pattern_drafts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_draft_media_draft ON draft_media(draft_id, created_at);
    CREATE TABLE IF NOT EXISTS draft_batches (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      parent_candidate_id TEXT,
      provider_id TEXT,
      image_model_id TEXT,
      candidate_count INTEGER NOT NULL DEFAULT 1,
      instruction TEXT,
      snapshot_json TEXT NOT NULL,
      client_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (draft_id) REFERENCES pattern_drafts(id) ON DELETE CASCADE
    );
    -- 同 key 且同 payload 复用批次；同 key 异 payload 由 API 判定为冲突。唯一约束是这条规则的持久化兜底。
    CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_batches_client_key ON draft_batches(draft_id, client_key);
    CREATE INDEX IF NOT EXISTS idx_draft_batches_draft ON draft_batches(draft_id, created_at);
    CREATE TABLE IF NOT EXISTS draft_slots (
      batch_id TEXT NOT NULL,
      slot_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      job_id TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (batch_id, slot_index),
      FOREIGN KEY (batch_id) REFERENCES draft_batches(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_draft_slots_job ON draft_slots(job_id);
    CREATE TABLE IF NOT EXISTS draft_candidates (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      slot_index INTEGER NOT NULL,
      parent_candidate_id TEXT,
      storage_path TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      transform TEXT NOT NULL,
      has_alpha INTEGER NOT NULL DEFAULT 0,
      tileable_status TEXT NOT NULL DEFAULT 'NONE',
      tileable_score REAL,
      tileable_checked_with TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (draft_id) REFERENCES pattern_drafts(id) ON DELETE CASCADE,
      FOREIGN KEY (batch_id) REFERENCES draft_batches(id) ON DELETE CASCADE
    );
    -- 一个槽位成功产物至多一份：迟到产物或并发写入触发唯一冲突而不是产生第二份候选。
    CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_candidates_slot ON draft_candidates(batch_id, slot_index);
    CREATE INDEX IF NOT EXISTS idx_draft_candidates_draft ON draft_candidates(draft_id, created_at);
  `);
  // 候选验缝证据：逐轴得分让界面能指出是哪条边接不上；判定仍由 PATTERN_DRAFT_PROCESS 唯一写入。
  if (!columnNames(database, "draft_candidates").has("tileable_horizontal")) {
    database.exec("ALTER TABLE draft_candidates ADD COLUMN tileable_horizontal REAL");
  }
  if (!columnNames(database, "draft_candidates").has("tileable_vertical")) {
    database.exec("ALTER TABLE draft_candidates ADD COLUMN tileable_vertical REAL");
  }
  // 参考图不再按用途分类：旧库的 usages_json 一次性移除，避免留下永不读写的列。
  if (columnNames(database, "draft_media").has("usages_json")) {
    database.exec("ALTER TABLE draft_media DROP COLUMN usages_json");
  }
  // 引用编号：只在参考图上分配，旧库按 created_at 一次性回填，之后删除不回填也不重排。
  // 发号器单独存 next_media_ordinal，不用 MAX(ordinal)+1 现算——删掉最大号再上传会回收该号，
  // 已经写进主题框的「@图N」就会被重新解释成另一张图。
  if (!columnNames(database, "draft_media").has("ordinal")) {
    database.exec("ALTER TABLE draft_media ADD COLUMN ordinal INTEGER");
    database.exec(`
      UPDATE draft_media SET ordinal = (
        SELECT COUNT(*) FROM draft_media AS earlier
        WHERE earlier.draft_id = draft_media.draft_id
          AND earlier.role = 'REFERENCE'
          AND (earlier.created_at < draft_media.created_at OR (earlier.created_at = draft_media.created_at AND earlier.id <= draft_media.id))
      ) WHERE role = 'REFERENCE'
    `);
  }
  if (!columnNames(database, "pattern_drafts").has("next_media_ordinal")) {
    database.exec("ALTER TABLE pattern_drafts ADD COLUMN next_media_ordinal INTEGER NOT NULL DEFAULT 1");
    database.exec("UPDATE pattern_drafts SET next_media_ordinal = 1 + COALESCE((SELECT MAX(ordinal) FROM draft_media WHERE draft_media.draft_id = pattern_drafts.id), 0)");
  }
  // 定稿来源：同候选重复定稿必须复用同一 Pattern，唯一索引是幂等的最终防线。
  if (!columnNames(database, "patterns").has("source_draft_candidate_id")) {
    database.exec("ALTER TABLE patterns ADD COLUMN source_draft_candidate_id TEXT");
  }
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_patterns_source_draft_candidate ON patterns(source_draft_candidate_id) WHERE source_draft_candidate_id IS NOT NULL");
  // 资产库视图：生成结果此前未记录尺寸，旧行保持 NULL，由前端按占位比例兜底。
  if (!columnNames(database, "outputs").has("width")) {
    database.exec("ALTER TABLE outputs ADD COLUMN width INTEGER");
  }
  if (!columnNames(database, "outputs").has("height")) {
    database.exec("ALTER TABLE outputs ADD COLUMN height INTEGER");
  }
  database.exec("CREATE INDEX IF NOT EXISTS idx_outputs_generation_key ON outputs(generation_key)");
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_outputs_generation_key_unique ON outputs(generation_key) WHERE generation_key IS NOT NULL");
  database.exec("CREATE INDEX IF NOT EXISTS idx_outputs_generation_batch ON outputs(project_id, generation_batch_id, created_at)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_planning_config_snapshots_project_created ON planning_config_snapshots(project_id, created_at DESC)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at DESC)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_outputs_created ON outputs(created_at DESC)");
  // 资产库按内容 hash 去重取最新一条，索引让去重扫描不必全表排序
  database.exec("CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(hash)");
  database.exec("CREATE INDEX IF NOT EXISTS idx_outputs_hash ON outputs(hash)");
  // 每个模特至多一张选定定妆照：先清后设的切换写法在事务内满足该唯一约束。
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_model_portraits_selected ON model_portraits(model_id) WHERE selected = 1");
  backfillModelSpecDimensions(database);
}

/**
 * 补齐存量模特规格里缺失的维度。
 *
 * spec_json 是 JSON blob，契约新增维度后旧行缺键；编译层按契约直接取键
 * （`FACIAL_HAIR.options[spec.facialHair].prompt`），缺键会抛 TypeError 而不是校验错误，
 * 且会同时打崩 Worker 与前端预览。这里在开库时一次性补齐，读路径保持不做兜底分支。
 *
 * 幂等：只有真正缺键的行才会被写回；已对齐的行在内存里过滤掉，不产生写事务。
 */
function backfillModelSpecDimensions(database: SqliteDatabase): void {
  const requiredKeys = Object.keys(MODEL_SPEC_DEFAULTS);
  const rows = database.prepare("SELECT id, spec_json FROM models").all() as Array<{ id: string; spec_json: string }>;
  const pending = rows.flatMap((row) => {
    const spec = JSON.parse(row.spec_json) as Record<string, unknown>;
    return requiredKeys.every((key) => key in spec) ? [] : [{ id: row.id, spec }];
  });
  if (pending.length === 0) return;
  const update = database.prepare("UPDATE models SET spec_json=? WHERE id=?");
  const backfill = database.transaction(() => {
    // 缺失维度取基准值；已有取值原样保留，用户显式选择不会被迁移改写。
    for (const row of pending) update.run(JSON.stringify({ ...MODEL_SPEC_DEFAULTS, ...row.spec }), row.id);
  });
  backfill();
}
