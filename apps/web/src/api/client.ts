import createClient, { type Middleware } from "openapi-fetch";

import { API_BASE_URL } from "../config/env";
import { ApiError, toApiError } from "./errors";
import type { paths } from "./schema.d.ts";

/** 非 2xx 一律规范化为 ApiError 抛出，hooks 层不再处理 { data, error } 双返回。 */
const errorMiddleware: Middleware = {
  async onResponse({ response }) {
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.clone().json();
      } catch {
        body = undefined;
      }
      throw toApiError(response.status, body);
    }
    return response;
  },
};

/**
 * 每次请求时再取 globalThis.fetch。openapi-fetch 默认在 createClient 时捕获 fetch，
 * 测试里 msw 的 listen 发生在模块求值之后，绑死的引用会绕过拦截打到真实网络。
 */
export const api = createClient<paths>({
  baseUrl: API_BASE_URL,
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});
api.use(errorMiddleware);

/** 成功响应按契约必有 body；缺失说明契约漂移，显式失败而非静默 undefined。 */
export async function unwrap<T>(promise: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data } = await promise;
  if (data === undefined) {
    throw new ApiError({ code: "UNKNOWN", message: "响应缺少数据", status: 0 });
  }
  return data;
}
