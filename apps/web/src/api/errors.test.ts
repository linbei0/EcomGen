import { describe, expect, it } from "vitest";

import { ApiError, API_ERROR_CODES, isApiError, toApiError } from "./errors";

describe("toApiError", () => {
  it("规范化契约错误体", () => {
    const error = toApiError(400, {
      error: { code: "VALIDATION_ERROR", message: "bad", details: [{ field: "name" }], requestId: "r1" },
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("bad");
    expect(error.details).toEqual([{ field: "name" }]);
    expect(error.requestId).toBe("r1");
    expect(error.status).toBe(400);
  });

  it("七种契约 code 全部保留", () => {
    for (const code of API_ERROR_CODES) {
      const error = toApiError(400, { error: { code, message: "m", requestId: "r" } });
      expect(error.code).toBe(code);
    }
  });

  it("契约外 code 归一为 UNKNOWN，但保留消息与请求 ID", () => {
    const error = toApiError(500, { error: { code: "SOMETHING_NEW", message: "oops", requestId: "r2" } });
    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toBe("oops");
    expect(error.requestId).toBe("r2");
  });

  it("非契约响应体降级为 UNKNOWN", () => {
    const error = toApiError(502, "<html>bad gateway</html>");
    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toContain("502");
    expect(error.requestId).toBeUndefined();
  });
});

describe("isApiError", () => {
  it("区分 ApiError 与普通错误", () => {
    expect(isApiError(new ApiError({ code: "UNKNOWN", message: "x", status: 0 }))).toBe(true);
    expect(isApiError(new Error("x"))).toBe(false);
    expect(isApiError(undefined)).toBe(false);
  });
});
