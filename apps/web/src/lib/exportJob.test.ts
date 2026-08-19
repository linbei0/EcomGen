import { describe, expect, it } from "vitest";

import { exportableOutputs } from "./exportJob";

describe("exportableOutputs", () => {
  it("只保留 SELECTED 的输出 ID", () => {
    expect(
      exportableOutputs([
        { id: "o1", reviewDecision: "SELECTED" },
        { id: "o2", reviewDecision: "REJECTED" },
        { id: "o3", reviewDecision: "NEEDS_REVIEW" },
        { id: "o4", reviewDecision: "SELECTED" },
      ]),
    ).toEqual(["o1", "o4"]);
  });
});
