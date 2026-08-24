import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { openDatabase } from "./database.js";
import { EcomRepository, EXTERNAL_REQUEST_STARTED } from "./repository.js";

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

describe("EcomRepository", () => {
  it("恢复任务时不自动重试结果未知的外部图像请求", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject({ name: "cup", category: null, productDescription: null, verifiedFacts: [], prohibitedClaims: [], brandGuidelines: {}, platformTargets: ["DOMESTIC"], targetMarket: null, copyLanguage: null, reasoningProviderId: provider.id, reasoningModelId: "reasoner", imageProviderId: provider.id, imageModelId: "image", defaultMode: "CREATIVE", imageResolution: "1K", imageAspectRatio: "AUTO", candidatesPerType: 1 });
    const safe = repository.createJob({ id: "recover-safe", projectId: project.id, storyboardItemId: null, type: "PLAN", input: {} });
    const uncertain = repository.createJob({ id: "recover-uncertain", projectId: project.id, storyboardItemId: null, type: "GENERATE", input: {} });
    database.prepare("UPDATE jobs SET status='RUNNING' WHERE id IN (?, ?)").run(safe.id, uncertain.id);
    database.prepare("UPDATE jobs SET provider_task_id=? WHERE id=?").run(EXTERNAL_REQUEST_STARTED, uncertain.id);
    expect(repository.recoverInterruptedJobs().map((job) => job.id)).toEqual([safe.id]);
    expect(repository.getJob(safe.id)?.status).toBe("QUEUED");
    expect(repository.getJob(uncertain.id)).toMatchObject({ status: "FAILED", retryable: false, error: { message: "外部图像请求结果未知，已停止自动重试以避免重复计费" } });
    database.close();
  });

  it("按归档状态隔离项目并支持恢复", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const input: Parameters<EcomRepository["createProject"]>[0] = { name: "cup", category: null, productDescription: null, verifiedFacts: [], prohibitedClaims: [], brandGuidelines: {}, platformTargets: ["DOMESTIC"], targetMarket: null, copyLanguage: null, reasoningProviderId: provider.id, reasoningModelId: "reasoner", imageProviderId: provider.id, imageModelId: "image", defaultMode: "CREATIVE", imageResolution: "1K", imageAspectRatio: "AUTO", candidatesPerType: 1 };
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
    const project = repository.createProject({ name: "cup", category: null, productDescription: null, verifiedFacts: [], prohibitedClaims: [], brandGuidelines: {}, platformTargets: ["DOMESTIC"], targetMarket: null, copyLanguage: null, reasoningProviderId: provider.id, reasoningModelId: "reasoner", imageProviderId: provider.id, imageModelId: "image", defaultMode: "CREATIVE", imageResolution: "1K", imageAspectRatio: "AUTO", candidatesPerType: 1 });
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
          'legacy-project', 'legacy', NULL, NULL, '[]', '[]', '{}', '["DOMESTIC"]',
          'reasoning', 'reasoner', 'image', 'image-model', 'CREATIVE', '1K', 'AUTO', 1, 0,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
      `);
      database.close();

      const migrated = openDatabase(filename);
      const project = new EcomRepository(migrated).getProject("legacy-project");
      expect(project).toMatchObject({ platformTargets: ["DOMESTIC"], targetMarket: null, copyLanguage: null });
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
    const project = repository.createProject({
      name: "cup",
      category: null,
      productDescription: null,
      verifiedFacts: [],
      prohibitedClaims: [],
      brandGuidelines: {},
      platformTargets: ["DOMESTIC"],
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
    });
    const job = repository.createJob({ id: "copywrite-job", projectId: project.id, storyboardItemId: null, type: "COPYWRITE", input: { target: "PRODUCT_DESCRIPTION" } });
    repository.saveCopywritingResult({ jobId: job.id, projectId: project.id, target: "PRODUCT_DESCRIPTION", content: "产品名称：随行杯" });
    expect(repository.getCopywritingResult(job.id)).toMatchObject({ jobId: job.id, projectId: project.id, target: "PRODUCT_DESCRIPTION", content: "产品名称：随行杯" });
    expect(repository.getProject(project.id)?.productDescription).toBeNull();
    database.close();
  });

  it("keeps an edit session across derived outputs and records immutable output lineage", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database); const provider = seedProvider(repository);
    const project = repository.createProject({ name: "cup", category: null, productDescription: null, verifiedFacts: [], prohibitedClaims: [], brandGuidelines: {}, platformTargets: ["DOMESTIC"], targetMarket: null, copyLanguage: null, reasoningProviderId: provider.id, reasoningModelId: "reasoner", imageProviderId: provider.id, imageModelId: "image", defaultMode: "CREATIVE", imageResolution: "1K", imageAspectRatio: "AUTO", candidatesPerType: 1 });
    const storyboard = repository.saveStoryboard(project.id, "", "CONFIRMED", [{ assetType: "hero-image", displayName: "杯子首图", templateVariant: null, candidateCount: 1, referencedAssets: [], mode: "CREATIVE", status: "CONFIRMED", promptInstruction: "cup", compiledPrompt: null, factClaims: [], riskFlags: [], sortOrder: 0 }]);
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

  it("keeps storyboard items bound to a project version and persists generated outputs", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const project = repository.createProject({
      name: "cup",
      category: "home",
      productDescription: "insulated travel cup",
      verifiedFacts: ["304 stainless steel body"],
      prohibitedClaims: ["keeps hot for 24 hours"],
      brandGuidelines: { accent: "#1A3A2E" },
      platformTargets: ["DOMESTIC"],
      targetMarket: null,
      copyLanguage: null,
      reasoningProviderId: provider.id,
      reasoningModelId: "reasoner",
      imageProviderId: provider.id,
      imageModelId: "image",
      defaultMode: "PIXEL_PROTECTED",
      imageResolution: "1K",
      imageAspectRatio: "AUTO",
      candidatesPerType: 2
    });
    const storyboard = repository.saveStoryboard(project.id, "quiet clean commercial photography", "DRAFT", [{
      assetType: "hero-image",
      displayName: "白底/纯色底产品主图",
      templateVariant: "luxury",
      candidateCount: 2,
      referencedAssets: [],
      mode: "PIXEL_PROTECTED",
      status: "DRAFT",
      promptInstruction: "hero image",
      compiledPrompt: null,
      factClaims: [],
      riskFlags: [],
      sortOrder: 0
    }]);
    const item = repository.listStoryboardItems(project.id)[0];
    expect(storyboard.version).toBe(1);
    expect(item.displayName).toBe("白底/纯色底产品主图");
    expect(item.candidateCount).toBe(2);
    expect(item.imageProviderId).toBe(provider.id);
    expect(item.imageModelId).toBe("image");
    expect(item.imageResolution).toBe("1K");
    expect(item.imageAspectRatio).toBe("AUTO");
    expect(item.templateVariant).toBe("luxury");
    expect(repository.getProject(project.id)?.verifiedFacts).toEqual(["304 stainless steel body"]);
    expect(repository.getProject(project.id)?.candidatesPerType).toBe(2);
    const appended = repository.saveStoryboard(project.id, "second campaign", "DRAFT", [{
      assetType: "lifestyle-scene",
      displayName: "场景化生活图",
      templateVariant: null,
      candidateCount: 1,
      referencedAssets: [],
      mode: "CREATIVE",
      status: "DRAFT",
      promptInstruction: "lifestyle",
      compiledPrompt: null,
      factClaims: [],
      riskFlags: [],
      sortOrder: 0
    }]);
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
    const job = repository.createJob({ id: "job-1", projectId: project.id, storyboardItemId: item.id, type: "GENERATE", input: { candidateIndex: 1 }, requestFingerprint: "fp-1", providerId: provider.id, modelId: "image", estimatedCost: { status: "UNKNOWN" } });
    expect(repository.findJobByFingerprint(project.id, "fp-1")?.id).toBe("job-1");
    expect(repository.updateJob(job.id, { cancelRequested: true })?.cancelRequested).toBe(true);
    expect(repository.createWebResearchAudit(job.id, "AVAILABLE").invocationCount).toBe(0);
    repository.recordWebResearchSearch(job.id);
    repository.recordWebResearchAttempt({ jobId: job.id, query: "product photography lighting", sourceId: "brave", sourceName: "Brave", sourceKind: "brave", status: "FAILED", resultCount: 0, errorMessage: "HTTP 503" });
    repository.recordWebResearchAttempt({ jobId: job.id, query: "product photography lighting", sourceId: "tavily", sourceName: "Tavily", sourceKind: "tavily", status: "SUCCEEDED", resultCount: 3, errorMessage: null });
    expect(repository.getWebResearchAudit(job.id)).toMatchObject({ invocationCount: 1, failedAttemptCount: 1, successfulAttemptCount: 1 });
    expect(repository.listWebResearchAttempts(job.id)).toMatchObject([{ sourceId: "brave", status: "FAILED" }, { sourceId: "tavily", status: "SUCCEEDED", resultCount: 3 }]);
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
      platformTargets: ["DOMESTIC"],
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

  it("summarizes list covers with earliest product photo, latest output cover, and extra previews", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = seedProvider(repository);
    const projectInput = {
      name: "cup",
      category: null as string | null,
      productDescription: null as string | null,
      verifiedFacts: [] as string[],
      prohibitedClaims: [] as string[],
      brandGuidelines: {} as Record<string, string>,
      platformTargets: ["DOMESTIC"] as Array<"DOMESTIC" | "AMAZON">,
      targetMarket: null,
      copyLanguage: null,
      reasoningProviderId: provider.id,
      reasoningModelId: "reasoner",
      imageProviderId: provider.id,
      imageModelId: "image",
      defaultMode: "CREATIVE" as const,
      imageResolution: "1K" as const,
      imageAspectRatio: "AUTO" as const,
      candidatesPerType: 1
    };
    const withOutputs = repository.createProject({ ...projectInput, name: "with-outputs" });
    const empty = repository.createProject({ ...projectInput, name: "empty" });
    const firstAsset = repository.createAsset({ projectId: withOutputs.id, role: "PRODUCT_TRUTH", storagePath: "assets/first.png", hash: "h1", originalName: "first.png", mimeType: "image/png", width: null, height: null });
    const secondAsset = repository.createAsset({ projectId: withOutputs.id, role: "PRODUCT_TRUTH", storagePath: "assets/second.png", hash: "h2", originalName: "second.png", mimeType: "image/png", width: null, height: null });
    repository.createAsset({ projectId: withOutputs.id, role: "STYLE_REFERENCE", storagePath: "assets/ref.png", hash: "h3", originalName: "ref.png", mimeType: "image/png", width: null, height: null });
    database.prepare("UPDATE assets SET created_at=? WHERE id=?").run("2026-08-01T00:00:00.000Z", firstAsset.id);
    database.prepare("UPDATE assets SET created_at=? WHERE id=?").run("2026-08-01T00:01:00.000Z", secondAsset.id);
    const storyboard = repository.saveStoryboard(withOutputs.id, "lock", "DRAFT", [{
      assetType: "hero-image",
      displayName: "主图",
      templateVariant: null,
      candidateCount: 1,
      referencedAssets: [],
      mode: "CREATIVE",
      status: "DRAFT",
      promptInstruction: "hero",
      compiledPrompt: null,
      factClaims: [],
      riskFlags: [],
      sortOrder: 0
    }]);
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
});
