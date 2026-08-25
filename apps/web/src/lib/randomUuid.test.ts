import { afterEach, describe, expect, it, vi } from "vitest";

import { randomUuid } from "./randomUuid";

describe("randomUuid", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses getRandomValues when randomUUID is unavailable on HTTP", () => {
    vi.stubGlobal("crypto", {
      getRandomValues<T extends ArrayBufferView>(bytes: T): T {
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).fill(0);
        return bytes;
      },
    });

    expect(randomUuid()).toBe("00000000-0000-4000-8000-000000000000");
  });
});
