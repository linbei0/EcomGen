import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { LocalAssetStore } from "./files.js";

describe("LocalAssetStore", () => {
  it("永久删除目标项目的全部本地产物且不影响其他项目", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ecomgen-project-files-"));
    try {
      const store = new LocalAssetStore(directory);
      await store.initialize();
      const asset = await store.putAsset("archived", "product.png", Buffer.from("asset"));
      const output = await store.putOutput("archived", Buffer.from("output"));
      const exported = await store.putExport("archived", Buffer.from("export"));
      const edit = await store.putEditArtifact("archived", "session", "turn", "mask.png", Buffer.from("edit"));
      const retained = await store.putAsset("active", "product.png", Buffer.from("retained"));

      await store.deleteProject("archived");

      await expect(store.exists(asset.path)).resolves.toBe(false);
      await expect(store.exists(output.path)).resolves.toBe(false);
      await expect(store.exists(exported.path)).resolves.toBe(false);
      await expect(store.exists(edit.path)).resolves.toBe(false);
      await expect(store.exists(retained.path)).resolves.toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
