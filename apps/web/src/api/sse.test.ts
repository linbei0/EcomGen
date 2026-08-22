import { describe, expect, it } from "vitest";

import { qk } from "./queryKeys";
import { eventJobId, eventResourceId, invalidateKeysForEvent } from "./sse";

describe("eventJobId", () => {
  it("从 SSE envelope 提取任务 ID，异常数据返回 undefined", () => {
    expect(eventJobId(JSON.stringify({ data: { id: "j1" } }))).toBe("j1");
    expect(eventJobId(JSON.stringify({ data: { id: 42 } }))).toBeUndefined();
    expect(eventJobId("not-json")).toBeUndefined();
    expect(eventResourceId(JSON.stringify({ data: { export: { id: "e1" } } }), "export.updated")).toBe("e1");
    expect(eventResourceId(JSON.stringify({ data: { turn: { id: "t1" } } }), "edit-turn.updated")).toBe("t1");
  });
});

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
    expect(invalidateKeysForEvent("p1", "export.updated", "e1")).toEqual([
      qk.exports("p1"),
      qk.project("p1"),
      qk.export("e1"),
    ]);
    expect(invalidateKeysForEvent("p1", "provider.updated")).toEqual([qk.providers]);
    expect(invalidateKeysForEvent("p1", "mystery.event")).toEqual([]);
  });
});
