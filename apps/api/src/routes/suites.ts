import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { SuiteCatalog, SuiteListQuery } from "@ecomgen/core";
import { SUITE_PAGE_SIZE_DEFAULT, SUITE_PAGE_SIZE_MAX } from "@ecomgen/core";
import type { SuiteOrigin } from "@ecomgen/ecom-suite";
import { SUITE_TAXONOMY } from "@ecomgen/ecom-suite";
import { EcomSuiteFile, MAX_REQUESTED_SUITE_SHOTS, validateEcomSuiteFile } from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import { missing } from "../helpers.js";
import { parseBody } from "../http-input.js";
import { parameter, readOptionalTextArray } from "../input-normalizers.js";

const SUITE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
/** ids 回读只服务“已选分镜所属套图”，上限按单次选择的量级留一倍余量。 */
const MAX_SUITE_IDS_QUERY = 24;

/** 导入套图必须落在 custom-suite- 命名空间，避免覆盖内置或目录投放套图。 */
export function suiteIdForImport(requested: string | undefined, catalog: SuiteCatalog): string {
  if (requested) {
    if (!requested.startsWith("custom-suite-") || !SUITE_ID_PATTERN.test(requested)) throw new ApiError(400, "VALIDATION_ERROR", "Imported suite id must start with custom-suite- and use lowercase letters, digits, dot, dash or underscore");
    if (catalog.getSuite(requested)) throw new ApiError(409, "CONFLICT", `Suite id already exists: ${requested}`);
    return requested;
  }
  let id = `custom-suite-${randomBytes(4).toString("hex")}`;
  while (catalog.getSuite(id)) id = `custom-suite-${randomBytes(4).toString("hex")}`;
  return id;
}

export function assertValidSuiteDocument(value: unknown): void {
  const result = validateEcomSuiteFile(value);
  if (!result.ok) throw new ApiError(400, "VALIDATION_ERROR", "Invalid suite document", result.errors.map((reason) => ({ path: "/", reason })));
}

/** 套图列表查询参数：ids 是“精确回读已选分镜所属套图”的旁路，存在时不再走分页。 */
export function parseSuiteListQuery(query: unknown): SuiteListQuery {
  const source = (query ?? {}) as Record<string, unknown>;
  const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  const rawLimit = text(source.limit);
  const parsedLimit = rawLimit === undefined ? undefined : Number.parseInt(rawLimit, 10);
  if (rawLimit !== undefined && !Number.isFinite(parsedLimit)) throw new ApiError(400, "VALIDATION_ERROR", "limit must be an integer");
  const ids = text(source.ids)?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  if (ids.length > MAX_SUITE_IDS_QUERY) throw new ApiError(400, "VALIDATION_ERROR", `ids supports at most ${MAX_SUITE_IDS_QUERY} suite IDs`);
  return {
    q: text(source.q),
    l1: text(source.l1),
    l2: text(source.l2),
    origin: parseSuiteOrigin(text(source.origin)),
    ids: ids.length ? [...new Set(ids)] : undefined,
    cursor: text(source.cursor) ?? null,
    limit: parsedLimit === undefined ? SUITE_PAGE_SIZE_DEFAULT : Math.min(Math.max(parsedLimit, 1), SUITE_PAGE_SIZE_MAX)
  };
}

/** 来源只接受契约枚举内的两个字面量；未知取值报 400，避免前端拼错参数时静默退化成“全部”。 */
function parseSuiteOrigin(value: string | undefined): SuiteOrigin | undefined {
  if (value === undefined) return undefined;
  if (value !== "builtin" && value !== "user") throw new ApiError(400, "VALIDATION_ERROR", "origin must be builtin or user");
  return value;
}

/** 手动规划可混选套图分镜与单图模板；分镜 assetType 必须是当前编目已知项，未知即报错而非静默丢弃。 */
export function resolveRequestedSuiteShots(requested: unknown, catalog: SuiteCatalog): string[] {
  const assetTypes = readOptionalTextArray(requested) ?? [];
  if (assetTypes.length === 0) return [];
  if (assetTypes.length > MAX_REQUESTED_SUITE_SHOTS) throw new ApiError(400, "VALIDATION_ERROR", `requestedSuiteShots supports at most ${MAX_REQUESTED_SUITE_SHOTS} shots`);
  const resolved: string[] = [];
  for (const assetType of assetTypes) {
    if (!catalog.resolveShot(assetType)) throw new ApiError(400, "VALIDATION_ERROR", `requestedSuiteShots contains an unknown suite shot: ${assetType}`);
    if (!resolved.includes(assetType)) resolved.push(assetType);
  }
  return resolved;
}

export function registerSuiteRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, suiteCatalog } = ctx;
  app.get("/api/v1/suites", async (request) => suiteCatalog.pageSummaries(parseSuiteListQuery(request.query)));
  app.get("/api/v1/suite-categories", async () => ({ l1: [...SUITE_TAXONOMY.l1], l2: SUITE_TAXONOMY.l2 }));
  app.post("/api/v1/suites/refresh", async () => { await suiteCatalog.refresh(); return suiteCatalog.pageSummaries(); });
  app.get("/api/v1/suites/:suiteId", async (request) => {
    const id = parameter(request, "suiteId"); const suite = suiteCatalog.getSuite(id); if (!suite) missing("suite", id);
    return suite;
  });
  app.post("/api/v1/suites", async (request, reply) => {
    const body = parseBody(EcomSuiteFile, request.body);
    assertValidSuiteDocument(body);
    const id = suiteIdForImport(body.id, suiteCatalog);
    const record = repository.saveUserSuite({ id, name: body.name, l1: body.category.l1, l2: body.category.l2, leaf: body.category.leaf, productFamily: body.productFamily ?? null, payload: { ...body, id } });
    suiteCatalog.upsertUserSuite(record);
    const suite = suiteCatalog.getSuite(id); if (!suite) throw new ApiError(500, "INTERNAL_ERROR", "Suite was saved but could not be indexed");
    return reply.code(201).send(suite);
  });
  app.patch("/api/v1/suites/:suiteId", async (request) => {
    const id = parameter(request, "suiteId"); if (!repository.getUserSuite(id)) missing("user suite", id);
    const body = parseBody(EcomSuiteFile, request.body);
    assertValidSuiteDocument(body);
    const record = repository.saveUserSuite({ id, name: body.name, l1: body.category.l1, l2: body.category.l2, leaf: body.category.leaf, productFamily: body.productFamily ?? null, payload: { ...body, id } });
    suiteCatalog.upsertUserSuite(record);
    const suite = suiteCatalog.getSuite(id); if (!suite) missing("suite", id);
    return suite;
  });
  app.delete("/api/v1/suites/:suiteId", async (request, reply) => {
    const id = parameter(request, "suiteId");
    // 内置套图与目录投放套图不落库，只有导入套图可删；引用它的旧分镜在生成期显式报错，不做静默降级
    if (!repository.getUserSuite(id)) throw new ApiError(409, "CONFLICT", "Only user-imported suites can be deleted");
    repository.deleteUserSuite(id);
    suiteCatalog.removeUserSuite(id);
    return reply.code(204).send();
  });
}
