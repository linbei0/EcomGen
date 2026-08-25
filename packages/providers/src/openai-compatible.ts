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

export class OpenAiCompatibleImageProvider {
  public constructor(private readonly connection: ProviderConnection) {}

  public async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    if (input.images?.length) return this.edit(input);
    const response = await fetch(new URL("images/generations", this.baseUrl()), {
      method: "POST",
      headers: this.headers({
        "content-type": "application/json",
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {})
      }),
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        size: input.size,
        quality: input.quality,
        response_format: "b64_json",
        n: 1
      }),
      signal: AbortSignal.timeout(120_000)
    });
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
    const response = await fetch(new URL("images/edits", this.baseUrl()), {
      method: "POST",
      headers: this.headers(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      body: form,
      signal: AbortSignal.timeout(120_000)
    });
    return this.readImageResponse(response);
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
