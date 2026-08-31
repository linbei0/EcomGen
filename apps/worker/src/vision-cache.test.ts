import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VisionDerivativeCache } from "./vision-cache.js";

describe("VisionDerivativeCache", () => {
  it("reuses a derivative for the same source and parameters", async () => {
    const root = await mkdtemp(join(tmpdir(), "ecomgen-vision-cache-"));
    try {
      const cache = new VisionDerivativeCache(root);
      await cache.initialize();
      let creates = 0;
      const create = async () => { creates += 1; return { data: Buffer.from("derived"), mimeType: "image/jpeg" }; };
      const key = { sourceHash: "source", maxEdge: 1024, jpegQuality: 80, mimeType: "image/jpeg" };
      await expect(cache.getOrCreate(key, create)).resolves.toEqual({ data: Buffer.from("derived"), mimeType: "image/jpeg" });
      await cache.getOrCreate(key, create);
      expect(creates).toBe(1);

      const second = new VisionDerivativeCache(root);
      await second.initialize();
      await expect(second.getOrCreate(key, create)).resolves.toEqual({ data: Buffer.from("derived"), mimeType: "image/jpeg" });
      expect(creates).toBe(1);
      const files = await (await import("node:fs/promises")).readdir(join(root, "vision-cache"));
      expect(files).toHaveLength(1);
      expect(await readFile(join(root, "vision-cache", files[0]!))).toEqual(Buffer.from("derived"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not reuse a derivative when compression parameters change", async () => {
    const root = await mkdtemp(join(tmpdir(), "ecomgen-vision-cache-"));
    try {
      const cache = new VisionDerivativeCache(root);
      await cache.initialize();
      let creates = 0;
      const create = async () => { creates += 1; return { data: Buffer.from(String(creates)), mimeType: "image/jpeg" }; };
      await cache.getOrCreate({ sourceHash: "source", maxEdge: 1024, jpegQuality: 80, mimeType: "image/jpeg" }, create);
      await cache.getOrCreate({ sourceHash: "source", maxEdge: 768, jpegQuality: 80, mimeType: "image/jpeg" }, create);
      expect(creates).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
