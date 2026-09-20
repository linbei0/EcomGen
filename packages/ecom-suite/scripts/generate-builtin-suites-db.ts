import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

import { normalizeSuiteDocument, type SuiteDocumentInput } from "../src/suite-catalog.js";

// 构建期脚本：把 src/suites/ 的内置套图 JSON 固化为 dist/builtin-suites.db（SQLite）。
// src/suites/*.json 仍是 git 唯一真相源，.db 是构建产物不入库；运行时只按需查询。
const suitesDir = resolve(import.meta.dirname, "../src/suites");
const dbPath = resolve(import.meta.dirname, "../dist/builtin-suites.db");

const files = readdirSync(suitesDir)
  .filter((name) => /^\d{2,}-.+\.suite\.json$/.test(name))
  .sort();

if (files.length === 0) throw new Error("No built-in suite JSON files found in src/suites");

const rows = files.map((file) => {
  const raw = readFileSync(resolve(suitesDir, file));
  let document: SuiteDocumentInput;
  try {
    document = JSON.parse(raw.toString("utf8")) as SuiteDocumentInput;
  } catch (error) {
    throw new Error(`suite file ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  // 构建期跑一遍与运行时相同的规范化校验，坏套图让构建失败而不是潜伏到首次访问。
  const suite = normalizeSuiteDocument(document, "builtin");
  return {
    id: suite.id,
    file,
    name: suite.name,
    l1: suite.category.l1,
    l2: suite.category.l2,
    leaf: suite.category.leaf,
    description: suite.description ?? null,
    hash: createHash("sha256").update(raw).digest("hex"),
    data: raw.toString("utf8")
  };
});

const totalHash = createHash("sha256").update(rows.map((row) => row.hash).join("\n")).digest("hex");

mkdirSync(dirname(dbPath), { recursive: true });
// 原地重写而不是删文件重建：Windows 下运行中的 dev 进程可能持有只读句柄，
// unlink/rename 会 EBUSY；DROP + 单事务重写配合默认 busy_timeout 可与之共存。
// 不启用 WAL，运行时 readonly 打开，避免 -wal/-shm 副本落进 dist。
const db = new Database(dbPath);
try {
  db.exec(`
    DROP TABLE IF EXISTS suites;
    DROP TABLE IF EXISTS meta;
    CREATE TABLE suites (
      id TEXT PRIMARY KEY,
      file TEXT NOT NULL,
      name TEXT NOT NULL,
      l1 TEXT NOT NULL,
      l2 TEXT NOT NULL,
      leaf TEXT NOT NULL,
      description TEXT,
      hash TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const insertSuite = db.prepare("INSERT INTO suites (id, file, name, l1, l2, leaf, description, hash, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  db.transaction(() => {
    for (const row of rows) {
      try {
        insertSuite.run(row.id, row.file, row.name, row.l1, row.l2, row.leaf, row.description, row.hash, row.data);
      } catch (error) {
        // id 重复等约束冲突按文件定位，避免构建失败时只看到裸的 SqliteError
        throw new Error(`suite file ${row.file} (${row.id}) failed to insert: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    insertMeta.run("totalHash", totalHash);
  })();
} finally {
  db.close();
}

console.log(`builtin-suites.db: ${rows.length} suites, totalHash ${totalHash}`);
