import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GITEE_SAM3_SEGMENTATION_PATH, GiteeSam3SegmentationProvider } from "./gitee-sam3.js";

/**
 * Gitee 官方 JS 样例（rleDecode）的逆变换：j>2 时先做 cnts[j]-cnts[j-2] 差分；
 * 变长组为字符-48 = 低 5 位数据 + 0x20 续读位；数据块含 0x10 且余量不是全 1（负）时续读，
 * 终端字符的 0x10 位即负号（与 pycocotools C 终端 0x40 位不同，实测 2026-09 真实响应校准）。
 */
function rleCounts_(counts: number[], gzip: boolean): string {
  const chars: string[] = [];
  counts.forEach((count, index) => {
    let x = index > 2 ? count - counts[index - 2] : count;
    let more = true;
    while (more) {
      const data = x & 0x1f;
      x >>= 5;
      more = (data & 0x10) !== 0 ? x !== -1 : x !== 0;
      chars.push(String.fromCharCode(48 + (more ? data | 0x20 : data)));
    }
  });
  const bytes = Buffer.from(chars.join(""), "ascii");
  return gzip ? Buffer.from(gzipSync(bytes)).toString("base64") : bytes.toString("base64");
}

describe("gitee AI SAM 3 segmentation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends model/prompt/image multipart form with Bearer authorization", async () => {
    let request: RequestInit | undefined;
    let url: URL | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: URL, init?: RequestInit) => {
      url = input;
      request = init;
      return new Response(JSON.stringify({
        num_segments: 1,
        segments: [{ id: 1, label: "bottle", confidence: 0.95, bbox: [0, 0, 2, 2], mask: { encoding: "rle", size: [2, 2], counts: rleCounts_([0, 4], true) } }]
      }), { status: 200 });
    }));

    const provider = new GiteeSam3SegmentationProvider({ baseUrl: "https://ai.gitee.com/v1", apiKey: "gitee-key" });
    const result = await provider.segment({ imageUrl: "data:image/jpeg;base64,BBBB", textPrompt: "cosmetic bottle" });

    expect(String(url)).toBe(`https://ai.gitee.com/v1/${GITEE_SAM3_SEGMENTATION_PATH}`);
    expect(new Headers(request?.headers).get("authorization")).toBe("Bearer gitee-key");
    const form = request?.body as FormData;
    expect(form.get("model")).toBe("sam3");
    expect(form.get("prompt")).toBe("cosmetic bottle");
    const image = form.get("image");
    expect(image).toBeInstanceOf(File);
    expect((image as File).type).toBe("image/jpeg");
    expect(result.mask.mimeType).toBe("raw/gray8");
    expect(result.providerTaskId).toBeNull();
  });

  it("decodes gzipped COCO RLE masks and normalizes the pixel bbox", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      segments: [{ confidence: 0.9, bbox: [1, 1, 2, 2], mask: { encoding: "rle", size: [2, 2], counts: rleCounts_([0, 2, 0, 2], true) } }]
    }), { status: 200 })));

    const provider = new GiteeSam3SegmentationProvider({ baseUrl: "https://ai.gitee.com/v1", apiKey: "gitee-key" });
    const result = await provider.segment({ imageUrl: "data:image/png;base64,CCCC", textPrompt: "bottle" });

    expect(result.mask.width).toBe(2);
    expect(result.mask.height).toBe(2);
    expect(result.mask.data).toEqual(Buffer.from([255, 255, 255, 255]));
    expect(result.bbox).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    expect(result.score).toBe(0.9);
  });

  it("decodes negative differential counts via the Gitee sign bit (0x10)", async () => {
    // counts [0,2,2,0] 的差分存储为 [0,2,2,-2]：真实渠道用终端字符 0x10 位表达负差分（pycocotools C 用 0x40，这里曾解码失败）
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      segments: [{ mask: { encoding: "rle", size: [2, 2], counts: rleCounts_([0, 2, 2, 0], false) } }]
    }), { status: 200 })));

    const provider = new GiteeSam3SegmentationProvider({ baseUrl: "https://ai.gitee.com/v1", apiKey: "gitee-key" });
    const result = await provider.segment({ imageUrl: "data:image/png;base64,CCCC", textPrompt: "bottle" });
    // 列主序展开：背景 0 个 → 前景 2（第 0 列）→ 背景 2（第 1 列）→ 前景 0，转置行主序后前景在 gray[0]/gray[2]
    expect(result.mask.data).toEqual(Buffer.from([255, 0, 255, 0]));
  });

  it("falls back to plain pycocotools counts when not gzipped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      segments: [{ mask: { encoding: "rle", size: [2, 2], counts: rleCounts_([0, 2, 0, 2], false) } }]
    }), { status: 200 })));

    const provider = new GiteeSam3SegmentationProvider({ baseUrl: "https://ai.gitee.com/v1", apiKey: "gitee-key" });
    const result = await provider.segment({ imageUrl: "data:image/png;base64,CCCC", textPrompt: "bottle" });
    expect(result.mask.data).toEqual(Buffer.from([255, 255, 255, 255]));
  });

  it("picks the highest-confidence segment when multiple are returned", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      num_segments: 2,
      segments: [
        { confidence: 0.4, bbox: [0, 0, 1, 1], mask: { encoding: "rle", size: [2, 2], counts: rleCounts_([1, 1, 1, 1], false) } },
        { confidence: 0.9, bbox: [1, 1, 2, 2], mask: { encoding: "rle", size: [2, 2], counts: rleCounts_([0, 2, 0, 2], false) } }
      ]
    }), { status: 200 })));

    const provider = new GiteeSam3SegmentationProvider({ baseUrl: "https://ai.gitee.com/v1", apiKey: "gitee-key" });
    const result = await provider.segment({ imageUrl: "data:image/png;base64,CCCC", textPrompt: "bottle" });
    expect(result.bbox).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  });

  it("passes network image URLs as a plain form field", async () => {
    let request: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: URL | string, init?: RequestInit) => {
      request = init;
      return new Response(JSON.stringify({ segments: [{ mask: { encoding: "rle", size: [2, 2], counts: rleCounts_([0, 2, 0, 2], false) } }] }), { status: 200 });
    }));

    const provider = new GiteeSam3SegmentationProvider({ baseUrl: "https://ai.gitee.com/v1", apiKey: "gitee-key" });
    await provider.segment({ imageUrl: "https://example.com/image.jpg", textPrompt: "bottle" });
    const form = request?.body as FormData;
    expect(form.get("image")).toBe("https://example.com/image.jpg");
  });

  it("rejects box prompts and empty prompts without contacting the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GiteeSam3SegmentationProvider({ baseUrl: "https://ai.gitee.com/v1", apiKey: "gitee-key" });

    await expect(provider.segment({ imageUrl: "data:image/png;base64,CCCC", textPrompt: "bottle", box: { xMin: 0, yMin: 0, xMax: 1, yMax: 1 } }))
      .rejects.toMatchObject({ status: 400 });
    await expect(provider.segment({ imageUrl: "data:image/png;base64,CCCC" }))
      .rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports non-2xx responses verbatim", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const provider = new GiteeSam3SegmentationProvider({ baseUrl: "https://ai.gitee.com/v1", apiKey: "gitee-key" });
    await expect(provider.segment({ imageUrl: "data:image/png;base64,CCCC", textPrompt: "bottle" }))
      .rejects.toMatchObject({ status: 500, message: "boom" });
  });

  it("probe passes on validation rejection without executing the model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("missing field image", { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GiteeSam3SegmentationProvider({ baseUrl: "https://ai.gitee.com/v1", apiKey: "gitee-key" });
    const result = await provider.probe();
    expect(result.models).toBeNull();
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get("model")).toBeNull();
    expect(form.get("image")).toBeNull();
  });

  it("probe reports invalid API keys", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    const provider = new GiteeSam3SegmentationProvider({ baseUrl: "https://ai.gitee.com/v1", apiKey: "bad-key" });
    await expect(provider.probe()).rejects.toMatchObject({ status: 401, message: "gitee API key rejected" });
  });
});
