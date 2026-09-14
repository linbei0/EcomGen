/**
 * 套图分镜选择草稿：与单图模板的 imageTypes 一样按项目暂存 sessionStorage。
 * 存储的是分镜 assetType（<suiteId>::<shotId>），规划提交时随 MANUAL 请求发送 requestedSuiteShots。
 */
const PREFIX = "ecomgen.suiteShots.";

export function saveSuiteShots(projectId: string, assetTypes: readonly string[]): void {
  try {
    sessionStorage.setItem(`${PREFIX}${projectId}`, JSON.stringify(assetTypes));
  } catch {
    /* 隐私模式或配额：用户在规划面板可再选 */
  }
}

export function loadSuiteShots(projectId: string): string[] {
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
