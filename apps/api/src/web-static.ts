import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyRequest } from "fastify";

// 单镜像部署：生产环境由 API 托管 apps/web/dist，浏览器同源访问 /api/v1，
// VPS 用户 docker compose up 后打开同一端口即是完整可用的页面，无需再配置 VITE_API_BASE_URL。
// dist 不存在（本地开发只跑 API）时跳过注册，不影响 dev 工作流。
export async function registerWebStatic(app: FastifyInstance): Promise<void> {
  const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (!existsSync(distDir)) return;
  await app.register(fastifyStatic, {
    root: distDir,
    // wildcard:false 只为 dist 内实际存在的文件注册路由，未知路径落入
    // notFoundHandler：SPA 路由回退到 index.html，API 前缀仍返回 JSON 404。
    wildcard: false,
  });
  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? "/";
    if (request.method === "GET" && !url.startsWith("/api/") && url !== "/api" && !url.startsWith("/health")) {
      return reply.sendFile("index.html");
    }
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Route ${request.method} ${request.url} not found`, details: [], requestId: (request as FastifyRequest).id } });
  });
}
