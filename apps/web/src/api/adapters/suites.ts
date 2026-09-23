import type { components } from "../schema.d.ts";

/** 套图契约已是 camelCase，适配层只做类型收敛与展示投影，不做字段重命名。 */
export type SuiteSummary = components["schemas"]["EcomSuiteSummary"];
export type SuiteDetail = components["schemas"]["EcomSuiteDetail"];
export type SuiteShot = SuiteDetail["shots"][number];
export type SuiteCategory = components["schemas"]["SuiteCategory"];
export type SuiteFileInput = components["schemas"]["EcomSuiteFile"];
export type SuiteShotRole = NonNullable<SuiteShot["shotRole"]>;
export type SuiteOrigin = SuiteSummary["origin"];
export type SuitesResponse = components["schemas"]["EcomSuitesResponse"];
export type SuiteOriginCounts = components["schemas"]["EcomSuiteOriginCounts"];
export type SuiteCategoriesResponse = components["schemas"]["EcomSuiteCategoriesResponse"];

/** 套图列表的筛选条件；undefined 的 origin 表示内置与导入合并浏览，与省略查询参数等价。 */
export interface SuitePageFilters {
  q: string;
  l1?: string;
  l2?: string;
  origin?: SuiteOrigin;
}

export function adaptSuites(payload: SuitesResponse): SuiteSummary[] {
  return payload.items;
}

/** 列表与详情的分镜角色统计，用于卡片角标与选择条。 */
export function roleCounts(shots: ReadonlyArray<{ shotRole: string | null }>): Array<{ role: string; count: number }> {
  const counts = new Map<string, number>();
  for (const shot of shots) {
    if (!shot.shotRole) continue;
    counts.set(shot.shotRole, (counts.get(shot.shotRole) ?? 0) + 1);
  }
  return [...counts.entries()].map(([role, count]) => ({ role, count }));
}
