export function factClaimRows(claims: unknown[] | undefined): { label: string; value: string }[] {
  if (!Array.isArray(claims)) return [];
  const rows: { label: string; value: string }[] = [];
  for (const claim of claims) {
    if (typeof claim === "string" && claim.trim()) {
      rows.push({ label: "卖点", value: claim });
      continue;
    }
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) continue;
    for (const [label, raw] of Object.entries(claim)) {
      if (raw === undefined || raw === null || raw === "") continue;
      rows.push({
        label,
        value: typeof raw === "string" ? raw : JSON.stringify(raw),
      });
    }
  }
  return rows;
}

export const ITEM_STATUS_LABEL = {
  DRAFT: "草稿",
  CONFIRMED: "已确认",
  GENERATING: "生成中",
  GENERATED: "已生成",
} as const;

export const JOB_STATUS_LABEL = {
  QUEUED: "排队中",
  RUNNING: "生成中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
} as const;
