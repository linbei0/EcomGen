import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database.js";
import { EcomRepository, type UserSuiteRecord } from "./repository.js";
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

describe("SuiteCatalog 分页与增量写入", () => {
  async function seeded(): Promise<{ repository: EcomRepository; catalog: SuiteCatalog; close: () => void }> {
    const dataDir = tempDir();
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const catalog = new SuiteCatalog({ dataDir, repository, logger: () => {} });
    await catalog.refresh();
    return { repository, catalog, close: () => database.close() };
  }

  function userSuite(id: string, l1: string): UserSuiteRecord {
    return {
      id,
      name: `增量套图 ${id}`,
      l1,
      l2: "面部护理",
      leaf: `叶子 ${id}`,
      productFamily: null,
      payload: { ...document, id, category: { ...document.category, l1, leaf: `叶子 ${id}` } },
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    };
  }

  it("按游标翻页恰好覆盖全部套图，顺序与全量一致且不重复", async () => {
    const { catalog, close } = await seeded();
    const expected = catalog.listSuites().map((suite) => suite.id);
    expect(expected.length).toBeGreaterThanOrEqual(3);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = catalog.pageSummaries({ limit: 1, cursor });
      expect(page.total).toBe(expected.length);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      expect(seen.length).toBeLessThanOrEqual(expected.length);
    } while (cursor);

    expect(seen).toEqual(expected);
    close();
  });

  it("q/l1/l2 只影响返回项，total 与 l1Counts 始终是全库统计", async () => {
    const { catalog, close } = await seeded();
    const all = catalog.listSuites();
    const target = all[0];
    const fullCounts = catalog.pageSummaries().l1Counts;

    const byL1 = catalog.pageSummaries({ l1: target.category.l1 });
    expect(byL1.items.length).toBeGreaterThan(0);
    expect(byL1.items.every((item) => item.category.l1 === target.category.l1)).toBe(true);
    expect(byL1.items.length).toBe(fullCounts[target.category.l1]);
    expect(byL1.total).toBe(all.length);
    expect(byL1.l1Counts).toEqual(fullCounts);

    // 搜索的大小写与字段范围必须和原前端客户端过滤一致：名称、叶子、l2、l1、描述拼接后小写包含。
    const byName = catalog.pageSummaries({ q: target.name.toUpperCase() });
    expect(byName.items.map((item) => item.id)).toContain(target.id);
    expect(byName.total).toBe(all.length);

    const none = catalog.pageSummaries({ q: "不存在的套图关键字" });
    expect(none.items).toEqual([]);
    expect(none.nextCursor).toBeNull();
    expect(none.total).toBe(all.length);
    expect(none.l1Counts).toEqual(fullCounts);
    close();
  });

  it("ids 精确回读绕过分页，未知 ID 被忽略且游标为 null", async () => {
    const { catalog, close } = await seeded();
    const all = catalog.listSuites();
    const picked = [all[1], all[0]];

    const page = catalog.pageSummaries({ ids: [...picked.map((suite) => suite.id), "suite-does-not-exist"], limit: 1 });
    expect(page.items.map((item) => item.id)).toEqual([all[0].id, all[1].id]);
    expect(page.nextCursor).toBeNull();
    expect(page.total).toBe(all.length);
    close();
  });

  it("upsertUserSuite/removeUserSuite 无需 refresh 即反映到列表", async () => {
    const { catalog, close } = await seeded();
    const before = catalog.pageSummaries();

    catalog.upsertUserSuite(userSuite("custom-suite-inc1", before.items[0].category.l1));
    // 内置套图数量远超单页，改用唯一名称搜索验证增量写入立即可见，不依赖首页位置。
    const afterInsert = catalog.pageSummaries({ q: "custom-suite-inc1" });
    expect(afterInsert.items.some((item) => item.id === "custom-suite-inc1")).toBe(true);
    expect(afterInsert.total).toBe(before.total + 1);
    expect(catalog.resolveShot("custom-suite-inc1::shot-1")?.shot.displayName).toBe("主图");

    expect(catalog.removeUserSuite("custom-suite-inc1")).toBe(true);
    expect(catalog.pageSummaries().total).toBe(before.total);
    expect(catalog.getSuite("custom-suite-inc1")).toBeUndefined();
    // 内置套图不落库，不允许通过增量删除移除。
    expect(catalog.removeUserSuite(before.items[0].id)).toBe(false);
    expect(catalog.pageSummaries().total).toBe(before.total);
    close();
  });

  it("游标指向的套图已被删除时按已到底处理，不重复返回也不死循环", async () => {
    const { catalog, close } = await seeded();
    const l1 = "增量测试品类";
    catalog.upsertUserSuite(userSuite("custom-suite-inc2", l1));
    catalog.upsertUserSuite(userSuite("custom-suite-inc3", l1));

    const first = catalog.pageSummaries({ l1, limit: 1 });
    expect(first.items).toHaveLength(1);
    const cursor = first.nextCursor;
    expect(cursor).not.toBeNull();

    expect(catalog.removeUserSuite(first.items[0].id)).toBe(true);
    const afterDelete = catalog.pageSummaries({ l1, limit: 1, cursor });
    expect(afterDelete.items).toEqual([]);
    expect(afterDelete.nextCursor).toBeNull();
    close();
  });
});
