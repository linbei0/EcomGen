import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FAL_SAM3_MODEL_PATH, FalSegmentationProvider } from "./fal.js";

const dataUriMask = "data:image/png;base64,AAAA";

describe("fal.ai SAM 3 segmentation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends text prompt with raw-mask flags and Key authorization", async () => {
    let request: RequestInit | undefined;
    let url: URL | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: URL, init?: RequestInit) => {
      url = input;
      request = init;
      return new Response(JSON.stringify({
        masks: [{ url: dataUriMask, content_type: "image/png", width: 1024, height: 768 }],
        boxes: [[0.5, 0.5, 0.4, 0.2]],
        scores: [0.97],
        request_id: "req-1"
      }), { status: 200 });
    }));

    const provider = new FalSegmentationProvider({ baseUrl: "https://fal.run", apiKey: "fal-key" });
    const result = await provider.segment({ imageUrl: "data:image/jpeg;base64,BBBB", textPrompt: "cosmetic bottle" });

    expect(String(url)).toBe(`https://fal.run/${DEFAULT_FAL_SAM3_MODEL_PATH}`);
    expect(new Headers(request?.headers).get("authorization")).toBe("Key fal-key");
    const body = JSON.parse(String(request?.body));
    expect(body.image_url).toBe("data:image/jpeg;base64,BBBB");
    expect(body.prompt).toBe("cosmetic bottle");
    expect(body.apply_mask).toBe(false);
    expect(body.include_boxes).toBe(true);
    expect(body.return_multiple_masks).toBe(false);
    expect(result.mask.data.toString("base64")).toBe("AAAA");
    expect(result.bbox).toEqual({ x: 0.3, y: 0.4, width: 0.4, height: 0.2 });
    expect(result.score).toBe(0.97);
    expect(result.providerTaskId).toBe("req-1");
  });

  it("converts manual box prompts to integer pixel coordinates", async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: URL, init?: RequestInit) => {
      request = init;
      return new Response(JSON.stringify({ masks: [{ url: dataUriMask }] }), { status: 200 });
    }));

    const provider = new FalSegmentationProvider({ baseUrl: "https://fal.run", apiKey: "fal-key" });
    await provider.segment({ imageUrl: "data:image/png;base64,CCCC", box: { xMin: 10.4, yMin: 20.6, xMax: 210.4, yMax: 420.6 } });

    const body = JSON.parse(String(request?.body));
    expect(body.box_prompts).toEqual([{ x_min: 10, y_min: 21, x_max: 210, y_max: 421 }]);
    expect(body.prompt).toBeUndefined();
  });

  it("fetches masks returned as CDN URLs", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
      if (String(input).startsWith("https://v3.fal.media/")) {
        return new Response(Buffer.from("mask-bytes"), { status: 200, headers: { "content-type": "image/png" } });
      }
      return new Response(JSON.stringify({ masks: [{ url: "https://v3.fal.media/files/mask.png", content_type: "image/png" }] }), { status: 200 });
    }));

    const provider = new FalSegmentationProvider({ baseUrl: "https://fal.run", apiKey: "fal-key" });
    const result = await provider.segment({ imageUrl: "data:image/png;base64,DDDD" });
    expect(result.mask.data.toString()).toBe("mask-bytes");
    expect(result.mask.mimeType).toBe("image/png");
    expect(result.bbox).toBeNull();
  });

  it("probe passes on validation rejection without executing the model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: [] }), { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new FalSegmentationProvider({ baseUrl: "https://fal.run", apiKey: "fal-key" });
    const result = await provider.probe();
    expect(result.models).toBeNull();
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({});
  });

  it("probe rejects invalid keys and provider outages", async () => {
    const provider = new FalSegmentationProvider({ baseUrl: "https://fal.run", apiKey: "bad-key" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    await expect(provider.probe()).rejects.toThrow("fal API key rejected");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 502 })));
    await expect(provider.probe()).rejects.toThrow("boom");
  });

  it("提交遇到 5xx 时不自动重试，如实失败", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("provider busy", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new FalSegmentationProvider({ baseUrl: "https://fal.run", apiKey: "fal-key" });
    await expect(provider.segment({ imageUrl: "data:image/png;base64,EEEE" })).rejects.toThrow("provider busy");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
