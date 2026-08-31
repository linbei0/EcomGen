import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface VisionDerivativeKey {
  sourceHash: string;
  maxEdge: number;
  jpegQuality: number;
  mimeType: string;
}

export interface VisionDerivative {
  data: Buffer;
  mimeType: string;
}

const CACHE_VERSION = "v1";
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** 只缓存视觉理解用的压缩衍生图；生图和像素保护仍使用原图。 */
export class VisionDerivativeCache {
  private readonly memory = new Map<string, VisionDerivative>();
  private readonly root: string;

  public constructor(dataDir: string) {
    this.root = join(dataDir, "vision-cache");
  }

  public async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await this.cleanupExpired();
  }

  public async getOrCreate(key: VisionDerivativeKey, create: () => Promise<VisionDerivative>): Promise<VisionDerivative> {
    const cacheKey = this.key(key);
    const memory = this.memory.get(cacheKey);
    if (memory) return memory;
    const path = join(this.root, `${cacheKey}.bin`);
    try {
      const data = await readFile(path);
      const result = { data, mimeType: key.mimeType };
      this.memory.set(cacheKey, result);
      return result;
    } catch {
      const result = await create();
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, result.data);
      await rename(temporary, path).catch(async (error: unknown) => {
        try { await unlink(temporary); } catch { /* 并发写入者已经完成时忽略临时文件清理错误。 */ }
        if (!(await this.exists(path))) throw error;
      });
      this.memory.set(cacheKey, result);
      return result;
    }
  }

  private key(input: VisionDerivativeKey): string {
    return createHash("sha256").update(JSON.stringify({ version: CACHE_VERSION, ...input })).digest("hex");
  }

  private async exists(path: string): Promise<boolean> {
    try { await stat(path); return true; } catch { return false; }
  }

  private async cleanupExpired(): Promise<void> {
    try {
      const now = Date.now();
      for (const entry of await readdir(this.root)) {
        const path = join(this.root, entry);
        const info = await stat(path).catch(() => undefined);
        if (info && now - info.mtimeMs > RETENTION_MS) await unlink(path).catch(() => undefined);
      }
    } catch {
      // 缓存清理失败不能阻断 Worker 启动，后续请求仍可正常生成衍生图。
    }
  }
}
