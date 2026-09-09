import { ProviderConnection, ProviderError } from "./openai-compatible.js";

/**
 * fal.ai SAM 3 分割适配器（协议于 2026-09 对照官方 OpenAPI schema 校对）：
 * - 同步推理端点：POST {baseUrl}/{modelPath}，默认 fal-ai/sam-3/image；认证头 `Authorization: Key <FAL_KEY>`。
 * - image_url 接受公网 URL 或 base64 data URI，Worker 用 data URI 传入本地原图。
 * - box_prompts 坐标是输入图像的整数像素 x_min/y_min/x_max/y_max（非归一化），由调用方负责换算。
 * - apply_mask=false 只返回 mask 文件本身；mask PNG 以亮度表示前景（前景白、背景黑），
 *   include_boxes 返回归一化 [cx, cy, w, h]。
 * - 分割按次计费，提交 POST 不做自动重试（避免重复计费），探测绝不执行模型（见 probe 注释）。
 */
export const DEFAULT_FAL_SAM3_MODEL_PATH = "fal-ai/sam-3/image";

const SEGMENTATION_REQUEST_TIMEOUT_MS = 120_000;

export interface FalSegmentationInput {
  /** 公网 URL 或 base64 data URI。 */
  imageUrl: string;
  /** 文本提示（自动元素用元素名/描述）。 */
  textPrompt?: string;
  /** 像素坐标框提示（手动框选用）。 */
  box?: { xMin: number; yMin: number; xMax: number; yMax: number };
  /** fal 模型路径；默认 fal-ai/sam-3/image，可换 sam-3-1 等兼容端点。 */
  modelPath?: string;
}

export interface FalSegmentationResult {
  mask: { data: Buffer; mimeType: string; width: number | null; height: number | null };
  /** mask 的归一化包围盒；fal 未返回 boxes 时为 null。 */
  bbox: { x: number; y: number; width: number; height: number } | null;
  score: number | null;
  providerTaskId: string | null;
}

interface FalImageRef { url?: string; content_type?: string; width?: number; height?: number; }
interface FalSamResponse { image?: FalImageRef; masks?: FalImageRef[]; scores?: unknown; boxes?: unknown; request_id?: string; detail?: unknown; }

export class FalSegmentationProvider {
  public constructor(private readonly connection: ProviderConnection) { }

  public async segment(input: FalSegmentationInput): Promise<FalSegmentationResult> {
    const payload: Record<string, unknown> = {
      image_url: input.imageUrl,
      apply_mask: false,
      output_format: "png",
      include_boxes: true,
      include_scores: true,
      sync_mode: true,
      return_multiple_masks: false,
      max_masks: 1
    };
    if (input.textPrompt !== undefined && input.textPrompt.trim().length > 0) payload.prompt = input.textPrompt.trim();
    if (input.box) {
      payload.box_prompts = [{
        x_min: Math.round(input.box.xMin),
        y_min: Math.round(input.box.yMin),
        x_max: Math.round(input.box.xMax),
        y_max: Math.round(input.box.yMax)
      }];
    }
    const modelPath = (input.modelPath ?? DEFAULT_FAL_SAM3_MODEL_PATH).replace(/^\/+|\/+$/g, "");
    // 分割请求按次计费：只提交一次，网络失败/超时如实上报，不自动重发。
    const response = await fetch(new URL(`${this.baseUrl()}${modelPath}`), { method: "POST", headers: this.headers(), body: JSON.stringify(payload), signal: AbortSignal.timeout(SEGMENTATION_REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new ProviderError(await response.text(), response.status);
    const body = await response.json() as FalSamResponse;
    const ref = body.masks?.[0] ?? body.image;
    if (!ref?.url) throw new ProviderError("fal response does not contain a mask", 502);
    const mask = await this.readImage(ref);
    const box = Array.isArray(body.boxes) ? body.boxes[0] : undefined;
    const score = Array.isArray(body.scores) ? body.scores[0] : undefined;
    return {
      mask: { data: mask.data, mimeType: mask.mimeType, width: ref.width ?? null, height: ref.height ?? null },
      bbox: isBboxTriple(box) ? { x: clamp01(box[0] - box[2] / 2), y: clamp01(box[1] - box[3] / 2), width: clamp01(box[2]), height: clamp01(box[3]) } : null,
      score: typeof score === "number" ? score : null,
      providerTaskId: body.request_id ?? null
    };
  }

  /**
   * 探测只做连通性与认证校验，不执行模型：发送缺 image_url 的空请求，
   * fal 在校验层直接拒绝（400/422，无模型执行、无费用）；401/403 说明密钥无效。
   * 404/405/429/5xx 等非预期响应如实报错，不能当作连通成功。
   */
  public async probe(): Promise<{ latencyMs: number; models: null }> {
    const started = Date.now();
    const response = await fetch(new URL(`${this.baseUrl()}${DEFAULT_FAL_SAM3_MODEL_PATH}`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(30_000)
    });
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("fal API key rejected", response.status);
    }
    if (response.status !== 400 && response.status !== 422) throw new ProviderError(await response.text(), response.status);
    return { latencyMs: Date.now() - started, models: null };
  }

  private async readImage(ref: FalImageRef): Promise<{ data: Buffer; mimeType: string }> {
    const url = ref.url;
    if (!url) throw new ProviderError("fal returned a mask entry without a URL", 502);
    if (url.startsWith("data:")) {
      const comma = url.indexOf(",");
      const header = url.slice(0, comma);
      const mimeType = /data:([^;]+)/.exec(header)?.[1] ?? "image/png";
      return { data: Buffer.from(url.slice(comma + 1), "base64"), mimeType };
    }
    const imageResponse = await fetch(url, { signal: AbortSignal.timeout(SEGMENTATION_REQUEST_TIMEOUT_MS) });
    if (!imageResponse.ok) throw new ProviderError("fal returned an unreadable mask URL", imageResponse.status);
    const mimeType = imageResponse.headers.get("content-type")?.split(";")[0] ?? ref.content_type ?? "image/png";
    return { data: Buffer.from(await imageResponse.arrayBuffer()), mimeType };
  }

  private baseUrl(): string {
    return this.connection.baseUrl.endsWith("/") ? this.connection.baseUrl : `${this.connection.baseUrl}/`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Key ${this.connection.apiKey}`, "content-type": "application/json", ...extra };
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isBboxTriple(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length >= 4 && value.slice(0, 4).every((entry) => typeof entry === "number" && Number.isFinite(entry));
}
