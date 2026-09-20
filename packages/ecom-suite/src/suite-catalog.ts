import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

/** 与 packages/contracts 的 StoryboardShotRole 保持一致；此处独立声明以避免 ecom-skill 依赖 contracts。 */
export const SUITE_SHOT_ROLES = ["HERO", "PAIN_POINT", "COMPARISON", "SCENE", "DETAIL", "TRUST", "VARIANT", "CTA"] as const;
export type SuiteShotRole = (typeof SUITE_SHOT_ROLES)[number];

export type SuiteOrigin = "builtin" | "user";
export type SuiteShotMode = "CREATIVE" | "PIXEL_PROTECTED";

export interface SuitePaletteColorDefinition {
  name: string;
  hex: string;
}

export interface SuiteStyleLockDefinition {
  direction?: string;
  palette?: SuitePaletteColorDefinition[];
  temperature?: string;
  backgroundSystem?: string;
  lightingSystem?: string;
  surfaceSystem?: string;
  typography?: string;
  iconSystem?: string;
  presentationRules?: string;
  noDrift?: string[];
  lockText: string;
}

export interface SuiteShotDefinition {
  shotId: string;
  order: number;
  shotRole: SuiteShotRole;
  displayName: string;
  intent?: string;
  /** 服务端派生：<suiteId>::<shotId>，写入分镜 assetType，绝不进入 Prompt。 */
  assetType: string;
  mode: SuiteShotMode;
  aspectRatio?: string;
  resolution?: string;
  camera?: string;
  lighting?: string;
  background?: string;
  props?: string;
  productOccupancy?: string;
  whitespace?: string;
  textZone?: string;
  promptTemplate: string;
  supportsImageReference: boolean;
}

export interface SuiteCategoryDefinition {
  l1: string;
  l2: string;
  leaf: string;
  leafKeywords?: string[];
}

export interface SuiteDefinition {
  id: string;
  name: string;
  description?: string;
  category: SuiteCategoryDefinition;
  productFamily?: string;
  keywords: string[];
  styleLock: SuiteStyleLockDefinition;
  shots: SuiteShotDefinition[];
  provenance?: Record<string, unknown>;
  origin: SuiteOrigin;
  createdAt?: string;
  updatedAt?: string;
}

/** 原始套图文档（内置 JSON 或用户上传）的最小结构；由调用方保证已过 schema 校验。 */
export interface SuiteDocumentInput {
  schemaVersion?: number;
  kind?: string;
  id?: string;
  name: string;
  description?: string;
  category: SuiteCategoryDefinition;
  productFamily?: string;
  keywords?: string[];
  styleLock: SuiteStyleLockDefinition;
  shots: Array<Partial<SuiteShotDefinition> & { shotId?: string; order?: number; shotRole?: string; displayName?: string; promptTemplate?: string }>;
  provenance?: Record<string, unknown>;
}

/** 内置套图索引行：只含列表、过滤与排序所需摘要列，不触发 data 反序列化。 */
export interface BuiltinSuiteIndexEntry {
  id: string;
  name: string;
  l1: string;
  l2: string;
  leaf: string;
  description?: string;
  hash: string;
}

// src 与 dist 中的本模块都位于包根下一级，统一解析到包的 dist/builtin-suites.db：
// vitest 从 src 直跑与运行时从 dist 加载（Node 解析 symlink 后取真实路径）指向同一份文件。
const BUILTIN_SUITES_DB_PATH = fileURLToPath(new URL("../dist/builtin-suites.db", import.meta.url));

interface BuiltinSuitesConnection {
  selectData: Database.Statement;
  selectIndex: Database.Statement;
  selectTotalHash: Database.Statement;
}

let connection: BuiltinSuitesConnection | undefined;

/** 首次访问才打开内置库并预编译语句；readonly 打开不产生 journal 副本文件。 */
function builtinSuites(): BuiltinSuitesConnection {
  if (connection) return connection;
  let db: Database.Database;
  try {
    db = new Database(BUILTIN_SUITES_DB_PATH, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new Error(`内置套图库 ${BUILTIN_SUITES_DB_PATH} 不存在或无法打开，请先运行 pnpm --filter @ecomgen/ecom-suite build`, { cause: error });
  }
  connection = {
    selectData: db.prepare("SELECT data FROM suites WHERE id = ?"),
    selectIndex: db.prepare("SELECT id, name, l1, l2, leaf, description, hash FROM suites ORDER BY file"),
    selectTotalHash: db.prepare("SELECT value FROM meta WHERE key = 'totalHash'")
  };
  return connection;
}

/**
 * 把原始套图文档规范化为运行时结构：补全 assetType、mode、supportsImageReference 与默认值。
 * 字段缺失或不合法时抛出，调用方决定跳过还是报错。
 */
export function normalizeSuiteDocument(input: SuiteDocumentInput, origin: SuiteOrigin, meta?: { id?: string; createdAt?: string; updatedAt?: string }): SuiteDefinition {
  const id = (meta?.id ?? input.id ?? "").trim();
  if (!id) throw new Error("Suite document is missing an id");
  const name = input.name?.trim();
  if (!name) throw new Error(`Suite ${id} is missing a name`);
  const category = input.category;
  if (!category?.l1 || !category?.l2 || !category?.leaf) throw new Error(`Suite ${id} is missing category l1/l2/leaf`);
  const lockText = input.styleLock?.lockText?.trim();
  if (!lockText) throw new Error(`Suite ${id} is missing styleLock.lockText`);
  if (!Array.isArray(input.shots) || input.shots.length === 0) throw new Error(`Suite ${id} has no shots`);
  if (input.shots.length > 12) throw new Error(`Suite ${id} has more than 12 shots`);

  const shots = input.shots.map((shot, index) => {
    const order = Number.isFinite(shot.order) ? Number(shot.order) : index + 1;
    const shotId = (shot.shotId ?? `shot-${order}`).trim();
    const shotRole = shot.shotRole as SuiteShotRole;
    if (!SUITE_SHOT_ROLES.includes(shotRole)) throw new Error(`Suite ${id} shot ${shotId} has an invalid shotRole: ${String(shot.shotRole)}`);
    const promptTemplate = shot.promptTemplate?.trim();
    if (!promptTemplate) throw new Error(`Suite ${id} shot ${shotId} is missing promptTemplate`);
    if (!shot.displayName?.trim()) throw new Error(`Suite ${id} shot ${shotId} is missing displayName`);
    return {
      shotId,
      order,
      shotRole,
      displayName: shot.displayName.trim(),
      intent: shot.intent,
      assetType: `${id}::${shotId}`,
      mode: (shot.mode as SuiteShotMode | undefined) ?? "CREATIVE",
      aspectRatio: shot.aspectRatio,
      resolution: shot.resolution,
      camera: shot.camera,
      lighting: shot.lighting,
      background: shot.background,
      props: shot.props,
      productOccupancy: shot.productOccupancy,
      whitespace: shot.whitespace,
      textZone: shot.textZone,
      promptTemplate,
      supportsImageReference: shot.supportsImageReference !== false
    } satisfies SuiteShotDefinition;
  });
  shots.sort((a, b) => a.order - b.order);

  return {
    id,
    name,
    description: input.description?.trim() || undefined,
    category: { l1: category.l1, l2: category.l2, leaf: category.leaf, leafKeywords: category.leafKeywords },
    productFamily: input.productFamily?.trim() || undefined,
    keywords: input.keywords ?? [],
    styleLock: input.styleLock,
    shots,
    provenance: input.provenance,
    origin,
    createdAt: meta?.createdAt,
    updatedAt: meta?.updatedAt
  };
}

/** 按精确 ID 查找内置套图；命中时才反序列化并规范化 data 列。 */
export function getBuiltinSuite(suiteId: string): SuiteDefinition | undefined {
  const row = builtinSuites().selectData.get(suiteId) as { data: string } | undefined;
  if (!row) return undefined;
  return normalizeSuiteDocument(JSON.parse(row.data) as SuiteDocumentInput, "builtin");
}

/** 内置套图摘要索引，按套图文件名顺序返回（与历史 manifest 顺序一致）。 */
export function listBuiltinSuiteIndex(): readonly BuiltinSuiteIndexEntry[] {
  return builtinSuites().selectIndex.all() as BuiltinSuiteIndexEntry[];
}

/** 内置套图库整体内容指纹，构建期写入 meta 表。 */
export function getBuiltinSuitesHash(): string {
  const row = builtinSuites().selectTotalHash.get() as { value: string } | undefined;
  if (!row) throw new Error("内置套图库缺少 meta.totalHash，请重新运行 pnpm --filter @ecomgen/ecom-suite build");
  return row.value;
}

/** 解析 <suiteId>::<shotId> 形式的 assetType。 */
export function parseSuiteAssetType(assetType: string): { suiteId: string; shotId: string } | undefined {
  const separator = assetType.indexOf("::");
  if (separator <= 0 || separator >= assetType.length - 2) return undefined;
  return { suiteId: assetType.slice(0, separator), shotId: assetType.slice(separator + 2) };
}

/** 套图列表摘要：只含浏览与选择所需字段，避免列表接口返回完整 shots。 */
export function suiteSummary(suite: SuiteDefinition): {
  id: string; name: string; description?: string; category: SuiteCategoryDefinition; productFamily?: string;
  shotCount: number; shots: Array<{ shotId: string; order: number; shotRole: SuiteShotRole; displayName: string }>;
  origin: SuiteOrigin; createdAt?: string; updatedAt?: string;
} {
  return {
    id: suite.id,
    name: suite.name,
    description: suite.description,
    category: suite.category,
    productFamily: suite.productFamily,
    shotCount: suite.shots.length,
    shots: suite.shots.map((shot) => ({ shotId: shot.shotId, order: shot.order, shotRole: shot.shotRole, displayName: shot.displayName })),
    origin: suite.origin,
    createdAt: suite.createdAt,
    updatedAt: suite.updatedAt
  };
}
