import type {
  EcomRepository,
  JobRecord,
  LocalAssetStore,
  SecretBox,
  SqliteDatabase,
  SuiteCatalog,
} from "@ecomgen/core";
import type { EcomJobKind, RedisProjectEventBus } from "@ecomgen/jobs";

/**
 * 领域路由模块共享的运行时句柄，由 buildApi 组装后传给各 registerXxxRoutes。
 * 入队与取消以闭包注入而不是暴露队列实例：入队失败把任务落为 FAILED(QUEUE_UNAVAILABLE)
 * 的回滚顺序只允许存在一份实现（见 app.ts 的 enqueueOrMarkFailed），路由模块不直接触碰 Redis 队列。
 */
export interface ApiContext {
  readonly database: SqliteDatabase;
  readonly repository: EcomRepository;
  readonly storage: LocalAssetStore;
  readonly suiteCatalog: SuiteCatalog;
  readonly secrets: SecretBox;
  readonly events: RedisProjectEventBus;
  readonly enqueueOrMarkFailed: (
    pending: JobRecord | JobRecord[],
    kind: EcomJobKind,
    options?: { onFail?: (jobId: string) => void; markable?: JobRecord[] },
  ) => Promise<void>;
  readonly requestJobCancellation: (id: string) => Promise<JobRecord>;
}
