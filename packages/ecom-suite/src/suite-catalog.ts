import suitesManifest from "./suites-manifest.js";

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

interface ManifestSuiteEntry {
  file: string;
  hash: string;
  data: SuiteDocumentInput;
}

const manifest = suitesManifest as unknown as { totalHash: string; suites: ManifestSuiteEntry[] };

export const ECOM_SUITES_HASH: string = manifest.totalHash;

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

/** 内置套图（随仓库发布，构建期固化进 manifest）。 */
export const ECOM_SUITES: readonly SuiteDefinition[] = Object.freeze(
  manifest.suites.map((entry) => normalizeSuiteDocument(entry.data, "builtin"))
);

/** 按精确 ID 查找内置套图。 */
export function getBuiltinSuite(suiteId: string): SuiteDefinition | undefined {
  return ECOM_SUITES.find((suite) => suite.id === suiteId);
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
