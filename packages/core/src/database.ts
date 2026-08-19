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

function migrate(database: SqliteDatabase): void {
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
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      product_description TEXT,
      verified_facts_json TEXT NOT NULL DEFAULT '[]',
      prohibited_claims_json TEXT NOT NULL DEFAULT '[]',
      brand_guidelines_json TEXT NOT NULL DEFAULT '{}',
      platform_targets_json TEXT NOT NULL,
      reasoning_provider_id TEXT NOT NULL,
      reasoning_model_id TEXT NOT NULL,
      image_provider_id TEXT NOT NULL,
      image_model_id TEXT NOT NULL,
      default_mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (reasoning_provider_id) REFERENCES providers(id),
      FOREIGN KEY (image_provider_id) REFERENCES providers(id)
    );
    CREATE TABLE IF NOT EXISTS variants (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      attributes_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      variant_id TEXT,
      role TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE SET NULL
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
      template_variant TEXT,
      variant_scope TEXT NOT NULL,
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
    CREATE TABLE IF NOT EXISTS outputs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      storyboard_item_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      review_decision TEXT NOT NULL,
      review_note TEXT,
      created_at TEXT NOT NULL,
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
  `);
  const providerColumns = database.prepare("PRAGMA table_info(providers)").all() as Array<{ name: string }>;
  if (!providerColumns.some((column) => column.name === "reasoning_protocol")) {
    database.exec("ALTER TABLE providers ADD COLUMN reasoning_protocol TEXT NOT NULL DEFAULT 'openai'");
  }
}
