import type { Output, StoryboardItem } from "../api/adapters/projectDetail";

export type ReviewDecision = Output["reviewDecision"];

export const REVIEW_LABEL: Record<ReviewDecision, string> = {
  SELECTED: "已选入",
  REJECTED: "已淘汰",
  NEEDS_REVIEW: "待审核",
};

/** 审核分组：按分镜聚合，组内按创建时间排序，便于同分镜对比留哪张。 */
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

/** 乐观更新：在详情 outputs 中就地替换决策，失败时整体回滚到快照。 */
export function applyDecision(
  outputs: readonly Output[],
  outputId: string,
  decision: ReviewDecision,
): Output[] {
  return outputs.map((output) => (output.id === outputId ? { ...output, reviewDecision: decision } : output));
}
