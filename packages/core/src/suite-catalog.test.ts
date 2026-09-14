import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database.js";
import { EcomRepository } from "./repository.js";
import { SuiteCatalog } from "./suite-catalog.js";

const document = {
  name: "目录套图",
  category: { l1: "护肤个护", l2: "面部护理", leaf: "目录洁面乳" },
  styleLock: { lockText: "柔光白底，暖米色台面，左上主光" },
  shots: [{ shotId: "shot-1", order: 1, shotRole: "HERO" as const, displayName: "主图", promptTemplate: "hero {product}" }]
};

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ecomgen-suites-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("SuiteCatalog", () => {
  it("merges built-ins, database suites and drop-in directory files while skipping invalid or duplicate entries", async () => {
    const dataDir = tempDir();
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const skipped: string[] = [];
    const catalog = new SuiteCatalog({ dataDir, repository, logger: (message) => skipped.push(message) });

    await catalog.refresh();
    const builtinCount = catalog.listSuites().length;
    expect(builtinCount).toBeGreaterThanOrEqual(3);

    repository.saveUserSuite({
      id: "custom-suite-abc12345",
      name: "用户套图",
      l1: "护肤个护",
      l2: "面部护理",
      leaf: "用户洁面乳",
      productFamily: "beauty",
      payload: { ...document, id: "custom-suite-abc12345" }
    });

    const suitesDir = join(dataDir, "suites");
    mkdirSync(suitesDir, { recursive: true });
    writeFileSync(join(suitesDir, "dir.suite.json"), JSON.stringify({ ...document, id: "dir-suite-1" }));
    writeFileSync(join(suitesDir, "dup.suite.json"), JSON.stringify({ ...document, id: "suite-hufugehu-jiemianru" }));
    writeFileSync(join(suitesDir, "broken.suite.json"), "{ not valid json");

    await catalog.refresh();

    expect(catalog.getSuite("custom-suite-abc12345")?.origin).toBe("user");
    expect(catalog.getSuite("dir-suite-1")?.origin).toBe("user");
    expect(catalog.listSuites().length).toBe(builtinCount + 2);
    expect(catalog.resolveShot("dir-suite-1::shot-1")?.shot.shotRole).toBe("HERO");
    expect(catalog.resolveShot("hero-image")).toBeUndefined();
    expect(skipped.some((message) => message.includes("dup.suite.json"))).toBe(true);
    expect(skipped.some((message) => message.includes("broken.suite.json"))).toBe(true);

    database.close();
  });
});
