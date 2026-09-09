import { afterEach, describe, expect, it, vi } from "vitest";

import { GroundedSamSegmentationProvider } from "./grounded-sam.js";

describe("self-hosted Grounded-SAM segmentation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends base64 image with text prompt and Bearer authorization", async () => {
    let request: RequestInit | undefined;
    let url: URL | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: URL, init?: RequestInit) => {
      url = input;
      request = init;
      return new Response(JSON.stringify({
        masks: [{ data: "AAAA", mime_type: "image/png", width: 1024, height: 768, bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, score: 0.96 }],
        request_id: "req-gs-1"
      }), { status: 200 });
    }));

    const provider = new GroundedSamSegmentationProvider({ baseUrl: "http://127.0.0.1:9000/", apiKey: "token" });
    const result = await provider.segment({ imageUrl: "data:image/jpeg;base64,BBBB", textPrompt: "保温杯瓶身" });

    expect(String(url)).toBe("http://127.0.0.1:9000/");
    expect(new Headers(request?.headers).get("authorization")).toBe("Bearer token");
    const body = JSON.parse(String(request?.body));
    expect(body.image).toEqual({ data: "BBBB", mime_type: "image/jpeg" });
    expect(body.text_prompt).toBe("保温杯瓶身");
    expect(body.box_prompts).toBeUndefined();
    expect(result.mask.data.toString("base64")).toBe("AAAA");
    expect(result.mask.mimeType).toBe("image/png");
    expect(result.bbox).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
    expect(result.score).toBe(0.96);
    expect(result.providerTaskId).toBe("req-gs-1");
  });

  it("converts manual box prompts to integer pixel coordinates", async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: URL, init?: RequestInit) => {
      request = init;
      return new Response(JSON.stringify({ masks: [{ data: "CCCC" }] }), { status: 200 });
    }));

    const provider = new GroundedSamSegmentationProvider({ baseUrl: "http://127.0.0.1:9000", apiKey: "token" });
    await provider.segment({ imageUrl: "data:image/png;base64,DDDD", box: { xMin: 10.4, yMin: 20.6, xMax: 210.4, yMax: 420.6 } });

    const body = JSON.parse(String(request?.body));
    expect(body.box_prompts).toEqual([{ x_min: 10, y_min: 21, x_max: 210, y_max: 421 }]);
    expect(body.text_prompt).toBeUndefined();
  });

  it("downloads remote input images into base64 payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
      if (String(input).startsWith("https://files.example/")) {
        return new Response(Buffer.from("raw-image"), { status: 200, headers: { "content-type": "image/png" } });
      }
      return new Response(JSON.stringify({ masks: [{ data: "EEEE" }] }), { status: 200 });
    }));

    const provider = new GroundedSamSegmentationProvider({ baseUrl: "http://127.0.0.1:9000", apiKey: "token" });
    const result = await provider.segment({ imageUrl: "https://files.example/source.png" });
    expect(result.mask.data.toString("base64")).toBe("EEEE");
  });

  it("probe only hits /health and rejects invalid tokens or outages", async () => {
    const provider = new GroundedSamSegmentationProvider({ baseUrl: "http://127.0.0.1:9000", apiKey: "token" });
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await provider.probe();
    expect(result.models).toBeNull();
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:9000/health");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    await expect(provider.probe()).rejects.toThrow("segmentation service API key rejected");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 502 })));
    await expect(provider.probe()).rejects.toThrow("down");
  });

  it("提交遇到 5xx 时不自动重试，如实失败", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("provider busy", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GroundedSamSegmentationProvider({ baseUrl: "http://127.0.0.1:9000", apiKey: "token" });
    await expect(provider.segment({ imageUrl: "data:image/png;base64,GGGG" })).rejects.toThrow("provider busy");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
