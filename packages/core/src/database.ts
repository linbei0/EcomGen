import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

export type SqliteDatabase = Database.Database;

export function openDatabase(filename: string): SqliteDatabase {
  mkdirSync(dirname(filename), { recursive: true });
  const database = new Database(filename);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  migrate(database);
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

/**
 * 开发初期以本 schema 为唯一规范，不保留历史迁移或兼容分支；
 * 结构变更时直接删除旧开发库文件重建。
 */
function migrate(database: SqliteDatabase): void {
  removeLegacyOutputReviewColumns(database);
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
      reasoning_provider_id TEXT NOT NULL,
      reasoning_model_id TEXT NOT NULL,
      image_provider_id TEXT NOT NULL,
      image_model_id TEXT NOT NULL,
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
      project_id TEXT NOT NULL,
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
      plan_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES edit_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (base_output_id) REFERENCES outputs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_assets_project_created ON assets(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_storyboard_items_project_sort ON storyboard_items(project_id, storyboard_version, sort_order);
    CREATE INDEX IF NOT EXISTS idx_jobs_project_status_updated ON jobs(project_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_outputs_project_created ON outputs(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_outputs_root_created ON outputs(root_output_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_exports_project_updated ON exports(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_edit_turns_project_updated ON edit_turns(project_id, updated_at);
  `);
  if (!columnNames(database, "projects").has("archived_at")) {
    database.exec("ALTER TABLE projects ADD COLUMN archived_at TEXT");
  }
  if (!columnNames(database, "outputs").has("generation_key")) {
    database.exec("ALTER TABLE outputs ADD COLUMN generation_key TEXT");
  }
  database.exec("CREATE INDEX IF NOT EXISTS idx_outputs_generation_key ON outputs(generation_key)");
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_outputs_generation_key_unique ON outputs(generation_key) WHERE generation_key IS NOT NULL");
}
