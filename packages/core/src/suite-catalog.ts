import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateEcomSuiteFile } from "@ecomgen/contracts";
import {
  getBuiltinSuite,
  listBuiltinSuiteIndex,
  normalizeSuiteDocument,
  parseSuiteAssetType,
  suiteSummary,
  type SuiteDefinition,
  type SuiteDocumentInput,
  type SuiteOrigin,
  type SuiteShotDefinition
} from "@ecomgen/ecom-suite";
import type { EcomRepository, UserSuiteRecord } from "./repository.js";

const SUITE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export const SUITE_PAGE_SIZE_DEFAULT = 40;
export const SUITE_PAGE_SIZE_MAX = 100;

export interface SuiteListQuery {
  /** 大小写不敏感的子串匹配，字段与前端历史行为一致：name + leaf + l2 + l1 + description。 */
  q?: string;
  l1?: string;
  l2?: string;
  /** 来源区间；省略表示内置与导入合并浏览。它是切换库范围的开关，因此 total/l1Counts 会跟着收窄。 */
  origin?: SuiteOrigin;
  /** 精确 ID 查询；存在时忽略 q/l1/l2/origin/cursor/limit，按目录顺序返回命中的套图。 */
  ids?: readonly string[];
  cursor?: string | null;
  limit?: number;
}

export interface SuiteSummaryPage {
  items: ReturnType<typeof suiteSummary>[];
  nextCursor: string | null;
  /** 当前来源区间内的总数，供“全部”计数使用；不含 origin 时即全库总数。 */
  total: number;
  /** 当前来源区间内的各级品类计数，供品类导航使用。 */
  l1Counts: Record<string, number>;
  /** 全库按来源的计数，与 origin/q/l1/l2/ids 均无关，供来源切换控件显示库存。 */
  originCounts: Record<SuiteOrigin, number>;
}

/** 目录条目：内置来源只持摘要列，完整定义首次命中时从内置库读取并回填 suite 字段。 */
interface CatalogEntry {
  id: string;
  origin: SuiteOrigin;
  name: string;
  description?: string;
  category: { l1: string; l2: string; leaf: string };
  createdAt?: string;
  updatedAt?: string;
  /** 用户数据库与投放目录来源加载即物化；内置来源懒加载，refresh 重建后失效。 */
  suite?: SuiteDefinition;
}

interface CatalogIndex {
  ordered: CatalogEntry[];
  /** 按来源区间缓存的库存统计；键 "all" 表示不区分来源。 */
  scopes: Map<string, ScopeCounts>;
  originCounts: Record<SuiteOrigin, number>;
}

interface ScopeCounts {
  total: number;
  l1Counts: Record<string, number>;
}

export interface SuiteCatalogOptions {
  dataDir: string;
  repository: EcomRepository;
  /** 覆盖投放目录；默认 <dataDir>/suites。 */
  suitesDir?: string;
  logger?: (message: string) => void;
}

/**
 * 合并三类套图来源：内置 SQLite 库、用户目录投放（<dataDir>/suites/*.suite.json）与 SQLite 用户套图。
 * 内置来源只索引摘要列，完整定义按需读取并缓存在条目上，避免列表场景物化全部内置套图。
 * 全部在内存中索引，每次 refresh 做一次目录扫描；无效或重复 ID 的条目跳过并记录，不阻断启动。
 * 单份写入走 upsertUserSuite/removeUserSuite 增量更新，避免每次导入都全量重扫。
 */
export class SuiteCatalog {
  private byId = new Map<string, CatalogEntry>();
  /** 排序后的全量视图与计数，懒构建；任何写入或 refresh 置空。 */
  private index: CatalogIndex | null = null;
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
    const next = new Map<string, CatalogEntry>();
    for (const item of listBuiltinSuiteIndex()) {
      next.set(item.id, { id: item.id, origin: "builtin", name: item.name, description: item.description, category: { l1: item.l1, l2: item.l2, leaf: item.leaf } });
    }

    for (const record of this.repository.listUserSuites()) {
      try {
        const suite = normalizeSuiteDocument(record.payload, "user", { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt });
        if (next.has(suite.id)) {
          this.logger(`[suites] skip user suite ${suite.id}: id already in use`);
          continue;
        }
        next.set(suite.id, entryFromSuite(suite));
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
        next.set(suite.id, entryFromSuite(suite));
      } catch (error) {
        this.logger(`[suites] skip invalid suite file ${file}: ${errorMessage(error)}`);
      }
    }

    this.byId = next;
    this.index = null;
  }

  /** 增量写入单份用户套图：ID 冲突规则与 refresh 一致，内置 ID 不可被覆盖。 */
  public upsertUserSuite(record: UserSuiteRecord): SuiteDefinition | undefined {
    let suite: SuiteDefinition;
    try {
      suite = normalizeSuiteDocument(record.payload, "user", { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt });
    } catch (error) {
      this.logger(`[suites] skip invalid user suite ${record.id}: ${errorMessage(error)}`);
      return undefined;
    }
    const existing = this.byId.get(suite.id);
    if (existing && existing.origin === "builtin") {
      this.logger(`[suites] skip user suite ${suite.id}: id already in use`);
      return undefined;
    }
    this.byId.set(suite.id, entryFromSuite(suite));
    this.index = null;
    return suite;
  }

  /** 增量删除用户套图；同名投放目录文件要等下一次 refresh 才会重新出现。 */
  public removeUserSuite(suiteId: string): boolean {
    const existing = this.byId.get(suiteId);
    if (!existing || existing.origin !== "user") return false;
    this.byId.delete(suiteId);
    this.index = null;
    return true;
  }

  public listSuites(): SuiteDefinition[] {
    return this.catalogIndex().ordered.flatMap((entry) => {
      const suite = this.resolveEntry(entry);
      return suite ? [suite] : [];
    });
  }

  /**
   * 列表接口的唯一数据源：过滤 + 游标分页，只对当前页做摘要投影。
   * total/l1Counts 跟随 origin 收窄（来源是库范围开关），但不随 q/l1/l2/ids 变化。
   */
  public pageSummaries(query: SuiteListQuery = {}): SuiteSummaryPage {
    const index = this.catalogIndex();
    const scope = this.scopeCounts(query.origin);
    const meta = { total: scope.total, l1Counts: scope.l1Counts, originCounts: index.originCounts };
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? SUITE_PAGE_SIZE_DEFAULT), 1), SUITE_PAGE_SIZE_MAX);

    if (query.ids?.length) {
      const wanted = new Set(query.ids);
      return { items: this.summarize(index.ordered.filter((entry) => wanted.has(entry.id))), nextCursor: null, ...meta };
    }

    const keyword = query.q?.trim().toLowerCase() ?? "";
    const matched = index.ordered.filter((entry) => {
      if (query.origin && entry.origin !== query.origin) return false;
      if (query.l1 && entry.category.l1 !== query.l1) return false;
      if (query.l2 && entry.category.l2 !== query.l2) return false;
      return keyword ? suiteSearchText(entry).includes(keyword) : true;
    });

    const startIndex = cursorStartIndex(matched, query.cursor);
    const page = matched.slice(startIndex, startIndex + limit);
    const nextCursor = startIndex + page.length < matched.length && page.length > 0 ? encodeSuiteCursor(page[page.length - 1].id) : null;
    return { items: this.summarize(page), nextCursor, ...meta };
  }

  public getSuite(suiteId: string): SuiteDefinition | undefined {
    const entry = this.byId.get(suiteId);
    return entry ? this.resolveEntry(entry) : undefined;
  }

  /** 解析 <suiteId>::<shotId> 形式的分镜 assetType。 */
  public resolveShot(assetType: string): { suite: SuiteDefinition; shot: SuiteShotDefinition } | undefined {
    const parsed = parseSuiteAssetType(assetType);
    if (!parsed) return undefined;
    const entry = this.byId.get(parsed.suiteId);
    const suite = entry ? this.resolveEntry(entry) : undefined;
    const shot = suite?.shots.find((candidate) => candidate.shotId === parsed.shotId);
    return suite && shot ? { suite, shot } : undefined;
  }

  private catalogIndex(): CatalogIndex {
    if (!this.index) {
      const ordered = [...this.byId.values()].sort(compareSuites);
      const originCounts: Record<SuiteOrigin, number> = { builtin: 0, user: 0 };
      for (const entry of ordered) originCounts[entry.origin] += 1;
      this.index = { ordered, scopes: new Map(), originCounts };
    }
    return this.index;
  }

  /** 来源区间的库存统计按需计算并缓存，refresh 或增量写入后随索引一起失效。 */
  private scopeCounts(origin: SuiteOrigin | undefined): ScopeCounts {
    const index = this.catalogIndex();
    const key = origin ?? "all";
    const cached = index.scopes.get(key);
    if (cached) return cached;

    const l1Counts: Record<string, number> = {};
    let total = 0;
    for (const entry of index.ordered) {
      if (origin && entry.origin !== origin) continue;
      total += 1;
      l1Counts[entry.category.l1] = (l1Counts[entry.category.l1] ?? 0) + 1;
    }
    const counts = { total, l1Counts };
    index.scopes.set(key, counts);
    return counts;
  }

  /** 只物化传入条目的完整定义再投影摘要，避免列表接口拉起全部内置套图。 */
  private summarize(entries: readonly CatalogEntry[]): SuiteSummaryPage["items"] {
    return entries.flatMap((entry) => {
      const suite = this.resolveEntry(entry);
      return suite ? [suiteSummary(suite)] : [];
    });
  }

  /** 内置条目首次命中时从内置库读取完整定义并回填缓存；用户来源加载即已物化。 */
  private resolveEntry(entry: CatalogEntry): SuiteDefinition | undefined {
    if (entry.suite) return entry.suite;
    if (entry.origin !== "builtin") return undefined;
    const suite = getBuiltinSuite(entry.id);
    if (!suite) return undefined;
    entry.suite = suite;
    return suite;
  }

  private async directoryFiles(): Promise<string[]> {
    try {
      return (await readdir(this.suitesDir)).filter((name) => name.endsWith(".suite.json")).sort();
    } catch {
      return [];
    }
  }
}

/** 用户来源的套图已是完整定义，直接包装为目录条目。 */
function entryFromSuite(suite: SuiteDefinition): CatalogEntry {
  return { id: suite.id, origin: suite.origin, name: suite.name, description: suite.description, category: suite.category, createdAt: suite.createdAt, updatedAt: suite.updatedAt, suite };
}

/**
 * 目录顺序先看来源再看时间：导入的套图排在内置之前，否则用户自己转换的模板会淹没在千套内置库里。
 * 同来源内，导入按最近导入优先（无时间戳的投放目录文件排最后），内置保持内置库文件名顺序（稳定排序交给 Map 插入顺序）。
 */
function compareSuites(left: CatalogEntry, right: CatalogEntry): number {
  if (left.origin !== right.origin) return left.origin === "user" ? -1 : 1;
  if (left.origin === "builtin") return 0;
  return (right.createdAt ?? "").localeCompare(left.createdAt ?? "") || left.id.localeCompare(right.id);
}

/** 与前端历史过滤行为逐字对齐：字符串拼接后整体小写做子串匹配。 */
function suiteSearchText(entry: CatalogEntry): string {
  return [entry.name, entry.category.leaf, entry.category.l2, entry.category.l1, entry.description ?? ""].join(" ").toLowerCase();
}

function encodeSuiteCursor(suiteId: string): string {
  return Buffer.from(suiteId, "utf8").toString("base64url");
}

function cursorStartIndex(matched: readonly CatalogEntry[], cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const suiteId = Buffer.from(cursor, "base64url").toString("utf8");
  const position = matched.findIndex((entry) => entry.id === suiteId);
  // 游标指向的套图已被删除或不再匹配时按“已到底”处理：宁可少一页，也不要重复或死循环。
  return position < 0 ? matched.length : position + 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
