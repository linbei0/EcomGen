import type { FastifyInstance } from "fastify";
import type { SearchSourceRecord } from "@ecomgen/core";
import { CreateSearchSourceInput, UpdateSearchSourceInput } from "@ecomgen/contracts";
import type { SearchSourceKind } from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import { missing } from "../helpers.js";
import { parseBody } from "../http-input.js";
import { enumValue, parameter, readBoolean, readOptionalText, readPriority, readText, searchSourceBaseUrl } from "../input-normalizers.js";

function publicSearchSource(value: SearchSourceRecord): object { const { encryptedApiKey, ...source } = value; return { ...source, hasApiKey: Boolean(encryptedApiKey) }; }

export function registerSearchSourceRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, secrets } = ctx;
  app.get("/api/v1/search-sources", async () => ({ items: repository.listSearchSources().map(publicSearchSource), nextCursor: null }));
  app.post("/api/v1/search-sources", async (request, reply) => {
    const body = parseBody(CreateSearchSourceInput, request.body);
    const kind = enumValue<SearchSourceKind>(body.kind, ["brave", "tavily", "searxng"], "kind");
    const apiKey = readOptionalText(body.apiKey);
    if (kind !== "searxng" && !apiKey) throw new ApiError(400, "VALIDATION_ERROR", "apiKey is required for this search source");
    const record = repository.saveSearchSource({ name: readText(body.name, "name"), kind, baseUrl: searchSourceBaseUrl(kind, readOptionalText(body.baseUrl)), encryptedApiKey: apiKey ? secrets.encrypt(apiKey) : null, priority: readPriority(body.priority), enabled: body.enabled === undefined ? true : readBoolean(body.enabled, "enabled") });
    return reply.code(201).send(publicSearchSource(record));
  });
  app.patch("/api/v1/search-sources/:sourceId", async (request) => {
    const id = parameter(request, "sourceId"); const current = repository.getSearchSource(id); if (!current) missing("search source", id);
    const body = parseBody(UpdateSearchSourceInput, request.body);
    const kind = body.kind === undefined ? current.kind : enumValue<SearchSourceKind>(body.kind, ["brave", "tavily", "searxng"], "kind");
    const apiKey = readOptionalText(body.apiKey);
    const encryptedApiKey = apiKey ? secrets.encrypt(apiKey) : current.encryptedApiKey;
    if (kind !== "searxng" && !encryptedApiKey) throw new ApiError(400, "VALIDATION_ERROR", "apiKey is required for this search source");
    return publicSearchSource(repository.saveSearchSource({ id, name: readOptionalText(body.name) ?? current.name, kind, baseUrl: searchSourceBaseUrl(kind, readOptionalText(body.baseUrl) ?? current.baseUrl), encryptedApiKey, priority: body.priority === undefined ? current.priority : readPriority(body.priority), enabled: body.enabled === undefined ? current.enabled : readBoolean(body.enabled, "enabled") }));
  });
  app.delete("/api/v1/search-sources/:sourceId", async (request, reply) => { const id = parameter(request, "sourceId"); if (!repository.deleteSearchSource(id)) missing("search source", id); return reply.code(204).send(); });
}
