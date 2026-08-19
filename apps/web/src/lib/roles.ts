import type { AssetRole, UserAssetKind } from "../api/adapters/projectDetail";

export const USER_ASSET_KIND_META: Record<UserAssetKind, { label: string; hint: string }> = {
  PRODUCT: { label: "产品图", hint: "商品外观与可见细节，像素保护必须使用这些图" },
  REFERENCE: { label: "参考图", hint: "只参考风格、构图或氛围，不会当成商品事实" },
};

export const USER_ASSET_KIND_ORDER: UserAssetKind[] = ["PRODUCT", "REFERENCE"];

export function kindForRole(role: AssetRole): UserAssetKind {
  return role === "PRODUCT_TRUTH" ? "PRODUCT" : "REFERENCE";
}

export const PLATFORM_LABEL = {
  DOMESTIC: "国内平台",
  AMAZON: "Amazon",
} as const;

export const RESOLUTION_LABEL = {
  "1K": "1K",
  "2K": "2K",
  "4K": "4K",
} as const;

export const ASPECT_LABEL = {
  AUTO: "自适应",
  "1:1": "1:1",
  "3:4": "3:4",
  "4:3": "4:3",
  "16:9": "16:9",
} as const;
