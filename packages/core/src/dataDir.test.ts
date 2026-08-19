import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveDataDir } from "./dataDir.js";

describe("resolveDataDir", () => {
  it("resolves relative paths from the shared project root", () => {
    const projectRoot = resolve("E:/project/EcomGen");

    expect(resolveDataDir("./data", projectRoot)).toBe(resolve(projectRoot, "data"));
  });

  it("keeps absolute paths independent of the process working directory", () => {
    const projectRoot = resolve("E:/project/EcomGen");
    const configured = resolve("E:/shared/ecomgen-data");

    expect(resolveDataDir(configured, projectRoot)).toBe(configured);
  });
});
