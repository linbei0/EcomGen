import {
  DEFAULT_IMAGE_QUALITY,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_QUALITIES,
  IMAGE_RESOLUTIONS,
  isSeedreamImageModel,
  resolveOpenAiImageSize,
  supportsArbitraryImageSize,
  supportsOpenAiImageOutputFormat,
  supportsOpenAiImageQuality,
} from "@ecomgen/contracts";
import type { ImageAspectRatio, ImageOutputFormat, ImageQuality, ImageResolution } from "@ecomgen/contracts";
import sharp from "sharp";

/**
 * 生图任务快照 → Provider 请求参数的装配单源。
 *
 * API 已按契约校验入参，这里只做防御性重读：任务快照缺字段（旧数据）或取值超出枚举时
 * 回退缺省，绝不让未知值直接进 Provider 请求体。缺省值与历史硬编码一致
 * （分辨率 1K、质量 high），未配置新参数的任务请求形状与旧行为逐字节相同。
 */

export function resolutionFromSnapshot(value: unknown, fallback: ImageResolution = "1K"): ImageResolution {
  return typeof value === "string" && (IMAGE_RESOLUTIONS as readonly string[]).includes(value) ? (value as ImageResolution) : fallback;
}

export function qualityFromSnapshot(value: unknown): ImageQuality | undefined {
  return typeof value === "string" && (IMAGE_QUALITIES as readonly string[]).includes(value) ? (value as ImageQuality) : undefined;
}

export function outputFormatFromSnapshot(value: unknown): ImageOutputFormat | undefined {
  return typeof value === "string" && (IMAGE_OUTPUT_FORMATS as readonly string[]).includes(value) ? (value as ImageOutputFormat) : undefined;
}

export interface OpenAiImageRequestParamsOptions {
  /** 用户选择的质量档位；仅在模型认识 quality 时下发。 */
  quality?: ImageQuality;
  /** 用户选择的产物格式；仅在模型认识 output_format 时下发。 */
  outputFormat?: ImageOutputFormat;
}

/**
 * `images/generations` 分支的共享参数：size 按模型分流（Seedream 官方像素表 / 其余 1024 家族），
 * quality 与 output_format 只在模型认识时下发；Seedream 默认给图片加“AI生成”水印，
 * 电商成图必须显式关闭，其他模型不带该字段（域名专属参数，发了有被拒风险）。
 */
export function openAiImageRequestParams(
  modelId: string,
  resolution: ImageResolution,
  aspectRatio: ImageAspectRatio,
  templateDefault: string,
  options: OpenAiImageRequestParamsOptions = {}
): { size: string; quality?: ImageQuality; outputFormat?: ImageOutputFormat; watermark?: false } {
  return {
    size: resolveOpenAiImageSize(modelId, resolution, aspectRatio, templateDefault),
    ...(options.quality !== undefined && supportsOpenAiImageQuality(modelId) ? { quality: options.quality } : {}),
    ...(options.outputFormat !== undefined && supportsOpenAiImageOutputFormat(modelId) ? { outputFormat: options.outputFormat } : {}),
    ...(isSeedreamImageModel(modelId) ? { watermark: false as const } : {}),
  };
}

/**
 * `images/edits` 分支的尺寸策略：size 支持档位像素的模型（Seedream 全家 / gpt-image-2+）
 * 显式下发；其余模型维持各自现状——gpt-image-1 的 edits 按源图自适应尺寸，调用方原来不发
 * size 的继续不发、发了的传原折叠值，避免“为支持新模型而顺手改变旧行为”。
 * AUTO 比例没有可映射的像素，同样回退。
 */
export function openAiEditSize(
  modelId: string,
  resolution: ImageResolution,
  aspectRatio: ImageAspectRatio,
  fallback: string | undefined
): string | undefined {
  if (!supportsArbitraryImageSize(modelId) || aspectRatio === "AUTO") return fallback;
  return resolveOpenAiImageSize(modelId, resolution, aspectRatio, "1024x1024");
}

/** 质量档位在 openai_images 分支的实际下发值：模型不认识时为 undefined（请求体省略该字段）。 */
export function openAiImageQuality(modelId: string, quality: ImageQuality | undefined): ImageQuality | undefined {
  if (quality === undefined) quality = DEFAULT_IMAGE_QUALITY;
  return supportsOpenAiImageQuality(modelId) ? quality : undefined;
}

const MIME_TO_FORMAT: Record<string, ImageOutputFormat> = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" };

/**
 * 产物格式兜底：用户选了 webp/jpeg 而兼容渠道没有兑现（照默认 PNG 返回）时，
 * 本地转码到请求的格式再落盘，让「选什么格式得什么格式」成为我方契约而不是赌渠道。
 * 渠道已兑现时字节原样透传，不做无谓的二次编码。
 */
export async function normalizeOutputFormat(image: Buffer, requested: ImageOutputFormat | undefined, actualMimeType: string): Promise<{ image: Buffer; mimeType: string }> {
  if (!requested || MIME_TO_FORMAT[actualMimeType] === requested) return { image, mimeType: actualMimeType };
  const pipeline = sharp(image);
  if (requested === "jpeg") {
    // jpeg 装不下 alpha：透明像素平铺成白底，避免黑底惊吓。
    await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 92 });
  } else if (requested === "webp") {
    await pipeline.webp({ quality: 90 });
  } else {
    await pipeline.png();
  }
  return { image: await pipeline.toBuffer(), mimeType: `image/${requested}` };
}
