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
  TAOBAO: "淘宝/天猫",
  JD: "京东",
  PDD: "拼多多",
  DOUYIN: "抖音",
  AMAZON: "亚马逊",
  SHOPIFY: "独立站",
} as const;

export const RESOLUTION_LABEL = {
  "1K": "1K",
  "2K": "2K",
  "4K": "4K",
} as const;

export const ASPECT_LABEL = {
  AUTO: "自适应",
  "1:1": "1:1 正方形",
  "2:3": "2:3 竖版",
  "3:2": "3:2 横版",
  "3:4": "3:4 竖版",
  "4:3": "4:3 横版",
  "4:5": "4:5 竖版",
  "5:4": "5:4 横版",
  "9:16": "9:16 手机竖版",
  "16:9": "16:9 宽屏",
  "21:9": "21:9 超宽屏",
} as const;
