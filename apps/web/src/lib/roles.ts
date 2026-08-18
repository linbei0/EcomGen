import type { AssetRole } from "../api/adapters/projectDetail";

export const ASSET_ROLE_META: Record<AssetRole, { label: string; hint: string }> = {
  PRODUCT_TRUTH: { label: "商品真实性", hint: "像素保护必须使用同范围的这组图" },
  PACKAGING: { label: "包装配件", hint: "包装、配件、说明书" },
  STYLE_REFERENCE: { label: "风格参考", hint: "只影响感觉，不会被复制" },
  LAYOUT_REFERENCE: { label: "竞品构图", hint: "只参考构图，不会被复制" },
};

export const ASSET_ROLE_ORDER: AssetRole[] = [
  "PRODUCT_TRUTH",
  "PACKAGING",
  "STYLE_REFERENCE",
  "LAYOUT_REFERENCE",
];

export const PLATFORM_LABEL = {
  DOMESTIC: "国内平台",
  AMAZON: "Amazon",
} as const;
