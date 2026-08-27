import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiImageProvider } from "./gemini.js";

describe("Gemini Nano Banana image provider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends generateContent multimodal request and decodes inline image", async () => {
    let url = "";
    let request: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (target: URL, init?: RequestInit) => {
      url = String(target);
      request = init;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: Buffer.from("generated").toString("base64") } }] } }] }), { status: 200 });
    }));
    const provider = new GeminiImageProvider({ baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "secret" });
    const result = await provider.editImage({
      model: "gemini-2.5-flash-image",
      prompt: "edit this product photo",
      sourceImage: { data: Buffer.from("source"), filename: "source.png", mimeType: "image/png" },
      referenceImages: [{ data: Buffer.from("reference"), filename: "reference.jpg", mimeType: "image/jpeg" }],
      imageAspectRatio: "16:9",
      imageResolution: "4K",
      operation: "NATURAL_FUSION"
    });
    expect(url).toContain("models/gemini-2.5-flash-image:generateContent");
    expect(new Headers(request?.headers).get("x-goog-api-key")).toBe("secret");
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" } },
      contents: [{ parts: [{ text: "edit this product photo" }, { inlineData: { mimeType: "image/png" } }, { inlineData: { mimeType: "image/jpeg" } }] }]
    });
    expect(body.generationConfig.imageConfig).not.toHaveProperty("imageSize");
    expect(result).toMatchObject({ mimeType: "image/jpeg", image: Buffer.from("generated") });
  });

  it("uses Gemini 3 imageConfig resolution instead of ignoring the requested output quality", async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_target: URL, init?: RequestInit) => {
      request = init;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from("generated").toString("base64") } }] } }] }), { status: 200 });
    }));
    const provider = new GeminiImageProvider({ baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "secret" });
    await provider.generate({ model: "gemini-3.1-flash-image", prompt: "product image", imageAspectRatio: "3:4", imageResolution: "2K" });

    expect(JSON.parse(String(request?.body))).toMatchObject({
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:4", imageSize: "2K" } }
    });
  });
});
