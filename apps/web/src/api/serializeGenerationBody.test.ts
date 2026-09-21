import { describe, expect, it } from "vitest";

import { serializeGenerationBody } from "./serializeGenerationBody";

describe("serializeGenerationBody", () => {
  it("排序 storyboardItemIds，乱序输入得到同一 body", () => {
    const a = serializeGenerationBody({ storyboardItemIds: ["b", "a"] });
    const c = serializeGenerationBody({ storyboardItemIds: ["a", "b"] });
    expect(JSON.parse(a)).toEqual({ storyboardItemIds: ["a", "b"] });
    expect(a).toBe(c);
  });

  it("不同 revision 得到不同 body；空 revision 不写入", () => {
    const withRev = JSON.parse(serializeGenerationBody({ storyboardItemIds: ["a"], revision: "再试" }));
    const empty = JSON.parse(serializeGenerationBody({ storyboardItemIds: ["a"], revision: "  " }));
    expect(withRev.revision).toBe("再试");
    expect(empty.revision).toBeUndefined();
  });
});
