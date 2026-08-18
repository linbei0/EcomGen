import { describe, expect, it } from "vitest";

import { COST_UNKNOWN_TEXT, describeCost } from "./cost";

describe("describeCost", () => {
  it.each([
    null,
    undefined,
    {},
    "x",
    0,
    { status: "UNKNOWN" },
    { status: "KNOWN" },
    { status: "KNOWN", amount: "1", currency: "USD" },
    { status: "KNOWN", amount: Number.NaN, currency: "USD" },
    { status: "KNOWN", amount: 1, currency: "" },
  ])("未知或不完整结构一律展示规约文案: %j", (input) => {
    expect(describeCost(input)).toBe(COST_UNKNOWN_TEXT);
  });

  it("仅明确 KNOWN 金额展示数值", () => {
    expect(describeCost({ status: "KNOWN", amount: 1.5, currency: "USD" })).toBe("预计 USD 1.50");
  });
});
