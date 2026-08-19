import { resolve } from "node:path";
import { resolveDataDir } from "@ecomgen/core";
import { buildApi } from "./app.js";

const masterKey = process.env.ECOMGEN_MASTER_KEY;
if (!masterKey) throw new Error("ECOMGEN_MASTER_KEY must be a base64-encoded 32-byte key");
const projectRoot = resolve(import.meta.dirname, "../../..");
const app = await buildApi({ dataDir: resolveDataDir(process.env.ECOMGEN_DATA_DIR, projectRoot), redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379", masterKey });
await app.listen({ host: process.env.HOST ?? "127.0.0.1", port: Number(process.env.PORT ?? 8787) });
