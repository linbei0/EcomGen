import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { openDatabase } from "./database.js";
import { EcomRepository, EXTERNAL_REQUEST_STARTED } from "./repository.js";
import type { SuiteDocumentInput } from "@ecomgen/ecom-suite";
import { MODEL_SPEC_DEFAULTS, type ModelSpec } from "@ecomgen/contracts";

function seedProvider(repository: EcomRepository) {
  return repository.saveProvider({
    name: "test",
    baseUrl: "https://example.test/v1",
    encryptedApiKey: "encrypted",
    reasoningProtocol: "openai",
    models: [
      { id: "reasoner", supportsVision: true, supportsThinking: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null },
      { id: "image", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: "openai_images" }
    ]
  });
}

type ProviderRecord = ReturnType<EcomRepository["saveProvider"]>;
type ProjectInput = Parameters<EcomRepository["createProject"]>[0];
type StoryboardItemInput = Parameters<EcomRepository["saveStoryboard"]>[3][number];

/** 项目字段默认值：用例只覆盖与自身规则相关的差异。 */
function makeProjectInput(provider: ProviderRecord, overrides: Partial<ProjectInput> = {}): ProjectInput {
  return {
    name: "cup",
    category: null,
    productDescription: null,
    verifiedFacts: [],
    prohibitedClaims: [],
    brandGuidelines: {},
    platformTargets: ["TAOBAO"],
    targetMarket: null,
    copyLanguage: null,
    reasoningProviderId: provider.id,
    reasoningModelId: "reasoner",
    imageProviderId: provider.id,
    imageModelId: "image",
    defaultMode: "CREATIVE",
    imageResolution: "1K",
    imageAspectRatio: "AUTO",
    candidatesPerType: 1,
    ...overrides,
  };
}

/** 分镜条目默认值：仅覆盖与用例规则相关的字段。 */
function storyboardItem(overrides: Partial<StoryboardItemInput> = {}): StoryboardItemInput {
  return {
    assetType: "hero-image",
    displayName: "杯子首图",
    shotRole: null,
    templateVariant: null,
    candidateCount: 1,
    referencedAssets: [],
    mode: "CREATIVE",
    status: "DRAFT",
    promptInstruction: "hero",
    compiledPrompt: null,
    factClaims: [],
    riskFlags: [],
    sortOrder: 0,
    ...overrides,
  };
}

describe("EcomRepository", () => {
  it("用户自定义模板 CRUD 往返，upsert 保留 createdAt，删除不阻断", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const created = repository.saveUserTemplate({ id: "custom-ab12cd34", name: "我的模板", prompt: "packshot of {product_description}", defaultSize: "1024x1024", supportsImageReference: true });
    expect(repository.getUserTemplate("custom-ab12cd34")).toEqual(created);
    const updated = repository.saveUserTemplate({ id: "custom-ab12cd34", name: "改名", prompt: "updated prompt", defaultSize: "1024x1536", supportsImageReference: false });
    expect(updated.createdAt).toBe(created.createdAt);
    expect(repository.getUserTemplate("custom-ab12cd34")).toMatchObject({ name: "改名", prompt: "updated prompt", defaultSize: "1024x1536", supportsImageReference: false });
    const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider));
    repository.saveStoryboard(project.id, "", "DRAFT", [storyboardItem({ assetType: "custom-ab12cd34", displayName: "自定义项", promptInstruction: "cup", imageProviderId: provider.id, imageModelId: "image" })]);
    // 模板被分镜引用时仍可删除；旧分镜的生成失败由 worker 模板解析显式报错
    expect(repository.deleteUserTemplate("custom-ab12cd34")).toBe(true);
    expect(repository.deleteUserTemplate("custom-ab12cd34")).toBe(false);
    database.close();
  });
  it("删除 Provider 时级联置空项目引用，项目进入待重新选择状态", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider));
    repository.saveStoryboard(project.id, "", "CONFIRMED", [storyboardItem({ displayName: "主图", status: "CONFIRMED", promptInstruction: "cup", imageProviderId: provider.id, imageModelId: "image" })]);
    const item = repository.listStoryboardItems(project.id)[0]!;
    const queuedJob = repository.createJob({ id: "provider-delete-job", projectId: project.id, storyboardItemId: item.id, type: "GENERATE", input: {}, providerId: provider.id, modelId: "image" });
    expect(repository.deleteProvider(provider.id)).toBe("deleted");
    const after = repository.getProject(project.id);
    expect(after).toMatchObject({ reasoningProviderId: null, reasoningModelId: null, imageProviderId: null, imageModelId: null });
    expect(repository.getStoryboardItem(item.id)).toMatchObject({ imageProviderId: null, imageModelId: null });
    expect(repository.getJob(queuedJob.id)).toMatchObject({ status: "CANCELLED", retryable: false, cancelRequested: true });
    // 置空后可以立刻重建同名 Provider，不受残留引用阻挡
    const recreated = seedProvider(repository);
    expect(repository.deleteProvider(recreated.id)).toBe("deleted");
    expect(repository.deleteProvider("missing-id")).toBe("missing");
    database.close();
  });
  it("保留每个项目最近 20 份规划配置，并按 source job 去重", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider));
    const payload = { project: { ...project }, planning: { planningMode: "AI" as const, requestedTypes: [], targetImageCount: 6, userInstruction: null } };
    for (let index = 0; index < 21; index += 1) {
      const job = repository.createJob({ id: `plan-${index}`, projectId: project.id, storyboardItemId: null, type: "PLAN", input: {} });
      repository.createPlanningConfigSnapshot({ projectId: project.id, sourceJobId: job.id, payload });
    }
    const snapshots = repository.listPlanningConfigSnapshots(project.id);
    expect(snapshots).toHaveLength(20);
    expect(snapshots.some((snapshot) => snapshot.sourceJobId === "plan-0")).toBe(false);
    const existing = repository.createPlanningConfigSnapshot({ projectId: project.id, sourceJobId: "plan-20", payload });
    expect(existing.sourceJobId).toBe("plan-20");
    expect(repository.listPlanningConfigSnapshots(project.id)).toHaveLength(20);
    database.close();
  });
  it("listLibraryItems 合并上传与生成、按 hash 去重、支持类型/搜索/游标分页", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const projectA = repository.createProject(makeProjectInput(provider, { name: "Alpha 店铺" }));
    const projectB = repository.createProject(makeProjectInput(provider, { name: "Beta 店铺" }));
    const storagePath = "assets/source.png";
    const oldDuplicate = repository.createAsset({ projectId: projectA.id, role: "PRODUCT_TRUTH", storagePath, hash: "dup", originalName: "old.png", mimeType: "image/png", width: null, height: null });
    const newDuplicate = repository.createAsset({ projectId: projectB.id, role: "PRODUCT_TRUTH", storagePath, hash: "dup", originalName: "new.png", mimeType: "image/png", width: null, height: null });
    const unique = repository.createAsset({ projectId: projectB.id, role: "STYLE_REFERENCE", storagePath, hash: "unique", originalName: "unique.png", mimeType: "image/png", width: null, height: null });
    repository.saveStoryboard(projectA.id, "lock", "DRAFT", [storyboardItem()]);
    const item = repository.listStoryboardItems(projectA.id)[0]!;
    const job = repository.createJob({ id: "library-gen-job", projectId: projectA.id, storyboardItemId: item.id, type: "GENERATE", input: {} });
    const generated = repository.createOutput({ projectId: projectA.id, storyboardItemId: item.id, jobId: job.id, candidateIndex: 1, generationSnapshot: null, storagePath: "outputs/gen.png", hash: "gen", width: 1024, height: 1024 });
    database.prepare("UPDATE assets SET created_at=? WHERE id=?").run("2026-01-01T00:00:00.000Z", oldDuplicate.id);
    database.prepare("UPDATE assets SET created_at=? WHERE id=?").run("2026-02-01T00:00:00.000Z", newDuplicate.id);
    database.prepare("UPDATE assets SET created_at=? WHERE id=?").run("2026-03-01T00:00:00.000Z", unique.id);
    database.prepare("UPDATE outputs SET created_at=? WHERE id=?").run("2026-04-01T00:00:00.000Z", generated.id);

    const all = repository.listLibraryItems({});
    expect(all.items.map((entry) => entry.hash)).toEqual(["gen", "unique", "dup"]);
    expect(all.total).toBe(3);
    expect(all.items.find((entry) => entry.hash === "dup")?.id).toBe(`asset:${newDuplicate.id}`);
    expect(all.items.find((entry) => entry.hash === "gen")).toMatchObject({ source: "GENERATED", kind: "GENERATED", width: 1024, name: "杯子首图", projectName: "Alpha 店铺" });

    expect(repository.listLibraryItems({ kind: "GENERATED" }).items.map((entry) => entry.hash)).toEqual(["gen"]);
    expect(repository.listLibraryItems({ kind: "PRODUCT" }).items.map((entry) => entry.hash)).toEqual(["dup"]);
    expect(repository.listLibraryItems({ kind: "REFERENCE" }).items.map((entry) => entry.hash)).toEqual(["unique"]);
    expect(repository.listLibraryItems({ q: "Alpha" }).items.map((entry) => entry.hash)).toEqual(["gen"]);

    const firstPage = repository.listLibraryItems({ limit: 2 });
    expect(firstPage.items.map((entry) => entry.hash)).toEqual(["gen", "unique"]);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(firstPage.total).toBe(3);
    const secondPage = repository.listLibraryItems({ limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.items.map((entry) => entry.hash)).toEqual(["dup"]);
    expect(secondPage.nextCursor).toBeNull();

    const assetSource = repository.resolveLibrarySource(`asset:${newDuplicate.id}`);
    expect(assetSource).toMatchObject({ source: "UPLOADED", hash: "dup", role: "PRODUCT_TRUTH" });
    const outputSource = repository.resolveLibrarySource(`output:${generated.id}`);
    expect(outputSource).toMatchObject({ source: "GENERATED", storagePath: "outputs/gen.png", mimeType: "image/png" });
    expect(repository.resolveLibrarySource("asset:missing")).toBeUndefined();
    database.close();
  });
  it("listLibraryItems 纳入分层导出的元素/背景切图，排除 PSD 复合层", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider, { name: "分层店铺" }));
    repository.saveStoryboard(project.id, "lock", "DRAFT", [storyboardItem()]);
    const item = repository.listStoryboardItems(project.id)[0]!;
    const generateJob = repository.createJob({ id: "layer-gen-job", projectId: project.id, storyboardItemId: item.id, type: "GENERATE", input: {} });
    const output = repository.createOutput({ projectId: project.id, storyboardItemId: item.id, jobId: generateJob.id, candidateIndex: 1, generationSnapshot: null, storagePath: "outputs/hero.png", hash: "hero-output", width: 1024, height: 1024 });
    const exportJob = repository.createJob({ id: "layer-export-job", projectId: project.id, storyboardItemId: item.id, type: "LAYER_EXPORT", input: {} });
    const layerExport = repository.createLayerExport({
      projectId: project.id,
      outputId: output.id,
      jobId: exportJob.id,
      planId: null,
      status: "SUCCEEDED",
      includeBackground: true,
      psdStoragePath: "layers/x/composite.psd",
      layerFiles: [
        { name: "01_瓶子.png", kind: "element", storagePath: "layers/x/01.png", hash: "layer-bottle" },
        { name: "00_背景.png", kind: "background", storagePath: "layers/x/00.png", hash: "layer-bg" },
        { name: "图层.psd", kind: "composite", storagePath: "layers/x/composite.psd", hash: "layer-psd" },
      ],
      error: null,
    });
    database.prepare("UPDATE layer_exports SET created_at=? WHERE id=?").run("2026-05-01T00:00:00.000Z", layerExport.id);

    expect(repository.listLibraryItems({ kind: "GENERATED" }).items.map((entry) => entry.hash)).toEqual(["hero-output"]);
    const layers = repository.listLibraryItems({ kind: "LAYER" });
    expect(layers.items.map((entry) => entry.hash)).toEqual(["layer-bg", "layer-bottle"]);
    const bottle = layers.items.find((entry) => entry.hash === "layer-bottle")!;
    expect(bottle).toMatchObject({ id: `layer:${layerExport.id}:0`, source: "GENERATED", kind: "LAYER", name: "杯子首图 · 01_瓶子.png", width: 1024, height: 1024 });
    expect(layers.items.some((entry) => entry.hash === "layer-psd")).toBe(false);

    expect(repository.resolveLibrarySource(`layer:${layerExport.id}:0`)).toMatchObject({ source: "GENERATED", storagePath: "layers/x/01.png", hash: "layer-bottle", originalName: "01_瓶子.png" });
    expect(repository.resolveLibrarySource(`layer:${layerExport.id}:2`)).toBeUndefined();
    expect(repository.findLibrarySourcePath("layer-bottle")).toBe("layers/x/01.png");
    database.close();
  });
  it("恢复任务时不自动重试结果未知的外部图像请求", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider));
    const safe = repository.createJob({ id: "recover-safe", projectId: project.id, storyboardItemId: null, type: "PLAN", input: {} });
    const uncertain = repository.createJob({ id: "recover-uncertain", projectId: project.id, storyboardItemId: null, type: "GENERATE", input: {} });
    database.prepare("UPDATE jobs SET status='RUNNING' WHERE id IN (?, ?)").run(safe.id, uncertain.id);
    database.prepare("UPDATE jobs SET provider_task_id=? WHERE id=?").run(EXTERNAL_REQUEST_STARTED, uncertain.id);
    expect(repository.recoverInterruptedJobs().map((job) => job.id)).toEqual([safe.id]);
    expect(repository.getJob(safe.id)?.status).toBe("QUEUED");
    expect(repository.getJob(uncertain.id)).toMatchObject({ status: "FAILED", retryable: false, error: { message: "外部图像请求结果未知，已停止自动重试以避免重复计费" } });
    database.close();
  });

  it("全局套图反推任务不绑定项目，指纹按 NULL 隔离且草稿可入库", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const forgeJob = repository.createJob({ id: "forge-1", projectId: null, storyboardItemId: null, type: "SUITE_FORGE", input: { providerId: "p", modelId: "m" }, requestFingerprint: "forge-fp" });
    expect(forgeJob.projectId).toBeNull();

    // 崩溃恢复必须覆盖无项目归属的运行中任务
    database.prepare("UPDATE jobs SET status='RUNNING' WHERE id=?").run(forgeJob.id);
    expect(repository.recoverInterruptedJobs().map((job) => job.id)).toEqual([forgeJob.id]);
    expect(repository.getJob(forgeJob.id)?.status).toBe("QUEUED");

    const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider));
    // 指纹含 NULL 项目：全局任务与项目任务互不串号
    expect(repository.findJobByFingerprint(null, "forge-fp")?.id).toBe("forge-1");
    repository.createJob({ id: "project-job", projectId: project.id, storyboardItemId: null, type: "PLAN", input: {}, requestFingerprint: "forge-fp" });
    expect(repository.findJobByFingerprint(project.id, "forge-fp")?.id).toBe("project-job");
    expect(repository.findJobByFingerprint(null, "forge-fp")?.id).toBe("forge-1");

    const payload = {
      name: "示例套图",
      category: { l1: "美妆", l2: "面部护理", leaf: "洁面乳" },
      styleLock: { lockText: "warm beige studio" },
      shots: [{ shotId: "hero", order: 1, shotRole: "HERO", displayName: "主图", promptTemplate: "hero {product}" }],
    } satisfies SuiteDocumentInput;
    expect(repository.saveSuiteForgeResult({ jobId: forgeJob.id, payload })).toMatchObject({ status: "DRAFT", suiteId: null });
    // upsert 不产生重复草稿
    expect(repository.saveSuiteForgeResult({ jobId: forgeJob.id, payload }).jobId).toBe(forgeJob.id);
    expect(repository.commitSuiteForgeResult(forgeJob.id, "custom-suite-ab12cd34")).toMatchObject({ status: "COMMITTED", suiteId: "custom-suite-ab12cd34" });
    expect(repository.getSuiteForgeResult(forgeJob.id)?.suiteId).toBe("custom-suite-ab12cd34");
    // 全局任务不进入任何项目的任务列表
    expect(repository.listJobs(project.id).map((job) => job.id)).toEqual(["project-job"]);
    database.close();
  });

  it("按归档状态隔离项目并支持恢复", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const input = makeProjectInput(provider);
    const project = repository.createProject(input);
    expect(project.archivedAt).toBeNull();
    expect(repository.listProjects()).toHaveLength(1);
    repository.updateProject(project.id, { archivedAt: "2026-08-01T01:00:00.000Z" });
    expect(repository.listProjects()).toHaveLength(0);
    expect(repository.listProjects(true).map((item) => item.id)).toEqual([project.id]);
    repository.updateProject(project.id, { archivedAt: null });
    expect(repository.listProjects().map((item) => item.id)).toEqual([project.id]);
    database.close();
  });

  it("只允许永久删除已归档项目", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider));
    expect(repository.deleteArchivedProject(project.id)).toBe("not_archived");
    repository.updateProject(project.id, { archivedAt: "2026-08-01T01:00:00.000Z" });
    expect(repository.deleteArchivedProject(project.id)).toBe("deleted");
    expect(repository.getProject(project.id)).toBeUndefined();
    expect(repository.deleteArchivedProject(project.id)).toBe("missing");
    database.close();
  });

  it("migrates existing projects with empty market and copy language while preserving platform selection", () => {
    const directory = mkdtempSync(join(tmpdir(), "ecomgen-migration-"));
    const filename = join(directory, "ecomgen.db");
    try {
      const database = openDatabase(filename);
      database.exec("DROP TABLE projects");
      database.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT,
          product_description TEXT,
          verified_facts_json TEXT NOT NULL DEFAULT '[]',
          prohibited_claims_json TEXT NOT NULL DEFAULT '[]',
          brand_guidelines_json TEXT NOT NULL DEFAULT '{}',
          platform_targets_json TEXT NOT NULL,
          reasoning_provider_id TEXT NOT NULL,
          reasoning_model_id TEXT NOT NULL,
          image_provider_id TEXT NOT NULL,
          image_model_id TEXT NOT NULL,
          default_mode TEXT NOT NULL,
          image_resolution TEXT NOT NULL DEFAULT '1K',
          image_aspect_ratio TEXT NOT NULL DEFAULT 'AUTO',
          candidates_per_type INTEGER NOT NULL DEFAULT 1,
          web_research_enabled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO projects VALUES (
          'legacy-project', 'legacy', NULL, NULL, '[]', '[]', '{}', '["TAOBAO"]',
          'reasoning', 'reasoner', 'image', 'image-model', 'CREATIVE', '1K', 'AUTO', 1, 0,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
      `);
      database.close();

      const migrated = openDatabase(filename);
      const project = new EcomRepository(migrated).getProject("legacy-project");
      expect(project).toMatchObject({ platformTargets: ["TAOBAO"], targetMarket: null, copyLanguage: null });
      migrated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("removes legacy output review columns without losing output lineage", () => {
    const directory = mkdtempSync(join(tmpdir(), "ecomgen-output-migration-"));
    const filename = join(directory, "ecomgen.db");
    try {
      const legacy = new Database(filename);
      legacy.exec(`
        CREATE TABLE outputs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          storyboard_item_id TEXT NOT NULL,
          job_id TEXT NOT NULL,
          candidate_index INTEGER NOT NULL,
          generation_snapshot_json TEXT,
          storage_path TEXT NOT NULL,
          hash TEXT NOT NULL,
          review_decision TEXT NOT NULL,
          review_note TEXT,
          created_at TEXT NOT NULL,
          parent_output_id TEXT,
          root_output_id TEXT,
          edit_session_id TEXT,
          edit_turn_id TEXT
        );
        INSERT INTO outputs VALUES ('root','p','item','job',1,NULL,'root.png','hash','NEEDS_REVIEW',NULL,'2026-01-01T00:00:00.000Z',NULL,NULL,NULL,NULL);
      `);
      legacy.close();
      const migrated = openDatabase(filename);
      expect(migrated.prepare("PRAGMA table_info(outputs)").all()).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "review_decision" })]));
      expect(migrated.prepare("SELECT id, parent_output_id FROM outputs").get()).toEqual({ id: "root", parent_output_id: null });
      migrated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("adds generation keys before creating their indexes on legacy outputs", () => {
    const directory = mkdtempSync(join(tmpdir(), "ecomgen-generation-key-migration-"));
    const filename = join(directory, "ecomgen.db");
    try {
      const legacy = new Database(filename);
      legacy.exec(`
        CREATE TABLE outputs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          storyboard_item_id TEXT NOT NULL,
          job_id TEXT NOT NULL,
          candidate_index INTEGER NOT NULL,
          generation_snapshot_json TEXT,
          storage_path TEXT NOT NULL,
          hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          parent_output_id TEXT,
          root_output_id TEXT,
          edit_session_id TEXT,
          edit_turn_id TEXT
        );
        INSERT INTO outputs VALUES ('root','p','item','job',1,NULL,'root.png','hash','2026-01-01T00:00:00.000Z',NULL,NULL,NULL,NULL);
      `);
      legacy.close();

      const migrated = openDatabase(filename);
      expect(migrated.prepare("PRAGMA table_info(outputs)").all()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "generation_key" })]));
      expect(migrated.prepare("SELECT id, generation_key FROM outputs").get()).toEqual({ id: "root", generation_key: null });
      expect(migrated.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_outputs_generation_key'").get()).toEqual({ name: "idx_outputs_generation_key" });
      migrated.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists search sources in ascending priority order without exposing a key through the record mapper", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    repository.saveSearchSource({ name: "备用", kind: "tavily", baseUrl: "https://api.tavily.com/search", encryptedApiKey: "encrypted-backup", priority: 20, enabled: true });
    repository.saveSearchSource({ name: "主源", kind: "brave", baseUrl: "https://api.search.brave.com/res/v1/web/search", encryptedApiKey: "encrypted-primary", priority: 5, enabled: true });
    expect(repository.listSearchSources().map((source) => [source.name, source.priority, source.encryptedApiKey])).toEqual([
      ["主源", 5, "encrypted-primary"],
      ["备用", 20, "encrypted-backup"]
    ]);
    database.close();
  });

  it("stores a copywriting result separately from project fields and associates it with its job", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider));
    const job = repository.createJob({ id: "copywrite-job", projectId: project.id, storyboardItemId: null, type: "COPYWRITE", input: { target: "PRODUCT_DESCRIPTION" } });
    repository.saveCopywritingResult({ jobId: job.id, projectId: project.id, target: "PRODUCT_DESCRIPTION", content: "产品名称：随行杯" });
    expect(repository.getCopywritingResult(job.id)).toMatchObject({ jobId: job.id, projectId: project.id, target: "PRODUCT_DESCRIPTION", content: "产品名称：随行杯" });
    expect(repository.getProject(project.id)?.productDescription).toBeNull();
    database.close();
  });

  it("keeps an edit session across derived outputs and records immutable output lineage", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database); const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider));
    const storyboard = repository.saveStoryboard(project.id, "", "CONFIRMED", [storyboardItem({ status: "CONFIRMED", promptInstruction: "cup" })]);
    const item = repository.listStoryboardItems(project.id)[0]!;
    const job = repository.createJob({ id: "edit-lineage-job", projectId: project.id, storyboardItemId: item.id, type: "GENERATE", input: {} });
    const root = repository.createOutput({ projectId: project.id, storyboardItemId: item.id, jobId: job.id, candidateIndex: 1, generationSnapshot: null, storagePath: "outputs/root.png", hash: "root" });
    const session = repository.createEditSession({ id: "edit-session", projectId: project.id, currentOutputId: root.id, status: "ACTIVE", memorySummary: { constraints: ["保留背景"] } });
    const turn = repository.createEditTurn({ id: "edit-turn", sessionId: session.id, projectId: project.id, baseOutputId: root.id, status: "SUCCEEDED", message: "变亮", annotations: {}, editMaskPath: null, editMaskHash: null, protectMaskPath: null, protectMaskHash: null, referenceAssetIds: [], plan: {}, error: null });
    const derived = repository.createOutput({ projectId: project.id, storyboardItemId: item.id, jobId: job.id, candidateIndex: 1, generationSnapshot: null, storagePath: "outputs/derived.png", hash: "derived", parentOutputId: root.id, rootOutputId: root.id, editSessionId: session.id, editTurnId: turn.id });
    repository.updateEditSession(session.id, { currentOutputId: derived.id });
    expect(repository.getActiveEditSession(project.id, derived.id)?.id).toBe(session.id);
    expect(repository.getOutput(derived.id)).toMatchObject({ parentOutputId: root.id, rootOutputId: root.id, editTurnId: turn.id });
    expect(repository.listEditOutputs(session.id).map((output) => output.id)).toEqual([derived.id]);
    expect(repository.isOutputInEditSession(session.id, root.id)).toBe(true);
    expect(repository.isOutputInEditSession(session.id, derived.id)).toBe(true);
    expect(repository.isOutputInEditSession(session.id, "other-output")).toBe(false);
    repository.updateProject(project.id, { archivedAt: "2026-08-01T01:00:00.000Z" });
    expect(repository.deleteArchivedProject(project.id)).toBe("deleted");
    expect(repository.getProject(project.id)).toBeUndefined();
    database.close();
  });

  it("keeps storyboard items bound to a project version and persists edits", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider, {
      category: "home",
      productDescription: "insulated travel cup",
      verifiedFacts: ["304 stainless steel body"],
      prohibitedClaims: ["keeps hot for 24 hours"],
      brandGuidelines: { accent: "#1A3A2E" },
      defaultMode: "PIXEL_PROTECTED",
      candidatesPerType: 2,
    }));
    const storyboard = repository.saveStoryboard(project.id, "quiet clean commercial photography", "DRAFT", [storyboardItem({
      displayName: "白底/纯色底产品主图",
      shotRole: "HERO",
      templateVariant: "luxury",
      candidateCount: 2,
      mode: "PIXEL_PROTECTED",
      promptInstruction: "hero image",
    })]);
    const item = repository.listStoryboardItems(project.id)[0];
    expect(storyboard.version).toBe(1);
    expect(item.displayName).toBe("白底/纯色底产品主图");
    expect(item.shotRole).toBe("HERO");
    expect(item.candidateCount).toBe(2);
    expect(item.imageProviderId).toBe(provider.id);
    expect(item.imageModelId).toBe("image");
    expect(item.imageResolution).toBe("1K");
    expect(item.imageAspectRatio).toBe("AUTO");
    expect(item.templateVariant).toBe("luxury");
    expect(repository.getProject(project.id)?.verifiedFacts).toEqual(["304 stainless steel body"]);
    expect(repository.getProject(project.id)?.candidatesPerType).toBe(2);
    const appended = repository.saveStoryboard(project.id, "second campaign", "DRAFT", [storyboardItem({
      assetType: "lifestyle-scene",
      displayName: "场景化生活图",
      shotRole: "SCENE",
      promptInstruction: "lifestyle",
    })]);
    expect(appended.version).toBe(2);
    expect(repository.listStoryboardItems(project.id).map((row) => row.assetType)).toEqual(["hero-image", "lifestyle-scene"]);
    expect(repository.deleteStoryboardItem(repository.listStoryboardItems(project.id)[1]!.id)?.assetType).toBe("lifestyle-scene");
    expect(repository.listStoryboardItems(project.id).map((row) => row.assetType)).toEqual(["hero-image"]);
    expect(provider.reasoningProtocol).toBe("openai");
    expect(provider.models[0]?.supportsThinking).toBe(true);
    expect(repository.confirmStoryboard(project.id)?.status).toBe("CONFIRMED");
    expect(repository.listStoryboardItems(project.id)[0]?.status).toBe("CONFIRMED");
    expect(repository.updateStoryboardItem(item.id, { imageResolution: "2K", imageAspectRatio: "1:1", candidateCount: 3 })).toMatchObject({
      imageResolution: "2K",
      imageAspectRatio: "1:1",
      candidateCount: 3,
    });
    database.close();
  });

  it("records the generation job fingerprint, cancellation flag and web research audit", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider));
    repository.saveStoryboard(project.id, "lock", "DRAFT", [storyboardItem()]);
    const item = repository.listStoryboardItems(project.id)[0]!;
    const job = repository.createJob({ id: "job-1", projectId: project.id, storyboardItemId: item.id, type: "GENERATE", input: { candidateIndex: 1 }, requestFingerprint: "fp-1", providerId: provider.id, modelId: "image", estimatedCost: { status: "UNKNOWN" } });
    expect(repository.findJobByFingerprint(project.id, "fp-1")?.id).toBe("job-1");
    expect(repository.updateJob(job.id, { cancelRequested: true })?.cancelRequested).toBe(true);
    expect(repository.createWebResearchAudit(job.id, "AVAILABLE").invocationCount).toBe(0);
    repository.recordWebResearchSearch(job.id);
    repository.recordWebResearchAttempt({ jobId: job.id, query: "product photography lighting", sourceId: "brave", sourceName: "Brave", sourceKind: "brave", status: "FAILED", resultCount: 0, errorMessage: "HTTP 503" });
    repository.recordWebResearchAttempt({ jobId: job.id, query: "product photography lighting", sourceId: "tavily", sourceName: "Tavily", sourceKind: "tavily", status: "SUCCEEDED", resultCount: 3, errorMessage: null });
    expect(repository.getWebResearchAudit(job.id)).toMatchObject({ invocationCount: 1, failedAttemptCount: 1, successfulAttemptCount: 1 });
    expect(repository.listWebResearchAttempts(job.id)).toMatchObject([{ sourceId: "brave", status: "FAILED" }, { sourceId: "tavily", status: "SUCCEEDED", resultCount: 3 }]);
    database.close();
  });

  it("persists generated outputs and reuses the record for a duplicate generation key", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider));
    repository.saveStoryboard(project.id, "lock", "DRAFT", [storyboardItem()]);
    const item = repository.listStoryboardItems(project.id)[0]!;
    const job = repository.createJob({ id: "job-1", projectId: project.id, storyboardItemId: item.id, type: "GENERATE", input: {} });
    const output = repository.createOutput({
      projectId: project.id,
      storyboardItemId: item.id,
      jobId: job.id,
      candidateIndex: 1,
      generationSnapshot: { providerId: provider.id, modelId: "image", resolution: "1K", aspectRatio: "AUTO", size: "1024x1024", candidateIndex: 1 },
      storagePath: "outputs/cup.png",
      hash: "hash",
      generationKey: "generation-key-1"
    });
    expect(output.candidateIndex).toBe(1);
    expect(repository.getOutputByGenerationKey("generation-key-1")?.id).toBe(output.id);
    const duplicate = repository.createOutput({
      projectId: project.id,
      storyboardItemId: item.id,
      jobId: job.id,
      candidateIndex: 1,
      generationSnapshot: output.generationSnapshot,
      storagePath: "outputs/duplicate.png",
      hash: "duplicate",
      generationKey: "generation-key-1"
    });
    expect(duplicate.id).toBe(output.id);
    database.close();
  });

  it("deletes an asset row and reports missing ids", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject({
      name: "cup",
      category: null,
      productDescription: null,
      verifiedFacts: [],
      prohibitedClaims: [],
      brandGuidelines: {},
      platformTargets: ["TAOBAO"],
      targetMarket: null,
      copyLanguage: null,
      reasoningProviderId: provider.id,
      reasoningModelId: "reasoner",
      imageProviderId: provider.id,
      imageModelId: "image",
      defaultMode: "CREATIVE",
      imageResolution: "1K",
      imageAspectRatio: "AUTO",
      candidatesPerType: 1
    });
    const asset = repository.createAsset({ projectId: project.id, role: "PRODUCT_TRUTH", storagePath: "assets/cup.png", hash: "hash", originalName: "cup.png", mimeType: "image/png", width: null, height: null });
    expect(repository.deleteAsset(asset.id)?.id).toBe(asset.id);
    expect(repository.getAsset(asset.id)).toBeUndefined();
    expect(repository.deleteAsset(asset.id)).toBeUndefined();
    database.close();
  });

  it("persists ordered project and temporary references on an edit turn", () => {
    const database = openDatabase(":memory:"); const repository = new EcomRepository(database); const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider));
    repository.saveStoryboard(project.id, "lock", "DRAFT", [{ assetType: "hero-image", displayName: "主图", shotRole: null, templateVariant: null, candidateCount: 1, referencedAssets: [], mode: "CREATIVE", status: "DRAFT", promptInstruction: "hero", compiledPrompt: null, factClaims: [], riskFlags: [], sortOrder: 0 }]);
    const item = repository.listStoryboardItems(project.id)[0]!; const job = repository.createJob({ id: "reference-job", projectId: project.id, storyboardItemId: item.id, type: "GENERATE", input: {} });
    const output = repository.createOutput({ projectId: project.id, storyboardItemId: item.id, jobId: job.id, candidateIndex: 1, generationSnapshot: null, storagePath: "outputs/base.png", hash: "base" });
    const session = repository.createEditSession({ id: "reference-session", projectId: project.id, currentOutputId: output.id, status: "ACTIVE", memorySummary: {} });
    const projectAsset = repository.createAsset({ projectId: project.id, role: "PACKAGING", storagePath: "assets/package.png", hash: "package", originalName: "package.png", mimeType: "image/png", width: null, height: null });
    const temporary = repository.createEditReferenceAsset({ id: "temporary-reference", projectId: project.id, sessionId: session.id, turnId: null, storagePath: "edits/reference.png", hash: "temporary", originalName: "label.png", mimeType: "image/png", purpose: "LABEL", expiresAt: "2099-01-01T00:00:00.000Z" });
    const selections = [{ id: projectAsset.id, source: "PROJECT" as const, purpose: "PACKAGING" as const, order: 0 }, { id: temporary.id, source: "TEMPORARY" as const, purpose: "LABEL" as const, order: 1 }];
    const turn = repository.createEditTurn({ id: "reference-turn", sessionId: session.id, projectId: project.id, baseOutputId: output.id, status: "PLANNING", message: "replace", annotations: {}, editMaskPath: null, editMaskHash: null, protectMaskPath: null, protectMaskHash: null, referenceAssetIds: [projectAsset.id], referenceSelections: selections, plan: null, error: null });
    repository.attachEditReferenceAssets(session.id, turn.id, [temporary.id]);
    expect(repository.getEditTurn(turn.id)?.referenceSelections).toEqual(selections);
    expect(repository.getEditReferenceAsset(temporary.id)?.turnId).toBe(turn.id);
    database.close();
  });

  it("summarizes list covers with earliest product photo, latest output cover, and extra previews", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const projectInput = makeProjectInput(provider);
    const withOutputs = repository.createProject({ ...projectInput, name: "with-outputs" });
    const empty = repository.createProject({ ...projectInput, name: "empty" });
    const firstAsset = repository.createAsset({ projectId: withOutputs.id, role: "PRODUCT_TRUTH", storagePath: "assets/first.png", hash: "h1", originalName: "first.png", mimeType: "image/png", width: null, height: null });
    const secondAsset = repository.createAsset({ projectId: withOutputs.id, role: "PRODUCT_TRUTH", storagePath: "assets/second.png", hash: "h2", originalName: "second.png", mimeType: "image/png", width: null, height: null });
    repository.createAsset({ projectId: withOutputs.id, role: "STYLE_REFERENCE", storagePath: "assets/ref.png", hash: "h3", originalName: "ref.png", mimeType: "image/png", width: null, height: null });
    database.prepare("UPDATE assets SET created_at=? WHERE id=?").run("2026-08-01T00:00:00.000Z", firstAsset.id);
    database.prepare("UPDATE assets SET created_at=? WHERE id=?").run("2026-08-01T00:01:00.000Z", secondAsset.id);
    const storyboard = repository.saveStoryboard(withOutputs.id, "lock", "DRAFT", [storyboardItem({ displayName: "主图" })]);
    const item = repository.listStoryboardItems(withOutputs.id)[0]!;
    const job = repository.createJob({ id: "job-cover", projectId: withOutputs.id, storyboardItemId: item.id, type: "GENERATE", input: {} });
    const oldest = repository.createOutput({ projectId: withOutputs.id, storyboardItemId: item.id, jobId: job.id, candidateIndex: 1, generationSnapshot: null, storagePath: "out/1.png", hash: "o1" });
    const middle = repository.createOutput({ projectId: withOutputs.id, storyboardItemId: item.id, jobId: job.id, candidateIndex: 2, generationSnapshot: null, storagePath: "out/2.png", hash: "o2" });
    const newest = repository.createOutput({ projectId: withOutputs.id, storyboardItemId: item.id, jobId: job.id, candidateIndex: 3, generationSnapshot: null, storagePath: "out/3.png", hash: "o3" });
    database.prepare("UPDATE outputs SET created_at=? WHERE id=?").run("2026-08-01T01:00:00.000Z", oldest.id);
    database.prepare("UPDATE outputs SET created_at=? WHERE id=?").run("2026-08-01T01:01:00.000Z", middle.id);
    database.prepare("UPDATE outputs SET created_at=? WHERE id=?").run("2026-08-01T01:02:00.000Z", newest.id);
    expect(storyboard.version).toBe(1);
    const covers = repository.listProjectCovers([withOutputs.id, empty.id]);
    const filled = covers.get(withOutputs.id);
    expect(filled?.productAssetId).toBe(firstAsset.id);
    expect(filled?.coverOutputId).toBe(newest.id);
    expect(filled?.previewOutputIds).toEqual([middle.id, oldest.id]);
    expect(filled?.outputCount).toBe(3);
    expect(covers.get(empty.id)).toEqual({ productAssetId: null, coverOutputId: null, previewOutputIds: [], outputCount: 0 });
    database.close();
  });

  it("模特库 CRUD 往返，选定切换保证每模特至多一张且同 hash 候选幂等", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const created = repository.createModel({ name: "小满", spec: makeModelSpec(), notes: "甜酷风" });
    expect(repository.getModel(created.id)).toEqual(created);
    expect(repository.listModels()).toEqual([created]);

    const renamed = repository.updateModel(created.id, { name: "小满 2.0", notes: "清冷挂" });
    expect(renamed).toMatchObject({ name: "小满 2.0", notes: "清冷挂" });
    expect(renamed?.createdAt).toBe(created.createdAt);

    const withFace = repository.setModelReferenceFace(created.id, "models/ref-face.png", "face-hash");
    expect(withFace).toMatchObject({ referenceFacePath: "models/ref-face.png", referenceFaceHash: "face-hash" });
    expect(repository.setModelReferenceFace(created.id, null, null)?.referenceFacePath).toBeNull();
    expect(repository.setModelReferenceFace("missing-model", "x.png", "x")).toBeUndefined();

    const job = repository.createJob({ id: "job-cast", projectId: null, storyboardItemId: null, type: "MODEL_CAST", input: { modelId: created.id } });
    const portraitInput = { modelId: created.id, jobId: job.id, storagePath: "models/p1.png", hash: "portrait-1", width: 1024, height: 1536, providerId: "provider-1", imageModelId: "image-model", aspectRatio: "AUTO" as const };
    const first = repository.createModelPortrait(portraitInput);
    const second = repository.createModelPortrait({ ...portraitInput, storagePath: "models/p2.png", hash: "portrait-2" });
    expect(repository.createModelPortrait(portraitInput)).toEqual(first);
    expect(repository.listModelPortraits(created.id)).toHaveLength(2);

    expect(repository.selectModelPortrait(created.id, first.id)).toBe("selected");
    expect(repository.listModelPortraits(created.id).find((portrait) => portrait.id === first.id)?.selected).toBe(true);
    expect(repository.selectModelPortrait(created.id, second.id)).toBe("selected");
    const afterSwitch = repository.listModelPortraits(created.id);
    expect(afterSwitch.find((portrait) => portrait.id === second.id)?.selected).toBe(true);
    expect(afterSwitch.filter((portrait) => portrait.selected)).toHaveLength(1);
    expect(repository.selectModelPortrait(created.id, "missing-portrait")).toBe("missing");

    // 缩略图的惰性兜底按内容 hash 反查来源文件：模特候选必须查得到，否则库里的模特图缩略图必定 404。
    expect(repository.findLibrarySourcePath(first.hash)).toBe("models/p1.png");
    expect(repository.listAllModelPortraits()).toHaveLength(2);

    expect(repository.deleteModelPortrait(first.id)).toBe(true);
    expect(repository.deleteModel(created.id)).toBe(true);
    expect(repository.getModel(created.id)).toBeUndefined();
    expect(repository.listModelPortraits(created.id)).toHaveLength(0);
    database.close();
  });

  it("spec_json 缺少契约新增维度时，开库迁移补齐缺失键且不动已有取值", () => {
    const directory = mkdtempSync(join(tmpdir(), "ecomgen-model-spec-"));
    const filename = join(directory, "ecomgen.sqlite");
    try {
      const database = openDatabase(filename);
      const repository = new EcomRepository(database);
      const created = repository.createModel({ name: "小满", spec: makeModelSpec(), notes: "" });
      // 造一条历史行：删掉两个后加的维度，模拟契约演进前的存量数据。
      const legacy = { ...makeModelSpec() } as Record<string, unknown>;
      delete legacy.hairline;
      delete legacy.facialHair;
      database.prepare("UPDATE models SET spec_json=? WHERE id=?").run(JSON.stringify(legacy), created.id);
      database.close();

      // 重新开库即触发迁移；缺少的维度按基准值补齐，不能让编译层取到 undefined。
      const reopened = openDatabase(filename);
      const migrated = new EcomRepository(reopened).getModel(created.id)!;
      expect(migrated.spec.hairline).toBe(MODEL_SPEC_DEFAULTS.hairline);
      expect(migrated.spec.facialHair).toBe(MODEL_SPEC_DEFAULTS.facialHair);
      expect(migrated.spec.browShape).toBe(legacy.browShape);
      reopened.close();

      // 幂等：再次开库不改变已对齐的行。
      const again = openDatabase(filename);
      expect(new EcomRepository(again).getModel(created.id)).toEqual(migrated);
      again.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

/** 覆盖 ModelSpec 全部维度的最小合法组合；用例只改与其断言相关的取值。 */
function makeModelSpec(): ModelSpec {
  return {
    gender: "FEMALE", age: "LATE_20S", heritage: "EAST_ASIAN", stature: "STANDARD_165", build: "BALANCED",
    faceShape: "OVAL", eyeShape: "ALMOND", eyeColor: "DARK_BROWN", browShape: "STRAIGHT_SOFT", noseShape: "STRAIGHT", lipShape: "NATURAL",
    hairLength: "SHOULDER", hairstyle: "SOFT_WAVE", hairColor: "INK_BLACK", hairTexture: "NATURAL_VOLUME", hairline: "ROUNDED",
    complexion: "FAIR_WARM", skinTexture: "NATURAL_PORES", facialHair: "NONE", distinctiveMarks: [],
    expression: "CALM_DIRECT", gaze: "DIRECT_TO_CAMERA", aura: ["WARM_APPROACHABLE"], makeup: "MINIMAL_DEWY", baseWardrobe: "WHITE_TANK",
    framing: "THREE_QUARTER", pose: "HANDS_RELAXED", backdrop: "SEAMLESS_GREY", lighting: "SOFTBOX_THREE_POINT", lens: "LENS_50",
  };
}

describe("LayerPlan / LayerExport 持久化", () => {
  it("plan/export 记录 CRUD 往返，status 与产物字段可更新", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider, { segmentationModel: { providerId: provider.id, modelId: "fal-ai/sam-3/image" } }));
    expect(repository.getProject(project.id)?.segmentationModel).toEqual({ providerId: provider.id, modelId: "fal-ai/sam-3/image", protocol: "fal" });
    expect(repository.updateProject(project.id, { segmentationModel: { providerId: provider.id, modelId: "grounded-sam-2", protocol: "grounded_sam" } })?.segmentationModel).toMatchObject({ protocol: "grounded_sam" });

    const job = repository.createJob({ id: "job-plan-1", projectId: project.id, storyboardItemId: null, type: "LAYER_PLAN", status: "QUEUED", input: { outputId: "out-1" } });
    const plan = repository.createLayerPlan({ projectId: project.id, outputId: "out-1", jobId: job.id, outputHash: "hash-1", status: "QUEUED", elements: [], error: null });
    expect(repository.getLayerPlanByOutput("out-1")?.id).toBe(plan.id);
    expect(repository.getLayerPlanByJobId(job.id)?.outputHash).toBe("hash-1");
    const succeeded = repository.updateLayerPlan(plan.id, { status: "SUCCEEDED", elements: [{ id: "el-1", name: "瓶子", source: "auto", bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }] });
    expect(succeeded).toMatchObject({ status: "SUCCEEDED", elements: [{ id: "el-1", name: "瓶子", source: "auto" }] });

    const exportJob = repository.createJob({ id: "job-export-1", projectId: project.id, storyboardItemId: null, type: "LAYER_EXPORT", status: "QUEUED", input: { outputId: "out-1" } });
    const layerExport = repository.createLayerExport({ projectId: project.id, outputId: "out-1", jobId: exportJob.id, planId: plan.id, status: "QUEUED", includeBackground: true, psdStoragePath: null, layerFiles: null, error: null });
    expect(repository.getLayerExportByJobId(exportJob.id)?.planId).toBe(plan.id);
    // 画框/提示词直接分层时 planId 为空（无识别方案）
    const promptExportJob = repository.createJob({ id: "job-export-2", projectId: project.id, storyboardItemId: null, type: "LAYER_EXPORT", status: "QUEUED", input: { outputId: "out-1" } });
    const promptExport = repository.createLayerExport({ projectId: project.id, outputId: "out-1", jobId: promptExportJob.id, planId: null, status: "QUEUED", includeBackground: false, psdStoragePath: null, layerFiles: null, error: null });
    expect(repository.getLayerExport(promptExport.id)?.planId).toBeNull();
    const finished = repository.updateLayerExport(layerExport.id, { status: "SUCCEEDED", psdStoragePath: "layers/x/out.psd", layerFiles: [{ name: "01_瓶子", kind: "element", storagePath: "layers/x/01.png", hash: "abc" }] });
    expect(finished).toMatchObject({ status: "SUCCEEDED", includeBackground: true, psdStoragePath: "layers/x/out.psd" });
    expect(finished?.layerFiles).toHaveLength(1);
    expect(repository.updateLayerExport(layerExport.id, { status: "FAILED", error: { message: "SAM failed" } })?.error).toEqual({ message: "SAM failed" });
    // 删除 Provider 同步清空 segmentationModel 引用
    repository.deleteProvider(provider.id);
    expect(repository.getProject(project.id)?.segmentationModel).toBeNull();
    database.close();
  });

  it("恢复中断任务时同步把分层记录推进到终态", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject(makeProjectInput(provider, { segmentationModel: { providerId: provider.id, modelId: "fal-ai/sam-3/image" } }));
    // 未发出外部请求的 RUNNING 分层任务可安全重跑：记录回到 QUEUED 并清空错误
    const planJob = repository.createJob({ id: "recover-plan", projectId: project.id, storyboardItemId: null, type: "LAYER_PLAN", status: "QUEUED", input: { outputId: "out-1" } });
    const plan = repository.createLayerPlan({ projectId: project.id, outputId: "out-1", jobId: planJob.id, outputHash: "hash-1", status: "RUNNING", elements: [], error: { message: "stale" } });
    // 已发出外部请求的 RUNNING 导出无法确认结果：记录置 FAILED，避免永远停在 RUNNING
    const exportJob = repository.createJob({ id: "recover-export", projectId: project.id, storyboardItemId: null, type: "LAYER_EXPORT", status: "QUEUED", input: { outputId: "out-1" } });
    const layerExport = repository.createLayerExport({ projectId: project.id, outputId: "out-1", jobId: exportJob.id, planId: null, status: "RUNNING", includeBackground: true, psdStoragePath: null, layerFiles: null, error: null });
    database.prepare("UPDATE jobs SET status='RUNNING' WHERE id IN (?, ?)").run(planJob.id, exportJob.id);
    database.prepare("UPDATE jobs SET provider_task_id=? WHERE id=?").run(EXTERNAL_REQUEST_STARTED, exportJob.id);

    expect(repository.recoverInterruptedJobs().map((job) => job.id)).toEqual([planJob.id]);
    expect(repository.getLayerPlan(plan.id)).toMatchObject({ status: "QUEUED", error: null });
    expect(repository.getLayerExport(layerExport.id)).toMatchObject({ status: "FAILED", error: { message: "外部图像请求结果未知，已停止自动重试以避免重复计费" } });
    // 崩溃发生在 PSD 落盘之后：导出记录已有完成证据，恢复时不得改判 FAILED，也不得重新执行计费请求
    const lateJob = repository.createJob({ id: "recover-export-2", projectId: project.id, storyboardItemId: null, type: "LAYER_EXPORT", status: "QUEUED", input: { outputId: "out-1" } });
    const lateExport = repository.createLayerExport({ projectId: project.id, outputId: "out-1", jobId: lateJob.id, planId: null, status: "SUCCEEDED", includeBackground: true, psdStoragePath: "layers/x/late.psd", layerFiles: null, error: null });
    database.prepare("UPDATE jobs SET status='RUNNING',provider_task_id=? WHERE id=?").run(EXTERNAL_REQUEST_STARTED, lateJob.id);
    expect(repository.recoverInterruptedJobs()).toEqual([]);
    expect(repository.getJob(lateJob.id)).toMatchObject({ status: "FAILED", retryable: false, error: { message: "外部图像请求结果未知，已停止自动重试以避免重复计费" } });
    expect(repository.getLayerExport(lateExport.id)).toMatchObject({ status: "SUCCEEDED", psdStoragePath: "layers/x/late.psd" });
    database.close();
  });
});
