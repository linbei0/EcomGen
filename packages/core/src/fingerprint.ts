import { createHash } from "node:crypto";

/** 键排序后的结构化值：同一业务状态在不同字段插入顺序下得到同一序列化结果。 */
export function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  return value;
}

// 对对象键排序，确保同一业务请求在不同字段插入顺序下得到同一指纹。
export function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}
