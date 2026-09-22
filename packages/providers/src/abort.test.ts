import { describe, expect, it, vi } from "vitest";

import { requestSignal } from "./abort.js";

describe("付费请求的中断信号", () => {
  it("调用方取消会中断请求，并保留原始取消原因", async () => {
    const controller = new AbortController();
    const signal = requestSignal(controller.signal, 60_000);
    const reason = new Error("cancelled-by-user");
    controller.abort(reason);
    expect(signal.aborted).toBe(true);
    // 保留原因使 fetch 抛出的正是调用方的取消错误，Worker 据此落入 CANCELLED 而非失败。
    expect(signal.reason).toBe(reason);
  });

  it("调用方未取消时按超时中断", async () => {
    // AbortSignal.timeout 使用原生定时器，不受 vi.useFakeTimers 控制，只能等真实时间。
    const signal = requestSignal(new AbortController().signal, 30);
    expect(signal.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).name).toBe("TimeoutError");
  });

  it("没有调用方信号时只保留超时", () => {
    const signal = requestSignal(undefined, 60_000);
    expect(signal.aborted).toBe(false);
  });
});
