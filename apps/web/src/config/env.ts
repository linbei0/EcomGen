const DEFAULT_API_BASE_URL = "http://127.0.0.1:8787/api/v1";

/** 前端唯一的服务端入口；浏览器不得直连 Redis/SQLite/Provider。 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ??
  DEFAULT_API_BASE_URL;
