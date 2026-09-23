import type { StoryboardItem } from "../api/adapters/projectDetail";
import type { EcomTemplate } from "../api/adapters/templates";

/**
 * 拆出套图分镜 assetType 的 `<suiteId>::<shotId>` 两段；缺任一段都按单图模板处理。
 * 套图 id 与分镜 id 都是内部标识，只能用于回读套图摘要，不能直接展示给卖家。
 */
export function splitSuiteAssetType(assetType: string): { suiteId: string; shotId: string } | undefined {
  const separator = assetType.indexOf("::");
  if (separator <= 0) return undefined;
  const suiteId = assetType.slice(0, separator);
  const shotId = assetType.slice(separator + 2);
  return shotId ? { suiteId, shotId } : undefined;
}

export function itemDisplayName(
  item: Pick<StoryboardItem, "assetType" | "displayName">,
  templates: readonly Pick<EcomTemplate, "id" | "name">[] = [],
): string {
  if (item.displayName && item.displayName !== item.assetType) return item.displayName;
  return templates.find((template) => template.id === item.assetType)?.name ?? item.displayName ?? item.assetType;
}
