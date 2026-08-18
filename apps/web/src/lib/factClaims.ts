/** factClaims 为 object[] 且字段未细化：只读展平为键值，不臆测业务字段。 */
export function factClaimRows(claims: unknown[] | undefined): { label: string; value: string }[] {
  if (!Array.isArray(claims)) return [];
  const rows: { label: string; value: string }[] = [];
  for (const claim of claims) {
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

export function scopeLabel(scope: string, variants: readonly { id: string; name: string }[]): string {
  if (scope === "COMMON") return "通用";
  return variants.find((variant) => variant.id === scope)?.name ?? "指定变体";
}

export const ITEM_STATUS_LABEL = {
  DRAFT: "草稿",
  CONFIRMED: "已确认",
  GENERATING: "生成中",
  GENERATED: "已生成",
} as const;
