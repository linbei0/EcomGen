import { API_BASE_URL } from "../config/env";

/** 图层编排里的一个图层：id 取 downloadUrl（记录内唯一且稳定，可作 key/显隐标识）。 */
export interface StackLayer { id: string; name: string; kind: "element" | "background"; downloadUrl: string; }

/** 产物 downloadUrl 是裸 /files/... 路径；外部链接原样返回。 */
export function resolveAssetUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** 数组语义 bottom→top（下标 0 最底层）；把 from 移到 to，越界收敛，返回新数组。 */
export function moveLayer(layers: readonly StackLayer[], from: number, to: number): StackLayer[] {
  const next = [...layers];
  const boundedFrom = Math.max(0, Math.min(next.length - 1, from));
  const boundedTo = Math.max(0, Math.min(next.length - 1, to));
  const moved = next.splice(boundedFrom, 1)[0];
  if (!moved) return next;
  next.splice(boundedTo, 0, moved);
  return next;
}

export function layerDisplayName(name: string): string {
  return name.replace(/\.png$/i, "");
}

export function numberedName(index: number, name: string): string {
  return `${String(index).padStart(2, "0")}_${name}`;
}

export function visibleLayers(layers: readonly StackLayer[], hiddenIds: ReadonlySet<string>): StackLayer[] {
  return layers.filter((layer) => !hiddenIds.has(layer.id));
}

/** manifest 记录层序语义：order 为完整当前层序（bottom→top），included/excluded 按同序拆分。 */
export function buildManifest(source: { exportId: string; outputId: string; createdAt: string }, layers: readonly StackLayer[], hiddenIds: ReadonlySet<string>): string {
  const included: string[] = [];
  const excluded: string[] = [];
  for (const layer of layers) (hiddenIds.has(layer.id) ? excluded : included).push(layer.name);
  return JSON.stringify({ source, exportedAt: new Date().toISOString(), order: layers.map((layer) => layer.name), included, excluded }, null, 2);
}

export function buildZipEntries(layers: readonly StackLayer[], hiddenIds: ReadonlySet<string>, bytesByUrl: ReadonlyMap<string, Uint8Array>, manifest: string): Array<{ name: string; data: Uint8Array }> {
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  let sequence = 0;
  for (const layer of layers) {
    if (hiddenIds.has(layer.id)) continue;
    const data = bytesByUrl.get(layer.downloadUrl);
    if (!data) throw new Error(`图层文件缺失：${layer.name}`);
    sequence += 1;
    entries.push({ name: `${numberedName(sequence, layerDisplayName(layer.name))}.png`, data });
  }
  entries.push({ name: "manifest.json", data: new TextEncoder().encode(manifest) });
  return entries;
}

/** children 为 bottom→top 仅可见层；compositeImageData 存在时作为文档底图交给 ag-psd。 */
export function buildPsdDocument(width: number, height: number, layers: readonly StackLayer[], hiddenIds: ReadonlySet<string>, imageDataByUrl: ReadonlyMap<string, ImageData>, compositeImageData?: ImageData): Record<string, unknown> {
  const children = visibleLayers(layers, hiddenIds).map((layer) => {
    const imageData = imageDataByUrl.get(layer.downloadUrl);
    if (!imageData) throw new Error(`图层文件缺失：${layer.name}`);
    return { name: layerDisplayName(layer.name), imageData, left: 0, top: 0 };
  });
  return compositeImageData ? { width, height, children, compositeImageData } : { width, height, children };
}

/** 可见层按 bottom→top 顺序 source-over 合成；putImageData 到临时画布再 drawImage 保证 alpha 正确混合。 */
export function drawComposite(layers: readonly StackLayer[], imageDataByUrl: ReadonlyMap<string, ImageData>): OffscreenCanvas {
  const first = layers.map((layer) => imageDataByUrl.get(layer.downloadUrl)).find(Boolean);
  if (!first) throw new Error("图层文件缺失");
  const canvas = new OffscreenCanvas(first.width, first.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建画布上下文");
  for (const layer of layers) {
    const data = imageDataByUrl.get(layer.downloadUrl);
    if (!data) throw new Error(`图层文件缺失：${layer.name}`);
    const tile = new OffscreenCanvas(data.width, data.height);
    tile.getContext("2d")?.putImageData(data, 0, 0);
    context.drawImage(tile, 0, 0);
  }
  return canvas;
}

/** 按并发上限拉取图层字节；任一失败即整体失败（错误路径不静默）。 */
export async function fetchLayerBytes(urls: readonly string[], limit = 4): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const result = new Map<string, Uint8Array<ArrayBuffer>>();
  const failures: string[] = [];
  let next = 0;
  const runWorker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      if (url === undefined) break;
      try {
        const response = await fetch(resolveAssetUrl(url));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        result.set(url, new Uint8Array(await response.arrayBuffer()));
      } catch (cause) {
        failures.push(`${url}（${cause instanceof Error ? cause.message : String(cause)}）`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, runWorker));
  if (failures.length > 0) throw new Error(`图层文件下载失败：${failures.join("、")}`);
  return result;
}

/** createImageBitmap 解码为全尺寸 ImageData（并发上限），bitmap 用完即释放控制内存峰值。 */
export async function decodeImageDatas(bytesByUrl: ReadonlyMap<string, Uint8Array<ArrayBuffer>>, limit = 4): Promise<Map<string, ImageData>> {
  const result = new Map<string, ImageData>();
  const failures: string[] = [];
  const urls = [...bytesByUrl.keys()];
  let next = 0;
  const runWorker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      if (url === undefined) break;
      try {
        const bytes = bytesByUrl.get(url);
        if (!bytes) throw new Error("图层文件缺失");
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建画布上下文");
        context.drawImage(bitmap, 0, 0);
        result.set(url, context.getImageData(0, 0, bitmap.width, bitmap.height));
        bitmap.close();
      } catch (cause) {
        failures.push(`${url}（${cause instanceof Error ? cause.message : String(cause)}）`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, runWorker));
  if (failures.length > 0) throw new Error(`图层解码失败：${failures.join("、")}`);
  return result;
}
