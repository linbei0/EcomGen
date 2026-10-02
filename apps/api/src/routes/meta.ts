import type { FastifyInstance } from "fastify";
import { ECOM_DETAILS_IMAGE_SOURCE, ECOM_TEMPLATES } from "@ecomgen/ecom-skill";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import { ensureProject } from "../helpers.js";

export function registerMetaRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, events } = ctx;
  app.get("/health", async () => ({ status: "ok", webResearchAvailable: repository.listSearchSources().some((source) => source.enabled && (source.kind === "searxng" || source.encryptedApiKey)) }));
  app.get("/api/v1/ecom-templates", async () => ({ source: ECOM_DETAILS_IMAGE_SOURCE, items: ECOM_TEMPLATES }));
  app.get("/api/v1/events", { sse: "only" }, async (request, reply) => {
    const projectId = typeof request.query === "object" && request.query && "projectId" in request.query ? String((request.query as Record<string, unknown>).projectId) : ""; if (!projectId) throw new ApiError(400, "VALIDATION_ERROR", "projectId query parameter is required"); ensureProject(repository, projectId);
    reply.sse.keepAlive(); const unsubscribe = await events.subscribe(projectId, (event) => { void reply.sse.send({ id: event.id, event: event.type, data: event }); }); reply.sse.onClose(() => { void unsubscribe(); }); await reply.sse.send({ event: "connected", data: { projectId } });
  });
}
