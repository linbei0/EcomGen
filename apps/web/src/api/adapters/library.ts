import type { ModelIdentityFilters } from "../../lib/modelIdentityFilters";

import type { operations } from "../schema.d.ts";
import type { components } from "../schema.d.ts";

export type LibraryItemSource = components["schemas"]["LibraryItemSource"];
export type LibraryItemKind = components["schemas"]["LibraryItemKind"];
export type LibraryKindFilter = LibraryItemKind | "ALL";
export type AssetRole = components["schemas"]["AssetRole"];

/** 资产库类型筛选选项，被资产库页面与选择器共用，避免枚举漏项。 */
export const LIBRARY_KIND_OPTIONS: Array<{ label: string; value: LibraryKindFilter }> = [
  { label: "全部", value: "ALL" },
  { label: "商品", value: "PRODUCT" },
  { label: "参考", value: "REFERENCE" },
  { label: "生成", value: "GENERATED" },
  { label: "分层", value: "LAYER" },
  { label: "模特", value: "MODEL" },
];

/** 资产库视图行：服务端已提供完整的可访问 url 与缩略图 url，前端不再二次拼装。 */
export interface LibraryItem {
  id: string;
  source: LibraryItemSource;
  kind: LibraryItemKind;
  name: string;
  projectId: string;
  projectName: string;
  mimeType: string;
  hash: string;
  width: number | null;
  height: number | null;
  url: string;
  thumbnailUrl: string;
  createdAt: string;
  role: AssetRole | null;
}

export interface LibraryFilters {
  kind: LibraryKindFilter;
  q: string;
  /** 来源项目；null 表示不限。模特定妆照没有项目归属，限定项目后不会出现在结果里。 */
  projectId: string | null;
  /** 创建时间下界（含），ISO 日期时间；null 表示不限。 */
  createdFrom: string | null;
  /** 创建时间上界（含），ISO 日期时间；null 表示不限。 */
  createdTo: string | null;
  /** 模特身份内核五维；只在「模特」类型下生效，按定妆照所属模特的身份筛选。 */
  modelIdentity: ModelIdentityFilters;
}

/**
 * 各类别下筛选控件的适用范围：与当前类型无关的维度在界面上禁用或隐藏并清空，
 * 而不是保留一个必然为空的取值，让用户以为筛选在生效。
 * 身份筛选查的是模特实体的规格，因此只对定妆照（MODEL）成立。
 */
export function libraryFilterScope(kind: LibraryKindFilter): { project: boolean; identity: boolean } {
  return {
    project: kind !== "MODEL",
    identity: kind === "MODEL",
  };
}

/** 是否有生效中的筛选条件：空状态文案与「清空筛选」入口据此判断，避免把「库是空的」说成「没有匹配」。 */
export function hasActiveLibraryFilters(filters: LibraryFilters): boolean {
  return filters.kind !== "ALL"
    || filters.q.trim() !== ""
    || filters.projectId !== null
    || filters.createdFrom !== null
    || filters.createdTo !== null
    || Object.keys(filters.modelIdentity).length > 0;
}

/** 身份维度查询参数：键名与契约参数一一对应，取值来自 MODEL_IDENTITY_FILTERS（契约元组派生），因此此处收窄是安全的。 */
export function modelIdentityQuery(filters: ModelIdentityFilters) {
  return {
    ...(filters.gender ? { modelGender: filters.gender } : {}),
    ...(filters.age ? { modelAge: filters.age } : {}),
    ...(filters.heritage ? { modelHeritage: filters.heritage } : {}),
    ...(filters.stature ? { modelStature: filters.stature } : {}),
    ...(filters.build ? { modelBuild: filters.build } : {}),
  } as Pick<
    NonNullable<operations["listLibraryAssets"]["parameters"]["query"]>,
    "modelGender" | "modelAge" | "modelHeritage" | "modelStature" | "modelBuild"
  >;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function adaptLibraryItem(raw: unknown): LibraryItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = asString(record.id);
  const source = asString(record.source);
  const kind = asString(record.kind);
  const url = asString(record.url);
  const thumbnailUrl = asString(record.thumbnailUrl);
  const createdAt = asString(record.createdAt);
  if (!id || !url || !thumbnailUrl || !createdAt) return null;
  if (source !== "UPLOADED" && source !== "GENERATED" && source !== "MODEL") return null;
  if (kind !== "PRODUCT" && kind !== "REFERENCE" && kind !== "GENERATED" && kind !== "LAYER" && kind !== "MODEL") return null;
  return {
    id,
    source,
    kind,
    name: asString(record.name) ?? "未命名图片",
    projectId: asString(record.projectId) ?? "",
    projectName: asString(record.projectName) ?? "",
    mimeType: asString(record.mimeType) ?? "image/png",
    hash: asString(record.hash) ?? "",
    width: asNumber(record.width),
    height: asNumber(record.height),
    url,
    thumbnailUrl,
    createdAt,
    role: (asString(record.role) as AssetRole | undefined) ?? null,
  };
}
