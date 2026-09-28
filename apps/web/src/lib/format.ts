/** 短日期：用于画廊卡与素材元信息，避免相对时间在测试中抖动。 */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * 日期控件选中的是「哪一天」，查询边界要覆盖整天：起点取本地 00:00:00.000、终点取本地 23:59:59.999，
 * 两端都含；否则只选一天时会漏掉当天早于/晚于取整时刻的图。空值表示该端不限。
 */
export function dayRangeBounds(startMs?: number | null, endMs?: number | null) {
  const start = typeof startMs === "number" ? new Date(startMs) : null;
  if (start) start.setHours(0, 0, 0, 0);
  const end = typeof endMs === "number" ? new Date(endMs) : null;
  if (end) end.setHours(23, 59, 59, 999);
  return { createdFrom: start ? start.toISOString() : null, createdTo: end ? end.toISOString() : null };
}
