import type { Job, Output, StoryboardItem } from "../api/adapters/projectDetail";

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

export interface GenerationBatchReviewGroup {
  id: string;
  createdAt: string;
  retryCount: number;
  groups: ReviewGroup[];
}

/** 首次生成按用户的一次提交聚合；编辑输出在调用方排除，重试仍保留在原批次。 */
export function groupOutputsByGenerationBatch(
  items: readonly StoryboardItem[],
  outputs: readonly Output[],
  jobs: readonly Job[],
): GenerationBatchReviewGroup[] {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const buckets = new Map<string, Output[]>();
  for (const output of outputs) {
    const id = output.generationBatchId ?? output.jobId ?? output.id;
    const bucket = buckets.get(id) ?? [];
    bucket.push(output);
    buckets.set(id, bucket);
  }
  return Array.from(buckets, ([id, batchOutputs]) => {
    const jobTimes = batchOutputs.map((output) => jobsById.get(output.jobId)?.createdAt).filter((time): time is string => Boolean(time));
    const createdAt = (jobTimes.length ? jobTimes : batchOutputs.map((output) => output.createdAt)).sort()[0]!;
    return {
      id,
      createdAt,
      retryCount: batchOutputs.filter((output) => output.generationSnapshot?.revision === "retry").length,
      groups: groupOutputsByItem(items, batchOutputs),
    };
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
