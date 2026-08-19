import type { ProjectDetail } from "../api/adapters/projectDetail";

export const VIEWS = ["setup", "storyboard", "results"] as const;

export type WorkbenchView = (typeof VIEWS)[number];

export const VIEW_META: Record<WorkbenchView, { label: string; index: number }> = {
  setup: { label: "配置", index: 0 },
  storyboard: { label: "分镜", index: 1 },
  results: { label: "结果", index: 2 },
};

export function isView(value: string | null | undefined): value is WorkbenchView {
  return typeof value === "string" && (VIEWS as readonly string[]).includes(value);
}

export function parseView(value: string | null | undefined, fallback: WorkbenchView): WorkbenchView {
  if (isView(value)) return value;
  if (value === "assets" || value === "plan") return "setup";
  if (value === "generate" || value === "review" || value === "export") return "results";
  return fallback;
}

export function deriveView(detail: ProjectDetail): WorkbenchView {
  const generating = detail.jobs.some(
    (job) => job.type === "GENERATE" && (job.status === "QUEUED" || job.status === "RUNNING"),
  );
  if (detail.outputs.length > 0 || generating) return "results";
  if (detail.storyboard !== null || detail.items.length > 0) return "storyboard";
  return "setup";
}

export function completedViews(detail: ProjectDetail): ReadonlySet<WorkbenchView> {
  const done = new Set<WorkbenchView>();
  if (detail.assets.length > 0) done.add("setup");
  if (detail.storyboard !== null || detail.items.length > 0) done.add("storyboard");
  if (detail.outputs.length > 0) done.add("results");
  return done;
}
