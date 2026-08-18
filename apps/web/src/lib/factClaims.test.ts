import { describe, expect, it } from "vitest";

import { factClaimRows, scopeLabel } from "./factClaims";

describe("factClaimRows", () => {
  it("把对象数组展平为键值，忽略空值", () => {
    expect(factClaimRows([{ claim: "续航 8 小时", empty: "" }, { note: 12 }])).toEqual([
      { label: "claim", value: "续航 8 小时" },
      { label: "note", value: "12" },
    ]);
    expect(factClaimRows(undefined)).toEqual([]);
  });
});

describe("scopeLabel", () => {
  it("COMMON 为通用，其余查变体名", () => {
    expect(scopeLabel("COMMON", [])).toBe("通用");
    expect(scopeLabel("v1", [{ id: "v1", name: "黑色" }])).toBe("黑色");
    expect(scopeLabel("missing", [])).toBe("指定变体");
  });
});
