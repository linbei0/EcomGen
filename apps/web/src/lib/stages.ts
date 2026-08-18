import type { ProjectDetail } from "../api/adapters/projectDetail";

export const STAGES = ["assets", "plan", "storyboard", "generate", "review", "export"] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_META: Record<Stage, { label: string; index: number }> = {
  assets: { label: "素材", index: 0 },
  plan: { label: "规划", index: 1 },
  storyboard: { label: "分镜", index: 2 },
  generate: { label: "生成", index: 3 },
  review: { label: "审核", index: 4 },
  export: { label: "导出", index: 5 },
};

export function isStage(value: string | null | undefined): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

export function parseStage(value: string | null | undefined, fallback: Stage): Stage {
  return isStage(value) ? value : fallback;
}

/**
 * 由项目详情推导"进行到哪一步"。完成条件见 docs/09 §5：
 * 有素材→素材完成；有 storyboard/items→规划完成；CONFIRMED→分镜完成；
 * 有 outputs→生成完成；有 SELECTED→审核完成；有 SUCCEEDED export→导出完成。
 * 返回值是当前应停留的最深已完成阶段（无进度则 assets）。
 */
export function deriveStage(detail: ProjectDetail): Stage {
  const hasExport = detail.jobs.some((job) => job.type === "EXPORT" && job.status === "SUCCEEDED");
  if (hasExport) return "export";
  if (detail.outputs.some((output) => output.reviewDecision === "SELECTED")) return "review";
  if (detail.outputs.length > 0) return "generate";
  if (detail.storyboard?.status === "CONFIRMED") return "storyboard";
  if (detail.storyboard !== null || detail.items.length > 0) return "plan";
  if (detail.assets.length > 0) return "assets";
  return "assets";
}

/** 已完成的阶段集合，供阶段条点亮。 */
export function completedStages(detail: ProjectDetail): ReadonlySet<Stage> {
  const done = new Set<Stage>();
  if (detail.assets.length > 0) done.add("assets");
  if (detail.storyboard !== null || detail.items.length > 0) done.add("plan");
  if (detail.storyboard?.status === "CONFIRMED") done.add("storyboard");
  if (detail.outputs.length > 0) done.add("generate");
  if (detail.outputs.some((output) => output.reviewDecision === "SELECTED")) done.add("review");
  if (detail.jobs.some((job) => job.type === "EXPORT" && job.status === "SUCCEEDED")) {
    done.add("export");
  }
  return done;
}
