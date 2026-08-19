import type { StoryboardItem } from "../api/adapters/projectDetail";
import type { EcomTemplate } from "../api/adapters/templates";

export function itemDisplayName(
  item: Pick<StoryboardItem, "assetType" | "displayName">,
  templates: readonly Pick<EcomTemplate, "id" | "name">[] = [],
): string {
  if (item.displayName && item.displayName !== item.assetType) return item.displayName;
  return templates.find((template) => template.id === item.assetType)?.name ?? item.displayName ?? item.assetType;
}
