import type { EditOperation, ImageQuality, ModelCapabilities } from "@ecomgen/contracts";
import { isGptImageModel } from "@ecomgen/contracts";

import { requestSignal } from "./abort.js";

export interface ProviderConnection {
  baseUrl: string;
  apiKey: string;
}

export interface ImageGenerationInput {
  model: string;
  prompt: string;
  /** 同一业务执行重试时保持不变，供兼容 Provider 去重。 */
  idempotencyKey?: string;
  size?: string;
  /** Gemini 使用的输出宽高比；OpenAI Images 适配器不读取此字段。 */
  imageAspectRatio?: string;
  /** Gemini 使用的输出分辨率（1K/2K/4K）；OpenAI Images 适配器不读取此字段。 */
  imageResolution?: string;
  /** 质量档位（gpt-image 语义）；调用方负责只在认识该参数的模型上提供。 */
  quality?: ImageQuality;
  images?: Array<{ data: Buffer; filename: string; mimeType: string }>;
  mask?: { data: Buffer; filename: string; mimeType: string };
  inputFidelity?: "low" | "high";
  /**
   * 透明底输出。只有确实支持该参数的模型才能收到它（判定见
   * contracts 的 supportsTransparentBackground），且必须与 outputFormat 的 png/webp 同用——
   * jpeg 装不下 alpha，Provider 会直接报错或悄悄给一张不带透明的图。
   */
  background?: "transparent" | "opaque" | "auto";
  outputFormat?: "png" | "webp" | "jpeg";
  /**
   * 火山方舟图片接口的域名专属参数，缺省不下发。Seedream 默认给图片加“AI生成”水印，
   * 电商成图必须显式关闭；其他模型收到未知字段有被拒风险，所以只有调用方明确提供才携带。
   */
  watermark?: boolean;
  operation?: EditOperation;
  /** 调用方取消信号；中断会真正断开在途请求，避免取消后继续等待并按次计费。 */
  signal?: AbortSignal;
}

export interface ImageInput {
  data: Buffer;
  filename: string;
  mimeType: string;
}

export interface ImageEditInput {
  model: string;
  prompt: string;
  /** 同一业务执行重试时保持不变，供兼容 Provider 去重。 */
  idempotencyKey?: string;
  quality?: ImageQuality;
  size?: string;
  imageAspectRatio?: string;
  imageResolution?: string;
  sourceImage: ImageInput;
  referenceImages?: ImageInput[];
  mask?: ImageInput;
  /**
   * 编辑操作提示；一个都不传表示这次不是注册表里的编辑操作（例如花型工坊的整图改风格），
   * 而不是"某个操作没写"。适配器只在提供时才把它作为表单字段发给上游：
   * 拿一个语义不符的操作名去顶替会误导支持该字段的 Provider，不如如实空着。
   */
  operation?: EditOperation;
  inputFidelity?: "low" | "high";
  /** 透明底输出；语义与 ImageGenerationInput.background 相同。 */
  background?: "transparent" | "opaque" | "auto";
  outputFormat?: "png" | "webp" | "jpeg";
  /** 调用方取消信号；中断会真正断开在途请求，避免取消后继续等待并按次计费。 */
  signal?: AbortSignal;
}

export interface ImageEditCapabilities {
  supportsMaskEdit: boolean;
  supportsUnmaskedEdit: boolean;
  supportsMultiReference: boolean;
  supportsOutpaint: boolean;
  supportsInputFidelity: boolean;
  supportsNaturalBlend: boolean;
}

const OPENAI_COMPATIBLE_EDIT_CAPABILITIES: ImageEditCapabilities = {
  supportsMaskEdit: true,
  supportsUnmaskedEdit: true,
  supportsMultiReference: true,
  supportsOutpaint: true,
  supportsInputFidelity: true,
  supportsNaturalBlend: true
};

const GEMINI_EDIT_CAPABILITIES: ImageEditCapabilities = {
  supportsMaskEdit: false,
  supportsUnmaskedEdit: true,
  supportsMultiReference: true,
  supportsOutpaint: false,
  supportsInputFidelity: false,
  supportsNaturalBlend: true
};

export interface ImageGenerationResult {
  image: Buffer;
  mimeType: string;
  providerTaskId?: string;
}

export interface ProviderProbeResult { latencyMs: number; models: string[] | null; }

/**
 * input_fidelity 支持矩阵（OpenAI API Reference）：gpt-image-1 / 1.5 支持 low|high，
 * gpt-image-1-mini 仅 low；gpt-image-2 必须省略该参数（默认即高保真）。
 */
export function highInputFidelityForOpenAiImageModel(modelId: string): "high" | "low" | undefined {
  const id = modelId.trim();
  if (/^gpt-image-1-mini$/i.test(id)) return "low";
  if (/^(gpt-image-1|gpt-image-1\.5)$/i.test(id)) return "high";
  return undefined;
}

// gpt-image high 档带参考图的 edits 请求经常超过 2 分钟；超时过短会把本可完成的
// 生成直接杀掉。允许通过环境变量按部署调整，默认 5 分钟。
const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 300_000;
/** 下载 Provider 返回的图片 URL；该请求与生图请求同源受控，同样需要超时与取消。 */
const IMAGE_DOWNLOAD_TIMEOUT_MS = 120_000;
const IMAGE_REQUEST_RETRIES = 1;
const RETRYABLE_IMAGE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function imageRequestTimeoutMs(): number {
  const raw = Number(process.env.ECOMGEN_IMAGE_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_IMAGE_REQUEST_TIMEOUT_MS;
  return Math.min(600_000, Math.max(60_000, raw));
}

/**
 * 生图请求瞬时错误（网络失败、超时、408/429/5xx）判定。
 * 不含 AbortError：取消只可能来自调用方信号，重发一次就是再付一次费。
 */
function isTransientImageRequestError(error: unknown): boolean {
  if (error instanceof ProviderError) return RETRYABLE_IMAGE_STATUS.has(error.status);
  const name = error instanceof Error ? error.name : "";
  // TimeoutError 来自 AbortSignal.timeout；TypeError 通常是底层网络失败。
  return name === "TimeoutError" || name === "TypeError";
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * 按字节签名识别 PNG/JPEG/WEBP。b64 响应不带格式声明，兼容 Provider（如 Seedream）实际
 * 返回 JPEG；URL 分支的 content-type 也可能缺失或失真，字节签名优先。
 */
export function sniffImageMimeType(buffer: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "image/png";
  if (buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return "image/jpeg";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export class OpenAiCompatibleImageProvider {
  public constructor(private readonly connection: ProviderConnection) { }

  public async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    if (input.images?.length) return this.edit(input);
    const response = await this.postWithRetry(new URL("images/generations", this.baseUrl()), this.headers({
      "content-type": "application/json",
      ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {})
    }), JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      // GPT image 模型永远返回 b64_json，官方标注 response_format 为 Unsupported（仅退役的 DALL·E 系需要）；
      // 其余兼容实现（Seedream 等）需要它来拿 base64 而不是 24 小时过期的 URL。
      ...(isGptImageModel(input.model) ? {} : { response_format: "b64_json" as const }),
      // 只在调用方明确要求时下发：默认请求保持原样，不带 background/output_format/watermark。
      ...(input.background ? { background: input.background } : {}),
      ...(input.outputFormat ? { output_format: input.outputFormat } : {}),
      ...(input.watermark !== undefined ? { watermark: input.watermark } : {}),
      n: 1
    }), input.signal);
    return this.readImageResponse(response, input.signal);
  }

  public async editImage(input: ImageEditInput): Promise<ImageGenerationResult> {
    return this.edit({
      model: input.model,
      prompt: input.prompt,
      quality: input.quality,
      size: input.size,
      images: [input.sourceImage, ...(input.referenceImages ?? [])],
      mask: input.mask,
      inputFidelity: input.inputFidelity,
      background: input.background,
      outputFormat: input.outputFormat,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      signal: input.signal
    });
  }

  public async probe(): Promise<ProviderProbeResult> {
    // 只读取 /models，不调用生图接口，避免“测试连接”产生模型费用或副作用。
    const started = Date.now();
    const response = await fetch(new URL("models", this.baseUrl()), { headers: this.headers() });
    if (!response.ok) throw new ProviderError(`Provider models endpoint returned HTTP ${response.status}`, response.status);
    const body = await response.json() as { data?: Array<{ id?: string }> };
    return { latencyMs: Date.now() - started, models: Array.isArray(body.data) ? body.data.flatMap((entry) => typeof entry.id === "string" ? [entry.id] : []) : null };
  }

  private async edit(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const form = new FormData();
    form.set("model", input.model);
    form.set("prompt", input.prompt);
    if (!isGptImageModel(input.model)) form.set("response_format", "b64_json");
    if (input.operation) form.set("operation", input.operation);
    if (input.size) form.set("size", input.size);
    if (input.quality) form.set("quality", input.quality);
    if (input.inputFidelity) form.set("input_fidelity", input.inputFidelity);
    if (input.background) form.set("background", input.background);
    if (input.outputFormat) form.set("output_format", input.outputFormat);
    for (const image of input.images ?? []) {
      form.append("image", new Blob([new Uint8Array(image.data)], { type: image.mimeType }), image.filename);
    }
    if (input.mask) form.append("mask", new Blob([new Uint8Array(input.mask.data)], { type: input.mask.mimeType }), input.mask.filename);
    const response = await this.postWithRetry(new URL("images/edits", this.baseUrl()), this.headers(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}), form, input.signal);
    return this.readImageResponse(response, input.signal);
  }

  /** 带一次瞬时错误重试的生图请求；幂等键由调用方提供，重试不会产生重复产物。 */
  private async postWithRetry(url: URL, headers: Record<string, string>, body: BodyInit, cancel?: AbortSignal): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= IMAGE_REQUEST_RETRIES; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: requestSignal(cancel, imageRequestTimeoutMs())
        });
        if (response.ok || !RETRYABLE_IMAGE_STATUS.has(response.status) || attempt === IMAGE_REQUEST_RETRIES) return response;
        lastError = new ProviderError(await response.text(), response.status);
      } catch (error) {
        lastError = error;
        // 取消不是瞬时故障：重试会再发一次已计费的生成请求。
        if (cancel?.aborted) throw error;
        if (!isTransientImageRequestError(error) || attempt === IMAGE_REQUEST_RETRIES) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new ProviderError(String(lastError), 502);
  }

  private async readImageResponse(response: Response, cancel?: AbortSignal): Promise<ImageGenerationResult> {
    if (!response.ok) throw new ProviderError(await response.text(), response.status);
    const body = await response.json() as { data?: Array<{ b64_json?: string; url?: string }>; task_id?: string; id?: string };
    const result = body.data?.[0];
    if (result?.b64_json) {
      const image = Buffer.from(result.b64_json, "base64");
      // b64 响应不声明格式：按字节签名识别。Seedream 等兼容 Provider 返回的是 JPEG，
      // 一律按 PNG 标注会让落盘扩展名与回传 Content-Type 全部失真。
      return { image, mimeType: sniffImageMimeType(image) ?? "image/png", providerTaskId: body.task_id ?? body.id };
    }
    if (result?.url) {
      const imageResponse = await fetch(result.url, { signal: requestSignal(cancel, IMAGE_DOWNLOAD_TIMEOUT_MS) });
      if (!imageResponse.ok) throw new ProviderError("Provider returned an unreadable image URL", imageResponse.status);
      const image = Buffer.from(await imageResponse.arrayBuffer());
      const mimeType = sniffImageMimeType(image)
        ?? imageResponse.headers.get("content-type")?.split(";")[0]
        ?? "image/png";
      return { image, mimeType, providerTaskId: body.task_id ?? body.id };
    }
    throw new ProviderError("Provider response does not contain an image", 502);
  }

  private baseUrl(): string {
    return this.connection.baseUrl.endsWith("/") ? this.connection.baseUrl : `${this.connection.baseUrl}/`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.connection.apiKey}`, ...extra };
  }
}

export class ProviderError extends Error {
  public constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ProviderError";
  }
}

export function supportsImageGeneration(capabilities: ModelCapabilities): boolean {
  return capabilities.imageApiKind !== null;
}

/** 能力由已选 API 适配器决定，避免让卖家为 Provider 协议做技术判断。 */
export function imageEditCapabilitiesFor(capabilities: ModelCapabilities): ImageEditCapabilities | null {
  if (capabilities.imageApiKind === "openai_images") return OPENAI_COMPATIBLE_EDIT_CAPABILITIES;
  if (capabilities.imageApiKind === "gemini") return GEMINI_EDIT_CAPABILITIES;
  return null;
}
