import type { EditOperation, ModelCapabilities } from "@ecomgen/contracts";

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
  quality?: "low" | "medium" | "high";
  images?: Array<{ data: Buffer; filename: string; mimeType: string }>;
  mask?: { data: Buffer; filename: string; mimeType: string };
  inputFidelity?: "low" | "high";
  operation?: EditOperation;
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
  quality?: "low" | "medium" | "high";
  size?: string;
  imageAspectRatio?: string;
  imageResolution?: string;
  sourceImage: ImageInput;
  referenceImages?: ImageInput[];
  mask?: ImageInput;
  operation: EditOperation;
  inputFidelity?: "low" | "high";
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

/** GPT Image 1 系列支持 input_fidelity；gpt-image-2 已默认使用高保真输入。 */
export function highInputFidelityForOpenAiImageModel(modelId: string): "high" | undefined {
  return /^(gpt-image-1|gpt-image-1-mini|gpt-image-1\.5)$/i.test(modelId.trim()) ? "high" : undefined;
}

// gpt-image high 档带参考图的 edits 请求经常超过 2 分钟；超时过短会把本可完成的
// 生成直接杀掉。允许通过环境变量按部署调整，默认 5 分钟。
const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 300_000;
const IMAGE_REQUEST_RETRIES = 1;
const RETRYABLE_IMAGE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function imageRequestTimeoutMs(): number {
  const raw = Number(process.env.ECOMGEN_IMAGE_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_IMAGE_REQUEST_TIMEOUT_MS;
  return Math.min(600_000, Math.max(60_000, raw));
}

/** 生图请求瞬时错误（网络失败、超时、408/429/5xx）判定。 */
function isTransientImageRequestError(error: unknown): boolean {
  if (error instanceof ProviderError) return RETRYABLE_IMAGE_STATUS.has(error.status);
  const name = error instanceof Error ? error.name : "";
  // TimeoutError/AbortError 来自请求超时；TypeError 通常是底层网络失败。
  return name === "TimeoutError" || name === "AbortError" || name === "TypeError";
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
      response_format: "b64_json",
      n: 1
    }));
    return this.readImageResponse(response);
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
      operation: input.operation,
      idempotencyKey: input.idempotencyKey
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
    form.set("response_format", "b64_json");
    if (input.operation) form.set("operation", input.operation);
    if (input.size) form.set("size", input.size);
    if (input.quality) form.set("quality", input.quality);
    if (input.inputFidelity) form.set("input_fidelity", input.inputFidelity);
    for (const image of input.images ?? []) {
      form.append("image", new Blob([new Uint8Array(image.data)], { type: image.mimeType }), image.filename);
    }
    if (input.mask) form.append("mask", new Blob([new Uint8Array(input.mask.data)], { type: input.mask.mimeType }), input.mask.filename);
    const response = await this.postWithRetry(new URL("images/edits", this.baseUrl()), this.headers(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}), form);
    return this.readImageResponse(response);
  }

  /** 带一次瞬时错误重试的生图请求；幂等键由调用方提供，重试不会产生重复产物。 */
  private async postWithRetry(url: URL, headers: Record<string, string>, body: BodyInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= IMAGE_REQUEST_RETRIES; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(imageRequestTimeoutMs())
        });
        if (response.ok || !RETRYABLE_IMAGE_STATUS.has(response.status) || attempt === IMAGE_REQUEST_RETRIES) return response;
        lastError = new ProviderError(await response.text(), response.status);
      } catch (error) {
        lastError = error;
        if (!isTransientImageRequestError(error) || attempt === IMAGE_REQUEST_RETRIES) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new ProviderError(String(lastError), 502);
  }

  private async readImageResponse(response: Response): Promise<ImageGenerationResult> {
    if (!response.ok) throw new ProviderError(await response.text(), response.status);
    const body = await response.json() as { data?: Array<{ b64_json?: string; url?: string }>; task_id?: string; id?: string };
    const result = body.data?.[0];
    if (result?.b64_json) return { image: Buffer.from(result.b64_json, "base64"), mimeType: "image/png", providerTaskId: body.task_id ?? body.id };
    if (result?.url) {
      const imageResponse = await fetch(result.url);
      if (!imageResponse.ok) throw new ProviderError("Provider returned an unreadable image URL", imageResponse.status);
      const mimeType = imageResponse.headers.get("content-type")?.split(";")[0] ?? "image/png";
      return { image: Buffer.from(await imageResponse.arrayBuffer()), mimeType, providerTaskId: body.task_id ?? body.id };
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
