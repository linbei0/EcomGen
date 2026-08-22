import type { Output, StoryboardItem } from "../api/adapters/projectDetail";

/** 结果分组：按分镜聚合，组内按创建时间排序，便于同分镜对比。 */
export interface ReviewGroup {
  item: StoryboardItem;
  outputs: Output[];
}

export function groupOutputsByItem(items: readonly StoryboardItem[], outputs: readonly Output[]): ReviewGroup[] {
  const byItem = new Map<string, Output[]>();
  for (const output of outputs) {
    const bucket = byItem.get(output.storyboardItemId) ?? [];
    bucket.push(output);
    byItem.set(output.storyboardItemId, bucket);
  }
  return items
    .filter((item) => byItem.has(item.id))
    .map((item) => ({
      item,
      outputs: (byItem.get(item.id) ?? [])
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    }));
}
