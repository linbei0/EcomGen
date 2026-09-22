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

  it("对瞬时 5xx 重试一次后成功", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("provider busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("generated").toString("base64") }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleImageProvider({ baseUrl: "https://example.test/v1", apiKey: "secret" });
    const result = await provider.generate({ model: "image-model", prompt: "cup", idempotencyKey: "key-1" });
    expect(result.mimeType).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("网络失败重试一次，非瞬时 4xx 不重试", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleImageProvider({ baseUrl: "https://example.test/v1", apiKey: "secret" });
    await expect(provider.generate({ model: "image-model", prompt: "cup" })).rejects.toThrow("bad request");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("瞬时错误连续出现时按上限重试后抛出", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleImageProvider({ baseUrl: "https://example.test/v1", apiKey: "secret" });
    await expect(provider.generate({ model: "image-model", prompt: "cup" })).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/** 构造按 name 判定瞬时性的错误，复现 AbortSignal 的两种中断来源。 */
function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

/** 只接受连接、永不返回的 fetch 替身，用于验证在途请求能否被取消中断。 */
function hangingFetch(): { fetchMock: ReturnType<typeof vi.fn>; captured: () => AbortSignal | undefined } {
  let signal: AbortSignal | undefined;
  const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return await new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
    });
  });
  return { fetchMock, captured: () => signal };
}

describe("生图请求的取消传播", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("取消中断在途生成请求，且不再重发付费请求", async () => {
    const { fetchMock, captured } = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const provider = new OpenAiCompatibleImageProvider({ baseUrl: "https://example.test/v1", apiKey: "secret" });
    const pending = provider.generate({ model: "image-model", prompt: "cup", idempotencyKey: "key-1", signal: controller.signal });
    const reason = new Error("cancelled-by-user");
    controller.abort(reason);
    await expect(pending).rejects.toThrow("cancelled-by-user");
    // 请求信号确实被传给了 fetch，且随调用方取消而中断。
    expect(captured()?.aborted).toBe(true);
    // 重发一次就是再付一次费：取消后必须停在一次请求上。
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("AbortError 不再被当作瞬时错误重试", async () => {
    const fetchMock = vi.fn().mockRejectedValue(namedError("AbortError", "The operation was aborted."));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleImageProvider({ baseUrl: "https://example.test/v1", apiKey: "secret" });
    await expect(provider.generate({ model: "image-model", prompt: "cup" })).rejects.toThrow("The operation was aborted.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("取消原因无论叫什么名字都不会被重试", async () => {
    // AbortError 已从瞬时错误白名单移除；TimeoutError 仍是瞬时错误，只能靠"调用方已取消"
    // 这一判断拦住——取消与超时同时逼近时若不拦住，取消就会再发一次已计费的请求。
    for (const name of ["AbortError", "TimeoutError"]) {
      const controller = new AbortController();
      const { fetchMock } = hangingFetch();
      vi.stubGlobal("fetch", fetchMock);
      const provider = new OpenAiCompatibleImageProvider({ baseUrl: "https://example.test/v1", apiKey: "secret" });
      const pending = provider.generate({ model: "image-model", prompt: "cup", signal: controller.signal });
      controller.abort(namedError(name, "cancelled"));
      await expect(pending).rejects.toThrow("cancelled");
      expect(fetchMock, `${name} 取消后仍重发了上游请求`).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    }
  });

  it("超时仍按瞬时错误重试一次", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(namedError("TimeoutError", "The operation was aborted due to timeout"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("generated").toString("base64") }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleImageProvider({ baseUrl: "https://example.test/v1", apiKey: "secret" });
    await expect(provider.generate({ model: "image-model", prompt: "cup" })).resolves.toMatchObject({ mimeType: "image/png" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("下载 Provider 返回的图片 URL 时同样传入中断信号", async () => {
    let downloadSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (url: URL | string, init?: RequestInit) => {
      if (String(url).includes("cdn.example.test")) {
        downloadSignal = init?.signal ?? undefined;
        return new Response(Buffer.from("downloaded"), { status: 200, headers: { "content-type": "image/webp" } });
      }
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.test/image.webp" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleImageProvider({ baseUrl: "https://example.test/v1", apiKey: "secret" });
    const result = await provider.generate({ model: "image-model", prompt: "cup", signal: new AbortController().signal });
    expect(result.mimeType).toBe("image/webp");
    // 修复前该下载既无超时也无取消，可能永久挂起。
    expect(downloadSignal).toBeDefined();
    expect(downloadSignal?.aborted).toBe(false);
  });
});
