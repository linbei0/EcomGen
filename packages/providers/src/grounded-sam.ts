import { ProviderConnection, ProviderError } from "./openai-compatible.js";
import type { FalSegmentationResult } from "./fal.js";

/**
 * 自部署 Grounded-SAM / SAM2 分割服务适配器（协议为本项目定义的简单 JSON 契约，
 * 供国内 GPU（阿里云 PAI-EAS、火山引擎、AutoDL 等）自托管 FastAPI 服务对接）：
 * - `POST {baseUrl}`，认证头 `Authorization: Bearer <apiKey>`。
 * - 请求体：{ image: { data: base64, mime_type? }, text_prompt?, box_prompts?: [{ x_min, y_min, x_max, y_max 像素 }] }。
 * - 响应体：{ masks: [{ data: base64 PNG, mime_type?, width?, height?, bbox?: { x, y, width, height } 归一化, score? }], request_id? }。
 * - 能力等价于 fal SAM 3：文本 prompt（自动元素）与框 prompt（手动框选）都必须支持。
 * - 探测只 GET /health 做连通性与认证校验，不执行模型（分割计费发生在自托管 GPU 上）。
 */
export const GROUNDED_SAM_HEALTH_PATH = "health";

const SEGMENTATION_REQUEST_TIMEOUT_MS = 180_000;

export interface GroundedSamSegmentationInput {
  /** base64 data URI 或公网 URL；data URI 直接拆 base64，URL 由 Worker 端抓取后转 base64。 */
  imageUrl: string;
  textPrompt?: string;
  box?: { xMin: number; yMin: number; xMax: number; yMax: number };
}

interface GroundedSamMask { data?: string; mime_type?: string; width?: number; height?: number; bbox?: unknown; score?: unknown; }
interface GroundedSamResponse { masks?: GroundedSamMask[]; request_id?: string; detail?: unknown; }

export class GroundedSamSegmentationProvider {
  public constructor(private readonly connection: ProviderConnection) { }

  public async segment(input: GroundedSamSegmentationInput): Promise<FalSegmentationResult> {
    const image = await resolveImageData(input.imageUrl);
    const payload: Record<string, unknown> = { image };
    if (input.textPrompt !== undefined && input.textPrompt.trim().length > 0) payload.text_prompt = input.textPrompt.trim();
    if (input.box) {
      payload.box_prompts = [{
        x_min: Math.round(input.box.xMin),
        y_min: Math.round(input.box.yMin),
        x_max: Math.round(input.box.xMax),
        y_max: Math.round(input.box.yMax)
      }];
    }
    // 自托管分割同样按次计费：只提交一次，失败如实上报，不自动重发。
    const response = await fetch(new URL(this.baseUrl()), { method: "POST", headers: this.headers(), body: JSON.stringify(payload), signal: AbortSignal.timeout(SEGMENTATION_REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new ProviderError(await response.text(), response.status);
    const body = await response.json() as GroundedSamResponse;
    const mask = body.masks?.[0];
    if (!mask?.data) throw new ProviderError("grounded-sam response does not contain a mask", 502);
    return {
      mask: { data: Buffer.from(mask.data, "base64"), mimeType: mask.mime_type ?? "image/png", width: mask.width ?? null, height: mask.height ?? null },
      bbox: isNormalizedBbox(mask.bbox) ? mask.bbox : null,
      score: typeof mask.score === "number" ? mask.score : null,
      providerTaskId: body.request_id ?? null
    };
  }

  /** 探测只访问 /health，不触发分割；401/403 说明服务令牌无效。 */
  public async probe(): Promise<{ latencyMs: number; models: null }> {
    const started = Date.now();
    const response = await fetch(new URL(`${this.baseUrl()}${GROUNDED_SAM_HEALTH_PATH}`), {
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000)
    });
    if (response.status === 401 || response.status === 403) throw new ProviderError("segmentation service API key rejected", response.status);
    if (!response.ok) throw new ProviderError(await response.text(), response.status);
    return { latencyMs: Date.now() - started, models: null };
  }

  private baseUrl(): string {
    return this.connection.baseUrl.endsWith("/") ? this.connection.baseUrl : `${this.connection.baseUrl}/`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.connection.apiKey}`, "content-type": "application/json", ...extra };
  }
}

/** data URI 拆 base64；http(s) URL 由 Worker 端抓取（自托管服务通常访问不到本机文件）。 */
async function resolveImageData(imageUrl: string): Promise<{ data: string; mime_type: string }> {
  if (imageUrl.startsWith("data:")) {
    const comma = imageUrl.indexOf(",");
    const mimeType = /data:([^;]+)/.exec(imageUrl.slice(0, comma))?.[1] ?? "image/png";
    return { data: imageUrl.slice(comma + 1), mime_type: mimeType };
  }
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(SEGMENTATION_REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new ProviderError("segmentation input image is unreadable", response.status);
  return { data: Buffer.from(await response.arrayBuffer()).toString("base64"), mime_type: response.headers.get("content-type")?.split(";")[0] ?? "image/png" };
}

function isNormalizedBbox(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (typeof value !== "object" || value === null) return false;
  const box = value as Record<string, unknown>;
  return [box.x, box.y, box.width, box.height].every((entry) => typeof entry === "number" && Number.isFinite(entry));
}
