const KEY = "ecomgen.workspace.sidebarCollapsed";

export function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    /* 隐私模式或配额：仅本次会话内生效 */
  }
}
