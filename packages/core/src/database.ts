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

/**
 * 开发数据一次性重建：去掉 SKU variants / variant_id / variant_scope，
 * 并补齐项目出图参数、分镜展示字段与输出候选快照。不保留运行时兼容分支。
 */
function rebuildWithoutSku(database: SqliteDatabase): void {
  database.pragma("foreign_keys = OFF");
  database.exec(`
    CREATE TABLE projects_new (
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (reasoning_provider_id) REFERENCES providers(id),
      FOREIGN KEY (image_provider_id) REFERENCES providers(id)
    );
    INSERT INTO projects_new (
      id,name,category,product_description,verified_facts_json,prohibited_claims_json,brand_guidelines_json,
      platform_targets_json,reasoning_provider_id,reasoning_model_id,image_provider_id,image_model_id,default_mode,
      image_resolution,image_aspect_ratio,candidates_per_type,created_at,updated_at
    )
    SELECT
      id,name,category,product_description,verified_facts_json,prohibited_claims_json,brand_guidelines_json,
      platform_targets_json,reasoning_provider_id,reasoning_model_id,image_provider_id,image_model_id,default_mode,
      '1K','AUTO',1,created_at,updated_at
    FROM projects;

    CREATE TABLE assets_new (
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
    INSERT INTO assets_new (id,project_id,role,storage_path,hash,original_name,mime_type,width,height,created_at)
    SELECT id,project_id,role,storage_path,hash,original_name,mime_type,width,height,created_at FROM assets;

    CREATE TABLE storyboard_items_new (
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
    INSERT INTO storyboard_items_new (
      id,project_id,storyboard_version,asset_type,display_name,template_variant,candidate_count,referenced_assets_json,
      mode,status,prompt_instruction,compiled_prompt,fact_claims_json,risk_flags_json,sort_order,created_at,updated_at
    )
    SELECT
      id,project_id,storyboard_version,asset_type,asset_type,template_variant,1,'[]',
      mode,status,prompt_instruction,compiled_prompt,fact_claims_json,risk_flags_json,sort_order,created_at,updated_at
    FROM storyboard_items;

    CREATE TABLE outputs_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      storyboard_item_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      candidate_index INTEGER NOT NULL DEFAULT 1,
      generation_snapshot_json TEXT,
      storage_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      review_decision TEXT NOT NULL,
      review_note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (storyboard_item_id) REFERENCES storyboard_items(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    INSERT INTO outputs_new (
      id,project_id,storyboard_item_id,job_id,candidate_index,generation_snapshot_json,storage_path,hash,review_decision,review_note,created_at
    )
    SELECT id,project_id,storyboard_item_id,job_id,1,NULL,storage_path,hash,review_decision,review_note,created_at FROM outputs;

    DROP TABLE outputs;
    DROP TABLE assets;
    DROP TABLE storyboard_items;
    DROP TABLE IF EXISTS variants;
    DROP TABLE projects;
    ALTER TABLE projects_new RENAME TO projects;
    ALTER TABLE assets_new RENAME TO assets;
    ALTER TABLE storyboard_items_new RENAME TO storyboard_items;
    ALTER TABLE outputs_new RENAME TO outputs;
  `);
  database.pragma("foreign_keys = ON");
}

function migrate(database: SqliteDatabase): void {
  const tables = tableNames(database);
  const projectColumns = tables.has("projects") ? columnNames(database, "projects") : new Set<string>();
  const needsRebuild =
    tables.has("projects") &&
    (tables.has("variants") ||
      (tables.has("assets") && columnNames(database, "assets").has("variant_id")) ||
      (tables.has("storyboard_items") && columnNames(database, "storyboard_items").has("variant_scope")) ||
      !projectColumns.has("image_resolution") ||
      !projectColumns.has("target_market") ||
      !projectColumns.has("copy_language"));
  if (needsRebuild) {
    rebuildWithoutSku(database);
  }

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
      generation_snapshot_json TEXT,
      storage_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      review_decision TEXT NOT NULL,
      review_note TEXT,
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
  `);
  const providerColumns = columnNames(database, "providers");
  if (!providerColumns.has("reasoning_protocol")) {
    database.exec("ALTER TABLE providers ADD COLUMN reasoning_protocol TEXT NOT NULL DEFAULT 'openai'");
  }
  const currentProjectColumns = columnNames(database, "projects");
  if (!currentProjectColumns.has("web_research_enabled")) {
    database.exec("ALTER TABLE projects ADD COLUMN web_research_enabled INTEGER NOT NULL DEFAULT 0");
  }
  const storyboardItemColumns = columnNames(database, "storyboard_items");
  if (!storyboardItemColumns.has("image_provider_id")) {
    database.exec("ALTER TABLE storyboard_items ADD COLUMN image_provider_id TEXT");
  }
  if (!storyboardItemColumns.has("image_model_id")) {
    database.exec("ALTER TABLE storyboard_items ADD COLUMN image_model_id TEXT");
  }
  if (!storyboardItemColumns.has("image_resolution")) {
    database.exec("ALTER TABLE storyboard_items ADD COLUMN image_resolution TEXT");
  }
  if (!storyboardItemColumns.has("image_aspect_ratio")) {
    database.exec("ALTER TABLE storyboard_items ADD COLUMN image_aspect_ratio TEXT");
  }
  const outputColumns = columnNames(database, "outputs");
  if (!outputColumns.has("parent_output_id")) database.exec("ALTER TABLE outputs ADD COLUMN parent_output_id TEXT");
  if (!outputColumns.has("root_output_id")) database.exec("ALTER TABLE outputs ADD COLUMN root_output_id TEXT");
  if (!outputColumns.has("edit_session_id")) database.exec("ALTER TABLE outputs ADD COLUMN edit_session_id TEXT");
  if (!outputColumns.has("edit_turn_id")) database.exec("ALTER TABLE outputs ADD COLUMN edit_turn_id TEXT");
  database.exec(`
    UPDATE storyboard_items
    SET image_provider_id = (SELECT image_provider_id FROM projects WHERE projects.id = storyboard_items.project_id),
        image_model_id = (SELECT image_model_id FROM projects WHERE projects.id = storyboard_items.project_id),
        image_resolution = (SELECT image_resolution FROM projects WHERE projects.id = storyboard_items.project_id),
        image_aspect_ratio = (SELECT image_aspect_ratio FROM projects WHERE projects.id = storyboard_items.project_id)
    WHERE image_provider_id IS NULL OR image_model_id IS NULL OR image_resolution IS NULL OR image_aspect_ratio IS NULL
  `);
}
