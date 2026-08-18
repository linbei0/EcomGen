/**
 * 后端健康检查挂在服务器根路径 /health（app.ts），不在 /api/v1 前缀下。
 * 相对 base 不能喂给 new URL（浏览器抛错），直接返回同源 /health 由 Vite 代理转发。
 */
export function healthUrl(apiBaseUrl: string): string {
  if (/^https?:\/\//i.test(apiBaseUrl)) return new URL("/health", apiBaseUrl).href;
  return "/health";
}
