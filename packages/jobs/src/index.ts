import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "@ecomgen/contracts";

export const QUEUE_NAME = process.env.ECOMGEN_QUEUE_NAME ?? "ecomgen";
export type EcomJobKind = "plan" | "copywrite" | "generate" | "export" | "edit_plan" | "edit_generate";
export interface EcomJobPayload { jobId: string; kind: EcomJobKind; }
export const EVENT_CHANNEL_PREFIX = "ecomgen:project-events:";

export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export function createJobQueue(connection: Redis): Queue<EcomJobPayload> {
  return new Queue<EcomJobPayload>(QUEUE_NAME, { connection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 1000 } });
}

export async function enqueue(queue: Queue<EcomJobPayload>, payload: EcomJobPayload): Promise<void> {
  // 图像请求可能已经在 Provider 侧生效；生成任务保留手动重试，避免 BullMQ 自动再次计费。
  const attempts = payload.kind === "generate" || payload.kind === "edit_generate" ? 1 : 3;
  const options: JobsOptions = { jobId: payload.jobId, attempts, backoff: { type: "exponential", delay: 1000 } };
  await queue.add(payload.kind, payload, options);
}

export class RedisProjectEventBus {
  private readonly listeners = new Map<string, Set<(event: EventEnvelope) => void>>();
  private started = false;

  public constructor(private readonly publisher: Redis, private readonly subscriber: Redis) {}

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
