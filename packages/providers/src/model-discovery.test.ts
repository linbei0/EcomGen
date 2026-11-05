import { afterEach, describe, expect, it, vi } from "vitest";

import { discoverProviderModels } from "./model-discovery.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("discoverProviderModels", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the OpenAI-compatible listing first, with normalized and deduplicated ids", async () => {
    const fetchMock = vi.fn(async (_url: URL, _init?: RequestInit) =>
      jsonResponse({ data: [{ id: "gpt-image-1" }, { id: "gpt-4o" }, { id: "gpt-4o" }, { id: " b " }, { id: "" }, "not-an-object"] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await discoverProviderModels({ baseUrl: "https://gateway.test/v1", apiKey: "secret" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.models).toEqual(["b", "gpt-4o", "gpt-image-1"]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://gateway.test/v1/models");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
  });

  it("falls back to the Gemini listing when the OpenAI dialect is rejected", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ models: [{ name: "models/gemini-2.5-flash-image" }, { name: "text-embedding-004" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await discoverProviderModels({ baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "goog-key" });

    expect(result.models).toEqual(["gemini-2.5-flash-image", "text-embedding-004"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [fallbackUrl, fallbackInit] = fetchMock.mock.calls[1]!;
    expect(String(fallbackUrl)).toBe("https://generativelanguage.googleapis.com/v1beta/models");
    expect(new Headers(fallbackInit?.headers).get("x-goog-api-key")).toBe("goog-key");
    expect(new Headers(fallbackInit?.headers).get("authorization")).toBeNull();
  });

  it("falls back to the Gemini listing when the response has no OpenAI data array", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ models: [{ name: "models/gemini-2.0-flash" }] }))
      .mockResolvedValueOnce(jsonResponse({ models: [{ name: "models/gemini-2.0-flash" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await discoverProviderModels({ baseUrl: "https://gateway.test/v1", apiKey: "secret" });

    // 第一次尝试把 {models:[...]} 当 OpenAI 方言解析出 null（无 data 数组），必须回退而不是误判成功
    expect(result.models).toEqual(["gemini-2.0-flash"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports both attempts when neither dialect works", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 })));

    await expect(discoverProviderModels({ baseUrl: "https://gateway.test/v1", apiKey: "secret" }))
      .rejects.toThrow("OpenAI-compatible: HTTP 401; Gemini: HTTP 404");
  });

  it("describes a timed-out attempt instead of leaking a raw TimeoutError", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))
      .mockRejectedValueOnce(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })));

    await expect(discoverProviderModels({ baseUrl: "https://gateway.test/v1", apiKey: "secret" }))
      .rejects.toThrow("OpenAI-compatible: request timed out; Gemini: request timed out");
  });
});
