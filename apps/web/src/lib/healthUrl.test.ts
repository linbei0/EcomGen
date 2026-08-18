import { describe, expect, it } from "vitest";

import { healthUrl } from "./healthUrl";

describe("healthUrl", () => {
  it("绝对 base 取其 origin 下的 /health", () => {
    expect(healthUrl("http://127.0.0.1:8787/api/v1")).toBe("http://127.0.0.1:8787/health");
    expect(healthUrl("http://localhost:8787/api/v1")).toBe("http://localhost:8787/health");
  });

  it("相对 base 返回同源 /health（走 Vite 代理）", () => {
    expect(healthUrl("/api/v1")).toBe("/health");
  });
});
