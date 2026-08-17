import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "@ecomgen/contracts";

export class ProjectEventBus {
  private readonly emitter = new EventEmitter();

  public publish(projectId: string, type: EventEnvelope["type"], data: unknown): EventEnvelope {
    const event: EventEnvelope = { id: randomUUID(), projectId, type, data, occurredAt: new Date().toISOString() };
    this.emitter.emit(`project:${projectId}`, event);
    return event;
  }

  public subscribe(projectId: string, listener: (event: EventEnvelope) => void): () => void {
    const channel = `project:${projectId}`;
    this.emitter.on(channel, listener);
    return () => this.emitter.off(channel, listener);
  }
}
