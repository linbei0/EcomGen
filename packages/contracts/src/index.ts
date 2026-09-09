import type { Static } from "@sinclair/typebox";

export * from "./enums.js";
export * from "./ref.js";
import type { AssetRole, ImageAspectRatio, ImageResolution, UserAssetKind } from "./enums.js";

export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export const IMAGE_ASPECT_RATIOS = ["AUTO", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
export const MAX_CANDIDATES_PER_TYPE = 4;
export const MAX_PRODUCT_IMAGE_ASSETS = 6;
export const MAX_REFERENCE_IMAGE_ASSETS = 6;
export const MAX_GENERATION_REFERENCE_IMAGES = 4;
export const MIN_TARGET_IMAGE_COUNT = 1;
export const MAX_TARGET_IMAGE_COUNT = 12;
export const DEFAULT_TARGET_IMAGE_COUNT = 6;
/** 单次分层导出元素上限：SAM 3 单次最多分割 32 个对象；Seedream 图层拆分单次最多输出 16 个图层（另有 1 张底图）。 */
export const MAX_LAYER_EXPORT_ELEMENTS_BY_PROTOCOL: Record<"fal" | "grounded_sam" | "seedream_layerize", number> = {
  fal: 32,
  grounded_sam: 32,
  seedream_layerize: 16,
};
/** 未选择分割模型时的画框数量默认上限，取各协议中的最大值。 */
export const DEFAULT_MAX_LAYER_EXPORT_ELEMENTS = MAX_LAYER_EXPORT_ELEMENTS_BY_PROTOCOL.fal;
export const DEFAULT_IMAGE_RESOLUTION = "1K" as const;
export const DEFAULT_IMAGE_ASPECT_RATIO = "AUTO" as const;
export const DEFAULT_CANDIDATES_PER_TYPE = 1;

/**
 * 项目级允许值映射到当前 OpenAI-compatible Images 尺寸。
 * 2K/4K 仍走 1024 家族，避免按模型名猜测更大尺寸；
 * 细分比例按方向折叠到 OpenAI 支持的三档尺寸，Gemini 则原生透传比例。
 */
export function resolveImageSize(
  resolution: Static<typeof ImageResolution>,
  aspectRatio: Static<typeof ImageAspectRatio>,
  templateDefault: string
): string {
  void resolution;
  if (aspectRatio === "AUTO") return templateDefault;
  if (aspectRatio === "1:1") return "1024x1024";
  const [width, height] = aspectRatio.split(":").map(Number);
  return width > height ? "1536x1024" : "1024x1536";
}

export function userAssetKindForRole(role: Static<typeof AssetRole>): Static<typeof UserAssetKind> {
  return role === "PRODUCT_TRUTH" ? "PRODUCT" : "REFERENCE";
}

export function roleForUserAssetKind(kind: Static<typeof UserAssetKind>): Static<typeof AssetRole> {
  return kind === "PRODUCT" ? "PRODUCT_TRUTH" : "STYLE_REFERENCE";
}

export * from "./legacy-schemas.js";

export * from "./api-schemas.js";
export * from "./api-requests.js";
export * from "./api-registry.js";
