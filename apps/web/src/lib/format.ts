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

/**
 * 列表卡上的时间：一周内走相对时间（"3 天前"），更早直接给日期。
 * 以调用时刻为基准，所以同一 ISO 在不同时刻结果不同；需要稳定快照的场合用 formatShortDate。
 */
export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso.slice(0, 10);
  const elapsed = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return "刚刚";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)} 分钟前`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)} 小时前`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)} 天前`;
  return iso.slice(0, 10);
}
