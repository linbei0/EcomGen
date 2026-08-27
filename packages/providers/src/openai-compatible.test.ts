import { afterEach, describe, expect, it, vi } from "vitest";

import { highInputFidelityForOpenAiImageModel, imageEditCapabilitiesFor, OpenAiCompatibleImageProvider } from "./openai-compatible.js";

describe("OpenAI-compatible image editing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps source image first and sends references, mask, operation and fidelity", async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: URL, init?: RequestInit) => {
      request = init;
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("generated").toString("base64") }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }));

    const provider = new OpenAiCompatibleImageProvider({ baseUrl: "https://example.test/v1", apiKey: "secret" });
    await provider.editImage({
      model: "image-model",
      prompt: "replace the background",
      operation: "NATURAL_FUSION",
      inputFidelity: "high",
      sourceImage: { data: Buffer.from("source"), filename: "source.png", mimeType: "image/png" },
      referenceImages: [
        { data: Buffer.from("reference-1"), filename: "reference-1.png", mimeType: "image/png" },
        { data: Buffer.from("reference-2"), filename: "reference-2.png", mimeType: "image/png" }
      ],
      mask: { data: Buffer.from("mask"), filename: "mask.png", mimeType: "image/png" }
    });

    expect(request?.method).toBe("POST");
    expect(new Headers(request?.headers).get("Idempotency-Key")).toBeNull();
    const body = request?.body as FormData;
    expect(body.get("operation")).toBe("NATURAL_FUSION");
    expect(body.get("input_fidelity")).toBe("high");
    expect((body.getAll("image") as File[]).map((file) => file.name)).toEqual(["source.png", "reference-1.png", "reference-2.png"]);
    expect((body.get("mask") as File).name).toBe("mask.png");
  });

  it("sends a stable idempotency key for generation retries", async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: URL, init?: RequestInit) => {
      request = init;
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("generated").toString("base64") }] }), { status: 200 });
    }));
    const provider = new OpenAiCompatibleImageProvider({ baseUrl: "https://example.test/v1", apiKey: "secret" });
    await provider.generate({ model: "image-model", prompt: "cup", idempotencyKey: "generation-key-1" });
    expect(new Headers(request?.headers).get("Idempotency-Key")).toBe("generation-key-1");
  });

  it("forwards high input fidelity when generating from product images", async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: URL, init?: RequestInit) => {
      request = init;
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("generated").toString("base64") }] }), { status: 200 });
    }));
    const provider = new OpenAiCompatibleImageProvider({ baseUrl: "https://example.test/v1", apiKey: "secret" });
    await provider.generate({
      model: "gpt-image-1",
      prompt: "Use the supplied product image.",
      inputFidelity: highInputFidelityForOpenAiImageModel("gpt-image-1"),
      images: [{ data: Buffer.from("product"), filename: "product.png", mimeType: "image/png" }],
    });
    expect((request?.body as FormData).get("input_fidelity")).toBe("high");
    expect(highInputFidelityForOpenAiImageModel("gpt-image-2")).toBeUndefined();
    expect(highInputFidelityForOpenAiImageModel("third-party-image")).toBeUndefined();
  });

  it("does not upload a mask for unmasked edits", async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: URL, init?: RequestInit) => {
      request = init;
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("generated").toString("base64") }] }), { status: 200 });
    }));
    const provider = new OpenAiCompatibleImageProvider({ baseUrl: "https://example.test/v1", apiKey: "secret" });
    await provider.editImage({ model: "image-model", prompt: "edit the target", operation: "NATURAL_FUSION", sourceImage: { data: Buffer.from("source"), filename: "source.png", mimeType: "image/png" } });
    expect((request?.body as FormData).get("mask")).toBeNull();
  });

  it("derives edit capabilities from the selected image API adapter", () => {
    const imageModel = { supportsVision: true, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: "openai_images" as const };
    const textModel = { ...imageModel, imageApiKind: null };
    expect(imageEditCapabilitiesFor(imageModel)).toMatchObject({
      supportsMaskEdit: true,
      supportsUnmaskedEdit: true,
      supportsMultiReference: true,
      supportsOutpaint: true,
      supportsInputFidelity: true,
      supportsNaturalBlend: true
    });
    expect(imageEditCapabilitiesFor(textModel)).toBeNull();
  });
});
