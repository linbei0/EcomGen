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
  if (source !== "UPLOADED" && source !== "GENERATED") return null;
  if (kind !== "PRODUCT" && kind !== "REFERENCE" && kind !== "GENERATED" && kind !== "LAYER") return null;
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
