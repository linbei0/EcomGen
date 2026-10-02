import { randomUUID } from "node:crypto";
import { join } from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { fastifySSE } from "@fastify/sse";
import Fastify, { type FastifyInstance } from "fastify";
import { EcomRepository, LocalAssetStore, SecretBox, SuiteCatalog, openDatabase, type JobRecord } from "@ecomgen/core";
import { createJobQueue, createRedisConnection, enqueue, queueKindForJobType, RedisProjectEventBus, type EcomJobKind } from "@ecomgen/jobs";
import { MAX_SUITE_FORGE_SOURCES, MAX_UPLOAD_FILE_BYTES } from "@ecomgen/contracts";

import { ApiError } from "./errors.js";
import type { ApiContext } from "./context.js";
import { missing } from "./helpers.js";
import { registerEditSessionRoutes } from "./routes/editSessions.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerMetaRoutes } from "./routes/meta.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerOutputRoutes } from "./routes/outputs.js";
import { registerPatternPipelineRoutes } from "./routes/patternPipelines.js";
import { registerPatternRoutes } from "./routes/patterns.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerProviderRoutes } from "./routes/providers.js";
import { registerSearchSourceRoutes } from "./routes/searchSources.js";
import { registerSuiteForgeRoutes } from "./routes/suiteForge.js";
import { registerSuiteRoutes } from "./routes/suites.js";
import { registerStoryboardRoutes } from "./routes/storyboard.js";
import { registerUserTemplateRoutes } from "./routes/userTemplates.js";
import { registerWebStatic } from "./web-static.js";

export interface ApiOptions { dataDir: string; redisUrl: string; masterKey: string; corsOrigins?: string[]; }

/** 未显式配置时的默认允许来源：本机 web dev server。API 自托管前端时为同源请求，不依赖 CORS。 */
export const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

/**
 * 校验 CORS 允许列表：项目没有认证层，允许任意来源等于把读写接口开放给任意站点。
 * 拒绝通配符、空值和非 origin 形态（带路径、查询或非 http/https 协议），让配置错误在启动时暴露。
 */
export function resolveCorsOrigins(configured?: string[]): string[] {
  const origins = configured ?? DEFAULT_CORS_ORIGINS;
  if (origins.length === 0) throw new Error("CORS origins must not be empty");
  for (const origin of origins) {
    if (origin.trim() !== origin || origin === "") throw new Error(`Invalid CORS origin: "${origin}"`);
    if (origin === "*") throw new Error("CORS origin must not be a wildcard; list explicit origins instead");
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new Error(`Invalid CORS origin: "${origin}"`); }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new Error(`Invalid CORS origin (must be scheme://host[:port]): "${origin}"`);
    }
  }
  return origins;
}

export async function buildApi(options: ApiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, genReqId: () => randomUUID() });
  const database = openDatabase(join(options.dataDir, "ecomgen.sqlite"));
  const repository = new EcomRepository(database);
  const suiteCatalog = new SuiteCatalog({ dataDir: options.dataDir, repository });
  await suiteCatalog.refresh();
  const storage = new LocalAssetStore(options.dataDir); await storage.initialize();
  const secrets = new SecretBox(options.masterKey);
  const redis = createRedisConnection(options.redisUrl);
  const queue = createJobQueue(redis);
  const events = new RedisProjectEventBus(redis.duplicate(), redis.duplicate());
  await app.register(cors, { origin: resolveCorsOrigins(options.corsOrigins) });
  // 全局 multipart 上限作用于所有上传路由；files 取套图源图上限，因为它是唯一的批量多文件入口。
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_FILE_BYTES, files: MAX_SUITE_FORGE_SOURCES } });
  await app.register(fastifySSE, { heartbeatInterval: 20_000 });
  app.addHook("onClose", async () => { await events.close(); await queue.close(); database.close(); });
  /**
   * 入队是持久化之后的第二步：数据库已落 QUEUED 而入队失败时，任务永远不会执行，
   * 且相同指纹会继续复用这个坏状态。这里把尚未入队的任务统一落为 FAILED(QUEUE_UNAVAILABLE)
   * 并发布状态事件；顺序入队保证只回滚真正未入队的任务，已入队的照常执行。
   */
  /**
   * pending 全部尝试入队；失败时只把 markable（默认即 pending，生成批次要传“本次新建”子集）
   * 及其后未入队者统一落为 FAILED(QUEUE_UNAVAILABLE) 并发布事件——按指纹复用的既有任务
   * 不属于本请求的失败面，不能被改写状态。顺序入队保证只回滚真正未入队的任务，已入队的照常执行。
   */
  async function enqueueOrMarkFailed(pending: JobRecord | JobRecord[], kind: EcomJobKind, enqueueOptions: { onFail?: (jobId: string) => void; markable?: JobRecord[] } = {}): Promise<void> {
    const jobs = Array.isArray(pending) ? pending : [pending];
    const markable = new Set((enqueueOptions.markable ?? jobs).map((job) => job.id));
    for (let index = 0; index < jobs.length; index++) {
      const job = jobs[index];
      try {
        await enqueue(queue, { jobId: job.id, kind });
      } catch (error) {
        app.log.error(error, "enqueue failed for job %s", job.id);
        const message = "任务已创建但队列暂不可用，请稍后重试";
        for (const remaining of jobs.slice(index)) {
          if (!markable.has(remaining.id)) continue;
          enqueueOptions.onFail?.(remaining.id);
          const failed = repository.updateJob(remaining.id, { status: "FAILED", progress: 100, error: { code: "QUEUE_UNAVAILABLE", message } });
          if (failed && failed.projectId) await events.publish(failed.projectId, "job.updated", failed);
        }
        throw new ApiError(503, "QUEUE_UNAVAILABLE", message);
      }
    }
  }
  /**
   * 请求取消一个任务：已失败任务直接落 CANCELLED（没有可中断的队列工作，但需要关闭失败提示并留审计记录）；
   * 仍在队列中等待的移出队列；已在执行的只置取消标记，由 Worker 断开在途请求。
   * 抽成函数是因为流水线取消也要走同一条路径——两处各写一份必然会丢其中一种情况。
   */
  async function requestJobCancellation(id: string): Promise<JobRecord> {
    const current = repository.getJob(id);
    if (!current) missing("job", id);
    if (current.status === "FAILED") return repository.updateJob(id, { status: "CANCELLED", cancelRequested: true }) ?? current;
    const queued = await queue.getJob(id);
    const state = queued ? await queued.getState() : "unknown";
    if (queued && ["waiting", "delayed", "prioritized"].includes(state)) {
      await queued.remove();
      return repository.updateJob(id, { status: "CANCELLED", cancelRequested: true }) ?? current;
    }
    return repository.updateJob(id, { cancelRequested: true }) ?? current;
  }
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof ApiError;
    const status = known ? error.statusCode : 500;
    request.log.error(error);
    return reply.status(status).send({ error: { code: known ? error.code : "INTERNAL_ERROR", message: known ? error.message : "Unexpected server error", details: known ? error.details : [], requestId: request.id } });
  });

  // 领域路由只经 ctx 触达基础设施；入队/取消闭包保证失败回滚顺序只有一份实现。
  const ctx: ApiContext = { database, repository, storage, suiteCatalog, secrets, events, enqueueOrMarkFailed, requestJobCancellation };
  registerMetaRoutes(app, ctx);
  registerUserTemplateRoutes(app, ctx);
  registerSuiteRoutes(app, ctx);
  registerSuiteForgeRoutes(app, ctx);
  registerModelRoutes(app, ctx);
  registerPatternRoutes(app, ctx);
  registerPatternPipelineRoutes(app, ctx);
  registerProviderRoutes(app, ctx);
  registerSearchSourceRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerStoryboardRoutes(app, ctx);
  registerEditSessionRoutes(app, ctx);
  registerJobRoutes(app, ctx);
  registerOutputRoutes(app, ctx);
  registerFileRoutes(app, ctx);
  await registerWebStatic(app);
  return app;
}
