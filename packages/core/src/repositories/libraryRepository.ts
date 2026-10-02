import type {
  AssetRole,
  LibraryItemKind,
  LibraryItemSource,
  ModelSpec,
} from "@ecomgen/contracts";
import type { SqliteDatabase } from "../database.js";
import type { AssetRecord } from "./assetRepository.js";
import type { LayerExportRecord } from "./exportRepository.js";
import type { ModelPortraitRecord, ModelRecord } from "./modelRepository.js";
import { type Row } from "./internal.js";
import type { OutputRecord } from "./outputRepository.js";
import type { PatternRecord, PrintPackRecord } from "./patternRepository.js";

/** 资产库视图行：由 assets、outputs、model_portraits 与 layer_exports 合并派生，不落库。 */
export interface LibraryItemRecord {
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
  storagePath: string;
  role: AssetRole | null;
  createdAt: string;
}

/** 资产库按模特身份内核筛选定妆照；维度取值与 ModelSpec 的身份层同一份枚举。 */
export interface LibraryModelSpecFilter {
  gender?: ModelSpec["gender"] | null;
  age?: ModelSpec["age"] | null;
  heritage?: ModelSpec["heritage"] | null;
  stature?: ModelSpec["stature"] | null;
  build?: ModelSpec["build"] | null;
}

export interface LibraryItemQuery {
  kind?: LibraryItemKind | null;
  q?: string | null;
  /** 只看该项目的来源行；模特定妆照没有项目归属，因此不会命中。 */
  projectId?: string | null;
  /** 只看创建时间落在 [from, to] 内的来源行；ISO 日期时间字符串，两端都包含。 */
  createdFrom?: string | null;
  createdTo?: string | null;
  /** 只看所属模特在该身份维度上取该值的定妆照；其余来源行没有模特规格，因此不会命中。 */
  modelSpec?: LibraryModelSpecFilter | null;
  cursor?: string | null;
  limit?: number;
}

export interface LibraryItemPage {
  items: LibraryItemRecord[];
  nextCursor: string | null;
  /** 当前筛选条件过滤来源行、再按 hash 去重后的完整数量，与游标位置无关，供前端显示稳定总数。 */
  total: number;
}

/** resolveLibrarySource 要反查的各聚合读取口；由门面用组合好的子仓库注入。 */
export interface LibrarySourceLookups {
  getAsset(id: string): AssetRecord | undefined;
  getOutput(id: string): OutputRecord | undefined;
  getLayerExport(id: string): LayerExportRecord | undefined;
  getPattern(id: string): PatternRecord | undefined;
  getPrintPack(id: string): PrintPackRecord | undefined;
  getModelPortrait(id: string): ModelPortraitRecord | undefined;
  getModel(id: string): ModelRecord | undefined;
}

/** 身份内核里可参与资产库筛选的维度；顺序固定，SQL 条件与参数名由它派生。 */
const LIBRARY_MODEL_SPEC_DIMENSIONS = ["gender", "age", "heritage", "stature", "build"] as const;

/** 上传素材按用途归入商品/参考；生成结果与模特定妆照单列，不参与用途映射。 */
function basename(storagePath: string): string {
  const slash = storagePath.lastIndexOf("/");
  return slash < 0 ? storagePath : storagePath.slice(slash + 1);
}
function mimeTypeForPath(storagePath: string): string {
  const dot = storagePath.lastIndexOf(".");
  const ext = dot < 0 ? "" : storagePath.slice(dot).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function encodeLibraryCursor(item: LibraryItemRecord): string {
  return Buffer.from(`${item.createdAt}\u0000${item.id}`, "utf8").toString("base64url");
}
function decodeLibraryCursor(cursor: string | null): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const separator = decoded.indexOf("\u0000");
  if (separator < 0) return null;
  return { createdAt: decoded.slice(0, separator), id: decoded.slice(separator + 1) };
}

/** 资产库：横跨 assets/outputs/model_portraits/layer_exports/patterns/print_packs 的只读投影，独立于任何单一聚合。 */
export class LibraryRepository {
  public constructor(private readonly db: SqliteDatabase, private readonly lookups: LibrarySourceLookups) { }

  /**
   * 资产库视图：assets、outputs、model_portraits 与 layer_exports 逐元素切图合并为一张派生表。
   * **先按条件筛选来源行，再按内容 hash 去重**：同图在多个项目/来源重复时，命中的那条就是代表项，
   * 而不是「先选出最新行、再把它过滤掉」——后者会让卡片显示不符合筛选条件的旧图。
   * 过滤、去重、排序、游标分页全部下推 SQLite，只把当前页物化到 JS。
   * 分页用 (createdAt,id) 合成游标（keyset），且游标只作用在去重后的代表项上，
   * 否则上一页的代表项会把同 hash 的旧行顶成新代表项，同一张图跨页重复出现。
   */
  public listLibraryItems(query: LibraryItemQuery = {}): LibraryItemPage {
    const limit = Math.min(Math.max(query.limit ?? 40, 1), 100);
    const kind = query.kind ?? null;
    const projectId = query.projectId ?? null;
    const needle = query.q?.trim().toLowerCase() ?? "";
    const cursor = decodeLibraryCursor(query.cursor ?? null);

    // 分层导出把每个元素/背景切图作为独立生成产物纳入库；PSD 复合层（composite）二进制不可预览，排除。
    // model_spec_json 只为定妆照行提供模特规格，供按身份维度筛选；其余来源行为 NULL，天然不命中身份筛选。
    const librarySql = `
      SELECT 'asset:' || a.id AS id, 'UPLOADED' AS source,
             CASE WHEN a.role IN ('PRODUCT_TRUTH','PACKAGING') THEN 'PRODUCT' ELSE 'REFERENCE' END AS kind,
             a.project_id AS project_id, p.name AS project_name, a.original_name AS name,
             a.mime_type AS mime_type, a.storage_path AS storage_path, a.hash AS hash,
             a.width AS width, a.height AS height, a.role AS role, a.created_at AS created_at,
             NULL AS model_spec_json
      FROM assets a JOIN projects p ON p.id = a.project_id
      UNION ALL
      SELECT 'output:' || o.id, 'GENERATED', 'GENERATED',
             o.project_id, p.name, COALESCE(si.display_name, si.asset_type, '生成图'),
             NULL, o.storage_path, o.hash, o.width, o.height, NULL, o.created_at,
             NULL
      FROM outputs o JOIN projects p ON p.id = o.project_id
      LEFT JOIN storyboard_items si ON si.id = o.storyboard_item_id
      UNION ALL
      SELECT 'model:' || mp.id, 'MODEL', 'MODEL',
             '', '模特库', m.name,
             NULL, mp.storage_path, mp.hash, mp.width, mp.height, NULL, mp.created_at,
             m.spec_json
      FROM model_portraits mp JOIN models m ON m.id = mp.model_id
      UNION ALL
      SELECT 'layer:' || le.id || ':' || je.key, 'GENERATED', 'LAYER',
             le.project_id, p.name,
             COALESCE(si.display_name, si.asset_type, '生成图') || ' · ' || json_extract(je.value, '$.name'),
             'image/png', json_extract(je.value, '$.storagePath'), json_extract(je.value, '$.hash'),
             o.width, o.height, NULL, le.created_at,
             NULL
      FROM layer_exports le
      JOIN projects p ON p.id = le.project_id
      LEFT JOIN outputs o ON o.id = le.output_id
      LEFT JOIN storyboard_items si ON si.id = o.storyboard_item_id
      CROSS JOIN json_each(le.layer_files_json) je
      WHERE le.status = 'SUCCEEDED' AND le.layer_files_json IS NOT NULL
        AND json_extract(je.value, '$.hash') IS NOT NULL
        AND json_extract(je.value, '$.storagePath') IS NOT NULL
        AND (json_extract(je.value, '$.kind') IS NULL OR json_extract(je.value, '$.kind') <> 'composite')
      UNION ALL
      SELECT 'pattern:' || pt.id,
             CASE WHEN pt.source_type = 'UPLOADED' THEN 'UPLOADED' ELSE 'GENERATED' END, 'PATTERN',
             '', '花型工坊', pt.name,
             'image/png', pt.storage_path, pt.file_hash, pt.width, pt.height, NULL, pt.created_at,
             NULL
      FROM patterns pt
      WHERE pt.storage_path IS NOT NULL AND pt.file_hash IS NOT NULL
      UNION ALL
      SELECT 'pack:' || pk.id || ':' || je.key, 'GENERATED', 'PRINT_PACK',
             '', '花型工坊', pt2.name || ' · ' || pk.spec_id,
             'image/png', json_extract(je.value, '$.storagePath'), json_extract(je.value, '$.hash'),
             NULL, NULL, NULL, pk.created_at,
             NULL
      FROM print_packs pk
      JOIN patterns pt2 ON pt2.id = pk.pattern_id
      CROSS JOIN json_each(pk.files_json) je
      WHERE pk.status = 'SUCCEEDED' AND pk.files_json IS NOT NULL
        AND json_extract(je.value, '$.kind') = 'PRINT_FILE'
        AND json_extract(je.value, '$.hash') IS NOT NULL
        AND json_extract(je.value, '$.storagePath') IS NOT NULL
    `;

    const sourceFilters: string[] = [];
    const sourceParams: Record<string, string | number> = {};
    if (kind) { sourceFilters.push("kind = @kind"); sourceParams.kind = kind; }
    // 模特定妆照的项目归属是空串：按项目筛选时它不命中，也不会被伪造成某个真实项目。
    if (projectId) { sourceFilters.push("project_id = @projectId"); sourceParams.projectId = projectId; }
    // created_at 统一是 canonical ISO（now() 产出），与规范化后的入参做字典序比较即时间序比较。
    if (query.createdFrom) { sourceFilters.push("created_at >= @createdFrom"); sourceParams.createdFrom = query.createdFrom; }
    if (query.createdTo) { sourceFilters.push("created_at <= @createdTo"); sourceParams.createdTo = query.createdTo; }
    // 身份维度取自模特实体的 spec；非定妆照行的 model_spec_json 为 NULL，与等值比较天然为假。
    for (const dimension of LIBRARY_MODEL_SPEC_DIMENSIONS) {
      const value = query.modelSpec?.[dimension];
      if (!value) continue;
      sourceFilters.push(`json_extract(model_spec_json, '$.${dimension}') = @modelSpec_${dimension}`);
      sourceParams[`modelSpec_${dimension}`] = value;
    }
    if (needle) {
      // LIKE 通配符转义保持与"子串包含"语义一致；LOWER 与前端既有的 ASCII 折叠口径相同
      sourceParams.needle = `%${needle.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
      sourceFilters.push("(LOWER(name) LIKE @needle ESCAPE '\\' OR LOWER(project_name) LIKE @needle ESCAPE '\\')");
    }
    const sourceWhere = sourceFilters.length > 0 ? `WHERE ${sourceFilters.join(" AND ")}` : "";

    const pageFilters: string[] = [];
    const params: Record<string, string | number> = { ...sourceParams, limit: limit + 1 };
    if (cursor) {
      params.cursorCreatedAt = cursor.createdAt;
      params.cursorId = cursor.id;
      pageFilters.push("(created_at < @cursorCreatedAt OR (created_at = @cursorCreatedAt AND id < @cursorId))");
    }
    const pageWhere = pageFilters.length > 0 ? `WHERE ${pageFilters.join(" AND ")}` : "";

    const ctes = `
      WITH library AS (${librarySql}),
      filtered AS (SELECT * FROM library ${sourceWhere}),
      ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY hash ORDER BY created_at DESC, id DESC) AS rn FROM filtered),
      deduped AS (SELECT * FROM ranked WHERE rn = 1)
    `;
    const rows = this.db.prepare(`
      ${ctes}
      SELECT *, (SELECT COUNT(*) FROM deduped) AS total_count FROM deduped
      ${pageWhere}
      ORDER BY created_at DESC, id DESC
      LIMIT @limit
    `).all(params) as Row[];

    const items = rows.slice(0, limit).map((row) => {
      const source = String(row.source) as LibraryItemSource;
      return {
        id: String(row.id),
        source,
        kind: String(row.kind) as LibraryItemKind,
        name: String(row.name ?? ""),
        projectId: String(row.project_id),
        projectName: String(row.project_name ?? ""),
        mimeType: row.mime_type ? String(row.mime_type) : mimeTypeForPath(String(row.storage_path)),
        hash: String(row.hash),
        width: row.width === null || row.width === undefined ? null : Number(row.width),
        height: row.height === null || row.height === undefined ? null : Number(row.height),
        storagePath: String(row.storage_path),
        role: row.role ? (String(row.role) as AssetRole) : null,
        createdAt: String(row.created_at),
      };
    });
    const nextCursor = rows.length > limit && items.length > 0 ? encodeLibraryCursor(items[items.length - 1]) : null;
    // 游标越过末尾时当前页为空，但 total 仍要反映完整筛选结果，因此单独兜一次计数。
    const total = rows.length > 0
      ? Number(rows[0].total_count)
      : Number((this.db.prepare(`${ctes} SELECT COUNT(*) AS total_count FROM deduped`).get(sourceParams) as Row | undefined)?.total_count ?? 0);
    return { items, nextCursor, total };
  }

  /** 按内容 hash 找到任一来源文件的存储路径，供缩略图惰性生成。 */
  public findLibrarySourcePath(hash: string): string | undefined {
    const asset = this.db.prepare("SELECT storage_path FROM assets WHERE hash=? LIMIT 1").get(hash) as Row | undefined;
    if (asset) return String(asset.storage_path);
    const output = this.db.prepare("SELECT storage_path FROM outputs WHERE hash=? LIMIT 1").get(hash) as Row | undefined;
    if (output) return String(output.storage_path);
    const layer = this.db.prepare(
      "SELECT json_extract(je.value, '$.storagePath') AS storage_path FROM layer_exports le, json_each(le.layer_files_json) je WHERE json_extract(je.value, '$.hash')=? LIMIT 1",
    ).get(hash) as Row | undefined;
    if (layer?.storage_path) return String(layer.storage_path);
    // 模特定妆照同样进资产库：漏掉这一步，MODEL 条目的缩略图在惰性生成时会 404。
    const portrait = this.db.prepare("SELECT storage_path FROM model_portraits WHERE hash=? LIMIT 1").get(hash) as Row | undefined;
    if (portrait?.storage_path) return String(portrait.storage_path);
    const pattern = this.db.prepare("SELECT storage_path FROM patterns WHERE file_hash=? LIMIT 1").get(hash) as Row | undefined;
    if (pattern?.storage_path) return String(pattern.storage_path);
    const packFile = this.db.prepare(
      "SELECT json_extract(je.value, '$.storagePath') AS storage_path FROM print_packs pk, json_each(pk.files_json) je WHERE json_extract(je.value, '$.hash')=? LIMIT 1",
    ).get(hash) as Row | undefined;
    return packFile?.storage_path ? String(packFile.storage_path) : undefined;
  }

  /** 解析合成库 ID 指向的真实文件；返回 undefined 表示条目已不存在。 */
  public resolveLibrarySource(itemId: string): { source: LibraryItemSource; storagePath: string; hash: string; mimeType: string; originalName: string; role: AssetRole | null } | undefined {
    const separator = itemId.indexOf(":");
    const prefix = separator < 0 ? "" : itemId.slice(0, separator);
    const id = separator < 0 ? "" : itemId.slice(separator + 1);
    if (prefix === "asset") {
      const asset = this.lookups.getAsset(id);
      if (!asset) return undefined;
      return { source: "UPLOADED", storagePath: asset.storagePath, hash: asset.hash, mimeType: asset.mimeType, originalName: asset.originalName, role: asset.role };
    }
    if (prefix === "output") {
      const output = this.lookups.getOutput(id);
      if (!output) return undefined;
      return { source: "GENERATED", storagePath: output.storagePath, hash: output.hash, mimeType: mimeTypeForPath(output.storagePath), originalName: basename(output.storagePath), role: null };
    }
    if (prefix === "layer") {
      // 分层 ID 形如 layer:<layerExportId>:<index>，最后一段是数组下标。
      const lastSeparator = id.lastIndexOf(":");
      const exportId = lastSeparator < 0 ? id : id.slice(0, lastSeparator);
      const index = Number(id.slice(lastSeparator + 1));
      const file = Number.isInteger(index) && index >= 0 ? this.lookups.getLayerExport(exportId)?.layerFiles?.[index] : undefined;
      if (!file || file.kind === "composite") return undefined;
      return { source: "GENERATED", storagePath: file.storagePath, hash: file.hash, mimeType: "image/png", originalName: file.name, role: null };
    }
    if (prefix === "pattern") {
      const pattern = this.lookups.getPattern(id);
      if (!pattern?.storagePath || !pattern.fileHash) return undefined;
      return { source: pattern.sourceType === "UPLOADED" ? "UPLOADED" : "GENERATED", storagePath: pattern.storagePath, hash: pattern.fileHash, mimeType: "image/png", originalName: pattern.name, role: null };
    }
    if (prefix === "pack") {
      // 规格包 ID 形如 pack:<printPackId>:<index>，最后一段是文件数组下标；manifest 文件不作为可预览图。
      const lastSeparator = id.lastIndexOf(":");
      const packId = lastSeparator < 0 ? id : id.slice(0, lastSeparator);
      const index = Number(id.slice(lastSeparator + 1));
      const file = Number.isInteger(index) && index >= 0 ? this.lookups.getPrintPack(packId)?.files?.[index] : undefined;
      if (!file || file.kind !== "PRINT_FILE") return undefined;
      return { source: "GENERATED", storagePath: file.storagePath, hash: file.hash, mimeType: "image/png", originalName: file.name, role: null };
    }
    if (prefix === "model") {
      const portrait = this.lookups.getModelPortrait(id);
      if (!portrait) return undefined;
      const castModel = this.lookups.getModel(portrait.modelId);
      return {
        source: "MODEL",
        storagePath: portrait.storagePath,
        hash: portrait.hash,
        mimeType: mimeTypeForPath(portrait.storagePath),
        originalName: castModel ? `${castModel.name} 定妆照` : "model-portrait",
        role: null,
      };
    }
    return undefined;
  }
}
