import { resolve } from "node:path";
import { resolveDataDir } from "@ecomgen/core";
import { buildApi } from "./app.js";

const masterKey = process.env.ECOMGEN_MASTER_KEY;
if (!masterKey) throw new Error("ECOMGEN_MASTER_KEY must be a base64-encoded 32-byte key");
const projectRoot = resolve(import.meta.dirname, "../../..");
const app = await buildApi({
  dataDir: resolveDataDir(process.env.ECOMGEN_DATA_DIR, projectRoot),
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  masterKey,
  corsOrigins: corsOriginsFromEnv(process.env.ECOMGEN_CORS_ORIGINS),
});
await app.listen({ host: process.env.HOST ?? "127.0.0.1", port: Number(process.env.PORT ?? 8787) });

// 收到终止信号时尝试优雅关闭；SSE 等长连接可能阻塞 close()，超时后强制退出兜底。
// Windows 上 wrapper 的 taskkill 强杀路径不经过这里，孤儿清理由 watchdog 负责兜底。
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    const forceTimer = setTimeout(() => process.exit(0), 3000);
    forceTimer.unref();
    void app.close().finally(() => process.exit(0));
  });
}

/** ECOMGEN_CORS_ORIGINS 是逗号分隔的来源白名单；显式设置为空视为配置错误而非静默回退。 */
function corsOriginsFromEnv(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const entries = raw.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => entry === "")) throw new Error("ECOMGEN_CORS_ORIGINS must not contain empty origins");
  return entries;
}
