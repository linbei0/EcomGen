// 默认同源相对路径：生产由 API 托管静态文件（web-static.ts），本地开发走 Vite 代理。
// 前后端分开部署时，需在构建期设置 VITE_API_BASE_URL 指向 API 地址（构建后不可变）。
const DEFAULT_API_BASE_URL = "/api/v1";

/** 前端唯一的服务端入口；浏览器不得直连 Redis/SQLite/Provider。 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ??
  DEFAULT_API_BASE_URL;
