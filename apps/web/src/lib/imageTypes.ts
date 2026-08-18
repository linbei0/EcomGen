/**
 * 契约缺口：CreateProjectInput 不含 imageTypes（规划才接收）。
 * 向导所选模板 ID 暂存 sessionStorage，P4 规划面板读取；不改后端。
 */
const PREFIX = "ecomgen.imageTypes.";

export function saveImageTypes(projectId: string, ids: readonly string[]): void {
  try {
    sessionStorage.setItem(`${PREFIX}${projectId}`, JSON.stringify(ids));
  } catch {
    /* 隐私模式或配额：规划阶段用户可再选 */
  }
}

export function loadImageTypes(projectId: string): string[] {
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${projectId}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}
