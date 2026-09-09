import { ProviderConnection, ProviderError } from "./openai-compatible.js";

/**
 * 火山方舟 Seedream 图层拆分适配器（协议于 2026-09 对照火山方舟官方 OpenAPI 校对）：
 * - 请求：同步 POST {baseUrl}/images/generations，Bearer 认证；baseUrl 形如
 *   https://ark.cn-beijing.volces.com/api/v3，路径按相对拼接（OpenAI 风格 …/v1 base 同样兼容）。
 * - body：image 恰好 1 张（data URI 或公网 URL）；layer_decomposition 必须显式开启（默认 false）；
 *   watermark 关闭以避免污染像素保护结果；output_format 固定 png 保留图层 alpha；
 *   response_format 用 url（返回 CDN 链接，取到即下载）。
 * - prompt：不传=自动拆分全部主要元素；自然语言指定元素；`<bbox>x1 y1 x2 y2</bbox>` 为归一化 0-1000
 *   左上右下坐标，可多个（Worker 把手动框选换算成该标签）。
 * - 响应 data[] 与图片下标对齐：z_index 0 是底图（无 name/bbox，被拆走主体后已补绘），
 *   图层从 1 递增、为带 alpha 的透明 PNG；bounding_box.normalized 是 0-1000 包围盒。同步接口无任务 id。
 * - 图层像素是模型重绘的：调用方必须只把 alpha 通道作为选区回贴原图，RGB 一律取自原图（PIXEL_PROTECTED）。
 * - 同步请求即计费：不做自动重试，避免网络抖动导致同一任务重复计费；结果下载可安全重试。
 * - 探测只触发校验层拒绝，不创建任务、不产生费用。
 */
export const DEFAULT_SEEDREAM_LAYERIZE_MODEL = "doubao-seedream-5.0-pro-layerize";

// 同步接口一次最多返回约 17 张图层，出图可能超过常规请求超时；结果下载是独立 CDN 请求，超时更短。
const SUBMIT_TIMEOUT_MS = 300_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface SeedreamLayerizeInput {
  /** base64 data URI 或公网 URL；恰好 1 张。 */
  imageUrl: string;
  /** 缺省=自动全拆；自然语言或含 <bbox>x1 y1 x2 y2</bbox>（0-1000）标签。 */
  prompt?: string;
  /** 输出档位；auto 跟随输入分辨率，非 auto 时映射为方舟 size 参数。 */
  quality?: "auto" | "1K" | "1.5K" | "2K";
}

export interface SeedreamLayerizeLayer {
  zIndex: number;
  name: string | null;
  /** 归一化 0-1 包围盒（由 0-1000 normalized 换算）；底图或缺失时为 null。 */
  bbox: { x: number; y: number; width: number; height: number } | null;
  png: Buffer;
}

export interface SeedreamLayerizeResult {
  /** z_index 0 的底图（已补绘）；缺失时为 null。 */
  base: { data: Buffer; mimeType: string } | null;
  layers: SeedreamLayerizeLayer[];
  /** 同步接口没有任务 id，恒为 null；Worker 侧以 EXTERNAL_REQUEST_STARTED 兜底。 */
  providerTaskId: string | null;
}

interface SeedreamLayerItem { url?: string; z_index?: number; name?: unknown; bounding_box?: { absolute?: unknown; normalized?: unknown }; }
interface SeedreamGenerationResponse { data?: SeedreamLayerItem[]; error?: { message?: unknown }; }

export class SeedreamLayerizeProvider {
  public constructor(private readonly connection: ProviderConnection, private readonly options: { modelId?: string } = { }) { }

  public async layerize(input: SeedreamLayerizeInput): Promise<SeedreamLayerizeResult> {
    // 模型 id 来自任务快照（Worker 传入），保证“配置的模型”与“实际请求的模型”一致。
    const payload: Record<string, unknown> = {
      model: this.options.modelId ?? DEFAULT_SEEDREAM_LAYERIZE_MODEL,
      image: input.imageUrl,
      layer_decomposition: true,
      response_format: "url",
      output_format: "png",
      watermark: false
    };
    if (input.prompt !== undefined && input.prompt.trim().length > 0) payload.prompt = input.prompt.trim();
    if (input.quality && input.quality !== "auto") payload.size = input.quality;
    // 计费请求只发一次，失败如实上报，交由任务状态与人工重试决定，不自动重发。
    const response = await fetch(this.endpoint("images/generations"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS)
    });
    if (!response.ok) throw new ProviderError(await errorText(response), response.status);
    const body = await response.json() as SeedreamGenerationResponse;
    if (typeof body.error?.message === "string" && body.error.message.length > 0) {
      throw new ProviderError(body.error.message, 502);
    }
    return this.parseResult(body);
  }

  /**
   * 探测只发空提交体，缺 model/image 会被校验层拒绝（400/422，无任务、无费用）；401/403 说明密钥无效。
   * 其余非 2xx（404 路径不存在、405 方法不允许、429 限流、5xx）都如实报错，不伪装成“连通成功”。
   */
  public async probe(): Promise<{ latencyMs: number; models: null }> {
    const started = Date.now();
    const response = await fetch(this.endpoint("images/generations"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(30_000)
    });
    if (response.status === 401 || response.status === 403) throw new ProviderError("Seedream API key rejected", response.status);
    if (response.status !== 400 && response.status !== 422) throw new ProviderError(await errorText(response), response.status);
    return { latencyMs: Date.now() - started, models: null };
  }

  private async parseResult(body: SeedreamGenerationResponse): Promise<SeedreamLayerizeResult> {
    const items = Array.isArray(body.data) ? [...body.data] : [];
    if (items.length === 0) throw new ProviderError("Seedream layerize response returned no layers", 502);
    items.sort((left, right) => (left.z_index ?? 0) - (right.z_index ?? 0));
    let base: SeedreamLayerizeResult["base"] = null;
    const layers: SeedreamLayerizeLayer[] = [];
    for (const [index, item] of items.entries()) {
      if (!item.url) throw new ProviderError(`Seedream result item ${index} has no image URL`, 502);
      const zIndex = item.z_index ?? index;
      const image = await readResultImage(item.url);
      if (zIndex === 0) {
        base = { data: image.data, mimeType: image.mimeType };
        continue;
      }
      layers.push({ zIndex, name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : null, bbox: normalizedBbox(item.bounding_box?.normalized), png: image.data });
    }
    return { base, layers, providerTaskId: null };
  }

  private endpoint(path: string): URL {
    // OpenAI 风格相对拼接：base 为 …/api/v3 时落在 {base}/images/generations，…/v1 base 同样成立。
    const base = this.connection.baseUrl.endsWith("/") ? this.connection.baseUrl : `${this.connection.baseUrl}/`;
    return new URL(path, base);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.connection.apiKey}`, "content-type": "application/json", ...extra };
  }
}

/** 结果 URL 允许 data URI（本地/直连网关）或 http(s) CDN 地址；结果链接有效期短，取到即下载。 */
async function readResultImage(url: string): Promise<{ data: Buffer; mimeType: string }> {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    const mimeType = /data:([^;]+)/.exec(url.slice(0, comma))?.[1] ?? "image/png";
    return { data: Buffer.from(url.slice(comma + 1), "base64"), mimeType };
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new ProviderError("Seedream result image URL is unreadable", response.status);
  return { data: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get("content-type")?.split(";")[0] ?? "image/png" };
}

/** 方舟部分网关错误（如未知路径 404）返回空响应体；用状态码兜底，保证任务失败信息可读。 */
async function errorText(response: Response): Promise<string> {
  const text = (await response.text()).trim();
  return text.length > 0 ? text : `Provider HTTP ${response.status}`;
}

function normalizedBbox(value: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!Array.isArray(value) || value.length < 4 || !value.slice(0, 4).every((entry) => typeof entry === "number" && Number.isFinite(entry))) return null;
  const [x1, y1, x2, y2] = value as [number, number, number, number];
  return { x: x1 / 1000, y: y1 / 1000, width: (x2 - x1) / 1000, height: (y2 - y1) / 1000 };
}
