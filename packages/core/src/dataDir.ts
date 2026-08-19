import { resolve } from "node:path";

/**
 * 以仓库根目录解析相对数据目录，避免 API 和 Worker 因工作目录不同而打开不同 SQLite。
 */
export function resolveDataDir(configuredPath: string | undefined, projectRoot: string): string {
  return resolve(projectRoot, configuredPath ?? "data");
}
