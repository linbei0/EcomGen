export const PRODUCT_FAMILIES = ["fashion", "electronics", "beauty", "food", "home", "jewelry"] as const;
export type ProductFamily = (typeof PRODUCT_FAMILIES)[number];

const FAMILY_ALIASES: Record<ProductFamily, string[]> = {
  fashion: ["fashion", "apparel", "clothing", "服装", "服饰", "女装", "男装", "童装", "鞋靴", "鞋", "箱包", "衣服"],
  electronics: ["electronics", "gadget", "3c", "电子", "数码", "电器", "消费电子", "耳机", "手机", "电脑"],
  beauty: ["beauty", "skincare", "cosmetic", "makeup", "美妆", "护肤", "彩妆", "个护"],
  food: ["food", "snack", "beverage", "食品", "零食", "饮料", "美食"],
  home: ["home", "furniture", "家居", "家具", "家纺", "厨具", "家装"],
  jewelry: ["jewelry", "jewellery", "珠宝", "饰品", "金饰"]
};

export function resolveProductFamily(category?: string | null): ProductFamily | null {
  const value = category?.trim().toLowerCase();
  if (!value) return null;
  if ((PRODUCT_FAMILIES as readonly string[]).includes(value)) return value as ProductFamily;
  for (const family of PRODUCT_FAMILIES) {
    if (FAMILY_ALIASES[family].some((alias) => value === alias.toLowerCase() || value.includes(alias.toLowerCase()))) return family;
  }
  return null;
}

export function categoryTipFor(tips: Record<string, string>, category?: string | null): string | null {
  if (!category?.trim()) return null;
  const exact = Object.keys(tips).find((key) => key.toLowerCase() === category.trim().toLowerCase());
  if (exact) return tips[exact] ?? null;
  const family = resolveProductFamily(category);
  return family ? tips[family] ?? null : null;
}
