import { gunzipSync } from "node:zlib";

import { ProviderConnection, ProviderError } from "./openai-compatible.js";
import type { FalSegmentationResult } from "./fal.js";

/**
 * Gitee AI（模力方舟）SAM 3 分割适配器（协议于 2026-09 对照官方文档与 JS 示例校对）：
 * - 同步 pipeline 端点：POST {baseUrl}/images/segmentation，认证头 `Authorization: Bearer <token>`。
 * - 表单字段仅 model（固定 sam3）/ image / prompt 三项：image 用 data URI 时按 multipart 文件上传，
 *   http(s) URL 按文档的网络图片路径作为字符串字段传入。
 * - prompt 是分割目标文本；接口没有框提示（box prompts），手动框选元素不适用此协议。
 * - 响应 segments[].mask 是 COCO RLE：counts 为 base64（内容若以 gzip magic 开头则先解压），
 *   再按官方 JS 样例（rleDecode）的变长编码解码——与 pycocotools C 仅符号位不同（0x10 vs 0x40，
 *   2026-09 用真实响应实测校准：0x10 时游程总和恰好等于 mask 面积且解出 bbox 与服务端一致）；
 *   展开顺序是列主序（Fortran），需转置为行主序灰度图。
 * - mask.size 遵循 COCO 惯例 [height, width]；bbox 是原图像素坐标 [x1, y1, x2, y2]，
 *   归一化时假设 mask.size 与原图一致（文档示例一致；如真实响应不符需在此换算）。
 * - 分割按次计费：只提交一次，网络失败/超时如实上报，不自动重发；探测绝不执行模型。
 */
export const GITEE_SAM3_SEGMENTATION_PATH = "images/segmentation";

const SEGMENTATION_REQUEST_TIMEOUT_MS = 120_000;

export interface GiteeSam3SegmentationInput {
  /** 公网 URL 或 base64 data URI。 */
  imageUrl: string;
  /** 文本提示（元素名称）；协议只支持文本驱动，不能留空。 */
  textPrompt?: string;
  /** 不受支持：Gitee pipeline 表单没有框提示字段。 */
  box?: { xMin: number; yMin: number; xMax: number; yMax: number };
}

interface GiteeSam3Segment {
  id?: number;
  label?: string;
  confidence?: number;
  bbox?: unknown;
  mask?: { encoding?: string; size?: unknown; counts?: string };
}
interface GiteeSam3Response { num_segments?: number; segments?: GiteeSam3Segment[]; }

export class GiteeSam3SegmentationProvider {
  public constructor(private readonly connection: ProviderConnection) { }

  public async segment(input: GiteeSam3SegmentationInput): Promise<FalSegmentationResult> {
    if (input.box) throw new ProviderError("gitee sam3 pipeline does not support box prompts; use fal or grounded_sam for manual box elements", 400);
    const prompt = input.textPrompt?.trim();
    if (!prompt) throw new ProviderError("gitee sam3 requires a text prompt", 400);
    const form = new FormData();
    form.set("model", "sam3");
    form.set("prompt", prompt);
    if (/^data:/i.test(input.imageUrl)) {
      const comma = input.imageUrl.indexOf(",");
      const mimeType = /data:([^;]+)/i.exec(input.imageUrl.slice(0, comma))?.[1] ?? "image/png";
      form.set("image", new Blob([Buffer.from(input.imageUrl.slice(comma + 1), "base64")], { type: mimeType }), "image.png");
    } else {
      // 文档支持网络图片 URL：直接作为表单字符串字段传给服务端拉取。
      form.set("image", input.imageUrl);
    }
    // 分割请求按次计费：只提交一次，网络失败/超时如实上报，不自动重发。
    const response = await fetch(new URL(`${this.baseUrl()}${GITEE_SAM3_SEGMENTATION_PATH}`), {
      method: "POST",
      headers: { authorization: `Bearer ${this.connection.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(SEGMENTATION_REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) throw new ProviderError(await response.text(), response.status);
    const body = await response.json() as GiteeSam3Response;
    const segment = (body.segments ?? []).reduce<GiteeSam3Segment | null>((best, current) => ((current.confidence ?? 0) >= (best?.confidence ?? 0) ? current : best), null);
    if (!segment?.mask) throw new ProviderError("gitee sam3 response does not contain a segment mask", 502);
    const size = segment.mask.size;
    if (!isSizePair(size) || typeof segment.mask.counts !== "string") throw new ProviderError("gitee sam3 mask is missing size or counts", 502);
    const [maskHeight, maskWidth] = size;
    const gray = unpackRleMask(decodeRleCounts(segment.mask.counts), maskWidth, maskHeight);
    return {
      mask: { data: gray, mimeType: "raw/gray8", width: maskWidth, height: maskHeight },
      bbox: isBboxQuad(segment.bbox)
        ? {
          x: clamp01(segment.bbox[0] / maskWidth),
          y: clamp01(segment.bbox[1] / maskHeight),
          width: clamp01((segment.bbox[2] - segment.bbox[0]) / maskWidth),
          height: clamp01((segment.bbox[3] - segment.bbox[1]) / maskHeight)
        }
        : null,
      score: typeof segment.confidence === "number" ? segment.confidence : null,
      providerTaskId: null
    };
  }

  /**
   * 探测只做连通性与认证校验，不执行模型：发送空表单，服务端在校验层直接拒绝
   * （400/422，无模型执行、无费用）；401/403 说明密钥无效。其余响应如实报错。
   */
  public async probe(): Promise<{ latencyMs: number; models: null }> {
    const started = Date.now();
    const response = await fetch(new URL(`${this.baseUrl()}${GITEE_SAM3_SEGMENTATION_PATH}`), {
      method: "POST",
      headers: { authorization: `Bearer ${this.connection.apiKey}` },
      body: new FormData(),
      signal: AbortSignal.timeout(30_000)
    });
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("gitee API key rejected", response.status);
    }
    if (response.status !== 400 && response.status !== 422) throw new ProviderError(await response.text(), response.status);
    return { latencyMs: Date.now() - started, models: null };
  }

  private baseUrl(): string {
    return this.connection.baseUrl.endsWith("/") ? this.connection.baseUrl : `${this.connection.baseUrl}/`;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isSizePair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry > 0);
}

function isBboxQuad(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length >= 4 && value.slice(0, 4).every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

/**
 * 解码 COCO RLE 的 counts：base64 →（gzip magic 则解压）→ 变长字符串。
 * 变长编码按 Gitee 官方 JS 样例（rleDecode）：字符 - 48，低 5 位数据、0x20 续读位、
 * 0x10 负数扩展位——与 pycocotools C 的 0x40 不同（2026-09 用真实响应实测：
 * 0x10 时游程总和恰好等于 mask 面积且解出 bbox 与服务端 bbox 一致，0x40 溢出）；
 * 除首 3 个计数外其余是「与前前项之差」，需累加还原。
 */
function decodeRleCounts(encoded: string): number[] {
  let bytes = Buffer.from(encoded, "base64");
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
  }
  const counts: number[] = [];
  let position = 0;
  while (position < bytes.length) {
    let x = 0; let shift = 0; let more = true;
    while (more) {
      const c = bytes[position] - 48;
      position += 1;
      x |= (c & 0x1f) << (5 * shift);
      more = (c & 0x20) !== 0;
      shift += 1;
      if (!more && (c & 0x10) !== 0) x |= -1 << (5 * shift);
    }
    if (counts.length > 2) x += counts[counts.length - 2];
    if (x < 0) throw new ProviderError("gitee sam3 mask RLE counts are unreadable", 502);
    counts.push(x);
  }
  return counts;
}

/** RLE 展开是列主序 0/1 游程（首个 run 为背景）；转置为行主序灰度图（前景 255）。 */
function unpackRleMask(counts: number[], width: number, height: number): Buffer {
  const total = width * height;
  const columnMajor = new Uint8Array(total);
  let offset = 0;
  let value = 0;
  for (const count of counts) {
    if (value === 1) columnMajor.fill(1, offset, Math.min(offset + count, total));
    offset += count;
    value = 1 - value;
  }
  if (offset !== total) throw new ProviderError("gitee sam3 mask RLE does not cover the mask size", 502);
  const gray = Buffer.alloc(total);
  for (let index = 0; index < total; index++) {
    if (columnMajor[index] === 1) gray[(index % height) * width + Math.floor(index / height)] = 255;
  }
  return gray;
}
