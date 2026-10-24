import { API_BASE_URL } from "../config/env";

function isBrowserUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/");
}

/**
 * 运行时 Asset 常只有 storagePath、没有契约里的 url（缺口 13.2）。
 * 可导航的 url 优先；否则回退 GET /files/assets/{id}。
 */
export function assetPreviewUrl(asset: { id: string; url?: string | null }): string {
  if (typeof asset.url === "string" && isBrowserUrl(asset.url)) return asset.url;
  return `${API_BASE_URL}/files/assets/${asset.id}`;
}

export function outputPreviewUrl(output: { id: string; url?: string | null }): string {
  if (typeof output.url === "string" && isBrowserUrl(output.url)) return output.url;
  return `${API_BASE_URL}/files/outputs/${output.id}`;
}

/** 输出的 512px webp 缩略图；没有 hash 或缩略图缺失时调用方回退 outputPreviewUrl。 */
export function outputThumbnailUrl(output: { hash?: string | null }): string | null {
  if (typeof output.hash !== "string" || output.hash.length === 0) return null;
  return `${API_BASE_URL}/files/thumbnails/${output.hash}`;
}
