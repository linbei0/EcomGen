import { describe, expect, it } from "vitest";

import { qk } from "./queryKeys";
import { invalidateKeysForEvent } from "./sse";

describe("invalidateKeysForEvent", () => {
  it("六个已知事件映射到精确 key，未知事件不动作", () => {
    expect(invalidateKeysForEvent("p1", "connected")).toEqual([]);
    expect(invalidateKeysForEvent("p1", "job.updated", "j1")).toEqual([
      qk.project("p1"),
      qk.exports("p1"),
      qk.job("j1"),
    ]);
    expect(invalidateKeysForEvent("p1", "storyboard.updated")).toEqual([
      qk.storyboard("p1"),
      qk.project("p1"),
    ]);
    expect(invalidateKeysForEvent("p1", "output.created")).toEqual([
      qk.project("p1"),
      qk.storyboard("p1"),
    ]);
    expect(invalidateKeysForEvent("p1", "export.updated")).toEqual([
      qk.exports("p1"),
      qk.project("p1"),
    ]);
    expect(invalidateKeysForEvent("p1", "provider.updated")).toEqual([qk.providers]);
    expect(invalidateKeysForEvent("p1", "mystery.event")).toEqual([]);
  });
});
