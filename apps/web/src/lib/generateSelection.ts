import type { Job, StoryboardItem } from "../api/adapters/projectDetail";

export function isSelectableItem(item: StoryboardItem): boolean {
  return item.status === "CONFIRMED" || item.status === "GENERATED";
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
