/**
 * 付费请求的中断信号组合。
 *
 * 所有对 Provider 的调用都同时受两个条件约束：本次请求自己的超时，以及调用方（Worker 任务）
 * 的取消。取消必须真正断开在途 HTTP，只标记状态而不中断连接会让调用方继续等待上游返回，
 * 期间该次生成照常计费，用户也拿不到及时反馈。
 */

/** 合并调用方取消信号与本次请求超时：任一触发都会中断请求，reason 保留先触发者的原因。 */
export function requestSignal(cancel: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return cancel ? AbortSignal.any([cancel, timeout]) : timeout;
}
