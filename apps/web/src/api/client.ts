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

/**
 * 成功响应按契约必有 body；204/205 的空 body 是删除类端点的正常语义，其余缺失说明契约漂移，显式失败而非静默 undefined。
 * 同时接受已 resolve 的结果对象：调用方需要在同一个结果上读 response.status（如区分「复用既有任务」与「新建任务」）时不必再包一层 Promise。
 */
export async function unwrap<T>(result: Promise<{ data?: T; error?: unknown; response: Response }> | { data?: T; error?: unknown; response: Response }): Promise<T> {
  const { data, response } = await result;
  if (data === undefined) {
    if (response.status !== 204 && response.status !== 205) {
      throw new ApiError({ code: "UNKNOWN", message: "响应缺少数据", status: response.status });
    }
    // 204/205 无 body 属正常删除语义，调用方以 void 消费返回值。
    return undefined as T;
  }
  return data;
}
