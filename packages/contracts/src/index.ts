import type { Static } from "@sinclair/typebox";

export * from "./enums.js";
export * from "./ref.js";
import type { AssetRole, ImageAspectRatio, ImageResolution, UserAssetKind } from "./enums.js";

export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export const IMAGE_ASPECT_RATIOS = ["AUTO", "1:1", "3:4", "4:3", "16:9"] as const;
export const MAX_CANDIDATES_PER_TYPE = 4;
export const MAX_PRODUCT_IMAGE_ASSETS = 6;
export const MAX_REFERENCE_IMAGE_ASSETS = 6;
export const MAX_GENERATION_REFERENCE_IMAGES = 4;
export const MIN_TARGET_IMAGE_COUNT = 1;
export const MAX_TARGET_IMAGE_COUNT = 12;
export const DEFAULT_TARGET_IMAGE_COUNT = 6;
export const DEFAULT_IMAGE_RESOLUTION = "1K" as const;
export const DEFAULT_IMAGE_ASPECT_RATIO = "AUTO" as const;
export const DEFAULT_CANDIDATES_PER_TYPE = 1;

/**
 * 项目级允许值映射到当前 OpenAI-compatible Images 尺寸。
 * 2K/4K 仍走 1024 家族，避免按模型名猜测更大尺寸。
 */
export function resolveImageSize(
  resolution: Static<typeof ImageResolution>,
  aspectRatio: Static<typeof ImageAspectRatio>,
  templateDefault: string
): string {
  void resolution;
  if (aspectRatio === "1:1") return "1024x1024";
  if (aspectRatio === "3:4") return "1024x1536";
  if (aspectRatio === "4:3" || aspectRatio === "16:9") return "1536x1024";
  return templateDefault;
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
