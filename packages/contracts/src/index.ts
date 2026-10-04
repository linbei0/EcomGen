import type { Static } from "@sinclair/typebox";

export * from "./enums.js";
export * from "./image-model-params.js";
export * from "./ref.js";
export * from "./limits.js";
export * from "./segmentation.js";
export * from "./edit-operations.js";
export * from "./image-model-capabilities.js";
export * from "./draft-references.js";
export * from "./draft-palettes.js";
import type { AssetRole, ImageAspectRatio, ImageResolution, UserAssetKind } from "./enums.js";

// IMAGE_RESOLUTIONS 与 ImageResolution 枚举同源，定义在 enums.ts 并经顶部 `export *` 导出。
export const IMAGE_ASPECT_RATIOS = ["AUTO", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;
export const MAX_CANDIDATES_PER_TYPE = 4;
export const MAX_PRODUCT_IMAGE_ASSETS = 6;
export const MAX_REFERENCE_IMAGE_ASSETS = 6;
export const MAX_GENERATION_REFERENCE_IMAGES = 4;
export const MAX_REQUESTED_SUITE_SHOTS = 12;
export const MIN_TARGET_IMAGE_COUNT = 1;
export const MAX_TARGET_IMAGE_COUNT = 12;
export const DEFAULT_TARGET_IMAGE_COUNT = 6;
export const DEFAULT_IMAGE_RESOLUTION = "1K" as const;
export const DEFAULT_IMAGE_ASPECT_RATIO = "AUTO" as const;
export const DEFAULT_CANDIDATES_PER_TYPE = 1;

// resolveImageSize 与按模型分流的 resolveOpenAiImageSize 同主题，实现移至 image-model-params.ts 并经顶部 `export *` 导出。

export function userAssetKindForRole(role: Static<typeof AssetRole>): Static<typeof UserAssetKind> {
  return role === "PRODUCT_TRUTH" ? "PRODUCT" : "REFERENCE";
}

export function roleForUserAssetKind(kind: Static<typeof UserAssetKind>): Static<typeof AssetRole> {
  return kind === "PRODUCT" ? "PRODUCT_TRUTH" : "STYLE_REFERENCE";
}

export * from "./legacy-schemas.js";

export * from "./api-schemas.js";
export * from "./api-requests.js";
export * from "./model-schemas.js";
export * from "./pod-schemas.js";
export * from "./pattern-draft-schemas.js";
export * from "./pod-print-specs.js";
export * from "./pod-repeat.js";
export * from "./pod-tileability.js";
export * from "./api-registry.js";
export * from "./suite-validation.js";
