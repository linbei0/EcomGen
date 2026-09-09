import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SEEDREAM_LAYERIZE_MODEL, SeedreamLayerizeProvider } from "./seedream-layerize.js";

const dataUri = (base64: string) => `data:image/png;base64,${base64}`;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

describe("Seedream layerize (火山方舟同步 images/generations)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("同步提交并解析 z_index 图层结果", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return jsonResponse({ model: DEFAULT_SEEDREAM_LAYERIZE_MODEL, data: [
        { url: dataUri("AAAA"), z_index: 0 },
        { url: dataUri("BBBB"), z_index: 1, name: "保温杯瓶身", bounding_box: { absolute: [10, 20, 410, 420], normalized: [100, 200, 500, 600] } },
        { url: dataUri("CCCC"), z_index: 2 }
      ] });
    }));

    const provider = new SeedreamLayerizeProvider({ baseUrl: "https://ark.cn-beijing.volces.com/api/v3", apiKey: "ark-key" });
    const result = await provider.layerize({ imageUrl: dataUri("DDDD"), prompt: "把保温杯瓶身拆出来", quality: "auto" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer ark-key");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: DEFAULT_SEEDREAM_LAYERIZE_MODEL,
      image: dataUri("DDDD"),
      prompt: "把保温杯瓶身拆出来",
      layer_decomposition: true,
      response_format: "url",
      output_format: "png",
      watermark: false
    });
    expect(result.base?.data.toString("base64")).toBe("AAAA");
    expect(result.providerTaskId).toBeNull();
    expect(result.layers).toHaveLength(2);
    expect(result.layers[0]).toMatchObject({ zIndex: 1, name: "保温杯瓶身", bbox: { x: 0.1, y: 0.2, width: 0.4, height: 0.4 } });
    expect(result.layers[1]).toMatchObject({ zIndex: 2, name: null, bbox: null });
    expect(result.layers[0].png.toString("base64")).toBe("BBBB");
  });

  it("OpenAI 风格 /v1 base 同样相对拼接；quality 非 auto 映射为 size", async () => {
    let submitted: Record<string, unknown> | undefined;
    let url = "";
    vi.stubGlobal("fetch", vi.fn(async (input: URL, init?: RequestInit) => {
      url = String(input);
      submitted = JSON.parse(String(init?.body));
      return jsonResponse({ data: [{ url: dataUri("EEEE"), z_index: 1, name: "layer" }] });
    }));

    const provider = new SeedreamLayerizeProvider({ baseUrl: "https://ark.example/v1", apiKey: "ark-key" });
    const result = await provider.layerize({ imageUrl: dataUri("DDDD"), quality: "2K" });
    expect(url).toBe("https://ark.example/v1/images/generations");
    expect(submitted?.size).toBe("2K");
    expect(result.base).toBeNull();
  });

  it("非 2xx 如实上报；空响应体回退为 Provider HTTP {status}", async () => {
    // 回归：方舟对未知路径返回 404 空 body，此前错误消息为空字符串导致前端无提示。
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    const provider = new SeedreamLayerizeProvider({ baseUrl: "https://ark.example/api/v3", apiKey: "ark-key" });
    await expect(provider.layerize({ imageUrl: dataUri("DDDD") })).rejects.toThrow("Provider HTTP 404");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{\"error\":{\"message\":\"content policy\"}}", { status: 400 })));
    await expect(provider.layerize({ imageUrl: dataUri("DDDD") })).rejects.toThrow("content policy");

    // 2xx 但带 error 字段的网关兼容
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { message: "rate limited" } })));
    await expect(provider.layerize({ imageUrl: dataUri("DDDD") })).rejects.toThrow("rate limited");
  });

  it("提交遇到 5xx 时不自动重试，如实失败", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("provider busy", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new SeedreamLayerizeProvider({ baseUrl: "https://ark.example/api/v3", apiKey: "ark-key" });
    await expect(provider.layerize({ imageUrl: dataUri("DDDD") })).rejects.toThrow("provider busy");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("使用任务快照传入的模型 id 提交", async () => {
    let submitted: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: URL, init?: RequestInit) => {
      submitted = JSON.parse(String(init?.body));
      return jsonResponse({ data: [{ url: dataUri("FFFF"), z_index: 1, name: "l" }] });
    }));
    const provider = new SeedreamLayerizeProvider({ baseUrl: "https://ark.example/api/v3", apiKey: "ark-key" }, { modelId: "doubao-custom-layerize" });
    await provider.layerize({ imageUrl: dataUri("DDDD") });
    expect(submitted?.model).toBe("doubao-custom-layerize");
  });

  it("probe 在校验拒绝时通过且不产生费用", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "InvalidParameter", message: "model is required" } }, 400));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new SeedreamLayerizeProvider({ baseUrl: "https://ark.example/api/v3", apiKey: "ark-key" });
    const result = await provider.probe();
    expect(result.models).toBeNull();
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://ark.example/api/v3/images/generations");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({});
  });

  it("probe 拒绝无效密钥并如实上报其余非 2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    const provider = new SeedreamLayerizeProvider({ baseUrl: "https://ark.example/api/v3", apiKey: "bad-key" });
    await expect(provider.probe()).rejects.toThrow("Seedream API key rejected");

    // 404 空 body 的网关同样要给出可读错误
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(provider.probe()).rejects.toThrow("Provider HTTP 404");
  });
});
