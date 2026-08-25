import type { ImageEditInput, ImageGenerationInput, ImageGenerationResult, ImageInput, ProviderConnection, ProviderProbeResult } from "./openai-compatible.js";
import { ProviderError } from "./openai-compatible.js";

/** Google Gemini native image generation（Nano Banana）适配器。 */
export class GeminiImageProvider {
  public constructor(private readonly connection: ProviderConnection) {}

  public async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    return this.request(input.model, input.prompt, input.images, input.idempotencyKey);
  }

  public async editImage(input: ImageEditInput): Promise<ImageGenerationResult> {
    return this.request(input.model, input.prompt, [input.sourceImage, ...(input.referenceImages ?? [])], input.idempotencyKey);
  }

  public async probe(): Promise<ProviderProbeResult> {
    const started = Date.now();
    const response = await fetch(new URL("models", this.baseUrl()), { headers: this.headers() });
    if (!response.ok) throw new ProviderError(`Gemini models endpoint returned HTTP ${response.status}`, response.status);
    const body = await response.json() as { models?: Array<{ name?: string }> };
    const models = Array.isArray(body.models)
      ? body.models.flatMap((entry) => typeof entry.name === "string" ? [entry.name.replace(/^models\//, "")] : [])
      : null;
    return { latencyMs: Date.now() - started, models };
  }

  private async request(model: string, prompt: string, images?: ImageInput[], idempotencyKey?: string): Promise<ImageGenerationResult> {
    const parts = [
      { text: prompt },
      ...(images ?? []).map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data.toString("base64") } }))
    ];
    const response = await fetch(new URL(`models/${encodeURIComponent(model)}:generateContent`, this.baseUrl()), {
      method: "POST",
      headers: this.headers({
        "content-type": "application/json",
        ...(idempotencyKey ? { "x-goog-request-id": idempotencyKey } : {})
      }),
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE"] }
      }),
      signal: AbortSignal.timeout(120_000)
    });
    if (!response.ok) throw new ProviderError(await response.text(), response.status);
    const body = await response.json() as { response?: unknown; candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }> } }> };
    const part = body.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((candidate) => candidate.inlineData?.data || candidate.inline_data?.data);
    const data = part?.inlineData ?? (part?.inline_data ? { mimeType: part.inline_data.mime_type, data: part.inline_data.data } : undefined);
    if (!data?.data) throw new ProviderError("Gemini response does not contain an image", 502);
    return { image: Buffer.from(data.data, "base64"), mimeType: data.mimeType ?? "image/png" };
  }

  private baseUrl(): string {
    return this.connection.baseUrl.endsWith("/") ? this.connection.baseUrl : `${this.connection.baseUrl}/`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "x-goog-api-key": this.connection.apiKey, ...extra };
  }
}

