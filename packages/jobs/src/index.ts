import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { EventEnvelope, JobType } from "@ecomgen/contracts";

export const QUEUE_NAME = process.env.ECOMGEN_QUEUE_NAME ?? "ecomgen";
export type EcomJobKind = "plan" | "copywrite" | "generate" | "export" | "edit_plan" | "edit_generate" | "layer_plan" | "layer_export" | "suite_forge" | "model_cast" | "pattern_extract" | "pattern_forge" | "pattern_derive" | "pattern_variant" | "pattern_tile_check" | "print_pack";
export interface EcomJobPayload { jobId: string; kind: EcomJobKind; }

/**
 * JobType → 队列 kind 的唯一映射：API 入队与 Worker 恢复共用。
 *
 * 这份映射曾在两个应用里各写一份，错一行就会让任务静默落到 "export" 队列且永不被消费；
 * 收进 kind 的定义旁，靠 Record 对 Exclude<JobType, "EXPORT"> 的穷尽性在编译期兜底——
 * contracts 新增 JobType 而这里漏登记时是编译错误，不是运行期静默。
 */
const QUEUE_KIND_BY_JOB_TYPE: Record<Exclude<JobType, "EXPORT">, EcomJobKind> = {
  PLAN: "plan",
  COPYWRITE: "copywrite",
  GENERATE: "generate",
  EDIT_PLAN: "edit_plan",
  EDIT_GENERATE: "edit_generate",
  LAYER_PLAN: "layer_plan",
  LAYER_EXPORT: "layer_export",
  SUITE_FORGE: "suite_forge",
  MODEL_CAST: "model_cast",
  PATTERN_EXTRACT: "pattern_extract",
  PATTERN_FORGE: "pattern_forge",
  PATTERN_DERIVE: "pattern_derive",
  PATTERN_VARIANT: "pattern_variant",
  PATTERN_TILE_CHECK: "pattern_tile_check",
  PRINT_PACK: "print_pack",
};
export function queueKindForJobType(type: JobType): EcomJobKind {
  return type === "EXPORT" ? "export" : QUEUE_KIND_BY_JOB_TYPE[type];
}
export const EVENT_CHANNEL_PREFIX = "ecomgen:project-events:";

export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export function createJobQueue(connection: Redis): Queue<EcomJobPayload> {
  return new Queue<EcomJobPayload>(QUEUE_NAME, { connection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 1000 } });
}

export async function enqueue(queue: Queue<EcomJobPayload>, payload: EcomJobPayload): Promise<void> {
  // 图像请求可能已经在 Provider 侧生效；生成任务保留手动重试，避免 BullMQ 自动再次计费。
  // layer_export 同理：SAM 分割按次计费，失败后不自动重跑。
  // model_cast 选角同为付费生图，与 generate 一致不自动重跑。
  // pattern_extract 的分割调用与 pattern_forge、pattern_variant 的生图调用同为按次计费，同样不自动重跑。
  // pattern_derive、pattern_tile_check 与 print_pack 同为 Worker 本地 sharp 确定性运算，无外部计费，可以自动重跑。
  // 规划与图层识别耗时分钟级，完整重跑代价高，最多尝试 2 次（失败后自动重跑 1 次）。
  // 套图反推同为纯推理视觉任务、无付费图生图，按 plan 处理：最多尝试 2 次。
  const attempts = payload.kind === "generate" || payload.kind === "edit_generate" || payload.kind === "layer_export" || payload.kind === "model_cast" || payload.kind === "pattern_extract" || payload.kind === "pattern_forge" || payload.kind === "pattern_variant" ? 1 : payload.kind === "plan" || payload.kind === "layer_plan" || payload.kind === "suite_forge" ? 2 : 3;
  const options: JobsOptions = { jobId: payload.jobId, attempts, backoff: { type: "exponential", delay: 1000 } };
  await queue.add(payload.kind, payload, options);
}

export class RedisProjectEventBus {
  private readonly listeners = new Map<string, Set<(event: EventEnvelope) => void>>();
  private started = false;

  public constructor(private readonly publisher: Redis, private readonly subscriber: Redis) { }

  public async publish(projectId: string, type: EventEnvelope["type"], data: unknown): Promise<EventEnvelope> {
    const event: EventEnvelope = { id: randomUUID(), projectId, type, occurredAt: new Date().toISOString(), data };
    await this.publisher.publish(`${EVENT_CHANNEL_PREFIX}${projectId}`, JSON.stringify(event));
    return event;
  }

  public async subscribe(projectId: string, listener: (event: EventEnvelope) => void): Promise<() => Promise<void>> {
    if (!this.started) {
      this.started = true;
      this.subscriber.on("message", (channel: string, payload: string) => {
        const projectId = channel.startsWith(EVENT_CHANNEL_PREFIX) ? channel.slice(EVENT_CHANNEL_PREFIX.length) : "";
        if (!projectId) return;
        try { for (const handler of this.listeners.get(projectId) ?? []) handler(JSON.parse(payload) as EventEnvelope); } catch { /* Invalid external message must not break SSE. */ }
      });
    }
    const handlers = this.listeners.get(projectId) ?? new Set<(event: EventEnvelope) => void>();
    handlers.add(listener); this.listeners.set(projectId, handlers);
    if (handlers.size === 1) await this.subscriber.subscribe(`${EVENT_CHANNEL_PREFIX}${projectId}`);
    return async () => {
      const active = this.listeners.get(projectId); if (!active) return;
      active.delete(listener);
      if (active.size === 0) { this.listeners.delete(projectId); await this.subscriber.unsubscribe(`${EVENT_CHANNEL_PREFIX}${projectId}`); }
    };
  }

  public async close(): Promise<void> { await Promise.all([this.publisher.quit(), this.subscriber.quit()]); }
}
