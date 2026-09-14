import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateEcomSuiteFile } from "@ecomgen/contracts";
import {
  ECOM_SUITES,
  normalizeSuiteDocument,
  parseSuiteAssetType,
  suiteSummary,
  type SuiteDefinition,
  type SuiteDocumentInput,
  type SuiteShotDefinition
} from "@ecomgen/ecom-suite";
import type { EcomRepository } from "./repository.js";

const SUITE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export interface SuiteCatalogOptions {
  dataDir: string;
  repository: EcomRepository;
  /** 覆盖投放目录；默认 <dataDir>/suites。 */
  suitesDir?: string;
  logger?: (message: string) => void;
}

/**
 * 合并三类套图来源：内置 manifest、用户目录投放（<dataDir>/suites/*.suite.json）与 SQLite 用户套图。
 * 全部在内存中索引，每次 refresh 做一次目录扫描；无效或重复 ID 的条目跳过并记录，不阻断启动。
 */
export class SuiteCatalog {
  private byId = new Map<string, SuiteDefinition>();
  private readonly suitesDir: string;
  private readonly repository: EcomRepository;
  private readonly logger: (message: string) => void;

  public constructor(options: SuiteCatalogOptions) {
    this.repository = options.repository;
    this.suitesDir = options.suitesDir ?? resolve(options.dataDir, "suites");
    this.logger = options.logger ?? ((message) => console.warn(message));
  }

  /** 按内置 → 用户数据库 → 投放目录的顺序重建索引；重复 ID 保留先加载者。 */
  public async refresh(): Promise<void> {
    const next = new Map<string, SuiteDefinition>();
    for (const suite of ECOM_SUITES) next.set(suite.id, suite);

    for (const record of this.repository.listUserSuites()) {
      try {
        const suite = normalizeSuiteDocument(record.payload, "user", { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt });
        if (next.has(suite.id)) {
          this.logger(`[suites] skip user suite ${suite.id}: id already in use`);
          continue;
        }
        next.set(suite.id, suite);
      } catch (error) {
        this.logger(`[suites] skip invalid user suite ${record.id}: ${errorMessage(error)}`);
      }
    }

    for (const file of await this.directoryFiles()) {
      const fullPath = resolve(this.suitesDir, file);
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(fullPath, "utf8"));
      } catch (error) {
        this.logger(`[suites] skip unreadable suite file ${file}: ${errorMessage(error)}`);
        continue;
      }
      const validation = validateEcomSuiteFile(raw);
      if (!validation.ok) {
        this.logger(`[suites] skip invalid suite file ${file}: ${validation.errors.join("; ")}`);
        continue;
      }
      const document = raw as SuiteDocumentInput;
      const id = (document.id ?? file.replace(/\.suite\.json$/, "")).trim();
      if (!SUITE_ID_PATTERN.test(id)) {
        this.logger(`[suites] skip suite file ${file}: invalid id ${id}`);
        continue;
      }
      try {
        const suite = normalizeSuiteDocument(document, "user", { id });
        if (next.has(suite.id)) {
          this.logger(`[suites] skip suite file ${file}: id ${suite.id} already in use`);
          continue;
        }
        next.set(suite.id, suite);
      } catch (error) {
        this.logger(`[suites] skip invalid suite file ${file}: ${errorMessage(error)}`);
      }
    }

    this.byId = next;
  }

  public listSuites(): SuiteDefinition[] {
    return [...this.byId.values()];
  }

  public listSummaries(): ReturnType<typeof suiteSummary>[] {
    return this.listSuites().map((suite) => suiteSummary(suite));
  }

  public getSuite(suiteId: string): SuiteDefinition | undefined {
    return this.byId.get(suiteId);
  }

  /** 解析 <suiteId>::<shotId> 形式的分镜 assetType。 */
  public resolveShot(assetType: string): { suite: SuiteDefinition; shot: SuiteShotDefinition } | undefined {
    const parsed = parseSuiteAssetType(assetType);
    if (!parsed) return undefined;
    const suite = this.byId.get(parsed.suiteId);
    const shot = suite?.shots.find((candidate) => candidate.shotId === parsed.shotId);
    return suite && shot ? { suite, shot } : undefined;
  }

  private async directoryFiles(): Promise<string[]> {
    try {
      return (await readdir(this.suitesDir)).filter((name) => name.endsWith(".suite.json")).sort();
    } catch {
      return [];
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
