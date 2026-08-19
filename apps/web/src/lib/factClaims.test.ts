import { describe, expect, it } from "vitest";

import { factClaimRows } from "./factClaims";

describe("factClaimRows", () => {
  it("字符串卖点直接展示，对象数组展平为键值", () => {
    expect(factClaimRows(["续航 8 小时"])).toEqual([{ label: "卖点", value: "续航 8 小时" }]);
    expect(factClaimRows([{ claim: "续航 8 小时", empty: "" }, { note: 12 }])).toEqual([
      { label: "claim", value: "续航 8 小时" },
      { label: "note", value: "12" },
    ]);
    expect(factClaimRows(undefined)).toEqual([]);
  });
});
