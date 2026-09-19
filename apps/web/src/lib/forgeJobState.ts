/**
 * 记住最近一次套图反推的 jobId。
 *
 * 反推是全局任务、不绑定项目，结果在服务端持久化，但页面丢失 jobId 后就再也回不到
 * 那一次反推（也没有列表端点兜底）。刷新或跳转一次资产库就丢失一次模型开销，
 * 因此把 jobId 落到本地存储，挂载时恢复。
 */

const KEY = "ecomgen.suiteForge.lastJobId";

export function loadForgeJobId(): string | undefined {
  try {
    const value = localStorage.getItem(KEY);
    return value && value.trim() ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveForgeJobId(jobId: string): void {
  try {
    localStorage.setItem(KEY, jobId);
  } catch {
    // 存储不可用时只是失去跨刷新恢复能力，不应影响本次反推。
  }
}

export function clearForgeJobId(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 同上：清理失败不构成需要打断用户的错误。
  }
}
