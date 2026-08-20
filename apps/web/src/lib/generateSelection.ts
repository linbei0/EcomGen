import type { Job, StoryboardItem } from "../api/adapters/projectDetail";

export function isSelectableItem(item: StoryboardItem): boolean {
  return item.status === "CONFIRMED" || item.status === "GENERATED";
}

/** 只有已经进入或完成生图的分镜不能再修改；CONFIRMED 仍可等待后续生成。 */
export function isGenerationLocked(item: StoryboardItem): boolean {
  return item.status === "GENERATING" || item.status === "GENERATED";
}

export function ungeneratedItems(items: readonly StoryboardItem[]): StoryboardItem[] {
  return items.filter((item) => item.status === "CONFIRMED");
}

export function modeCounts(items: readonly StoryboardItem[]): { creative: number; protected: number } {
  return {
    creative: items.filter((item) => item.mode === "CREATIVE").length,
    protected: items.filter((item) => item.mode === "PIXEL_PROTECTED").length,
  };
}

export function latestGenerateJobs(jobs: readonly Job[]): Job[] {
  return jobs
    .filter((job) => job.type === "GENERATE")
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function activeGenerateJobs(jobs: readonly Job[]): Job[] {
  return latestGenerateJobs(jobs).filter((job) => job.status === "QUEUED" || job.status === "RUNNING");
}

export function hasGeneratedItem(items: readonly StoryboardItem[]): boolean {
  return items.some((item) => item.status === "GENERATED");
}
