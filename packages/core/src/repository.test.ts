import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import { EcomRepository } from "./repository.js";

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

  it("keeps storyboard items bound to a project version and persists output review", () => {
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
      generationSnapshot: { resolution: "1K", aspectRatio: "AUTO", size: "1024x1024", candidateIndex: 1 },
      storagePath: "outputs/cup.png",
      hash: "hash",
      reviewDecision: "NEEDS_REVIEW",
      reviewNote: null
    });
    expect(output.candidateIndex).toBe(1);
    expect(repository.reviewOutput(output.id, "SELECTED", "approved")?.reviewDecision).toBe("SELECTED");
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

  it("summarizes list covers with earliest product photo, SELECTED cover, and extra previews", () => {
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
    const oldest = repository.createOutput({ projectId: withOutputs.id, storyboardItemId: item.id, jobId: job.id, candidateIndex: 1, generationSnapshot: null, storagePath: "out/1.png", hash: "o1", reviewDecision: "NEEDS_REVIEW", reviewNote: null });
    const selected = repository.createOutput({ projectId: withOutputs.id, storyboardItemId: item.id, jobId: job.id, candidateIndex: 2, generationSnapshot: null, storagePath: "out/2.png", hash: "o2", reviewDecision: "SELECTED", reviewNote: null });
    const newest = repository.createOutput({ projectId: withOutputs.id, storyboardItemId: item.id, jobId: job.id, candidateIndex: 3, generationSnapshot: null, storagePath: "out/3.png", hash: "o3", reviewDecision: "NEEDS_REVIEW", reviewNote: null });
    database.prepare("UPDATE outputs SET created_at=? WHERE id=?").run("2026-08-01T01:00:00.000Z", oldest.id);
    database.prepare("UPDATE outputs SET created_at=? WHERE id=?").run("2026-08-01T01:01:00.000Z", selected.id);
    database.prepare("UPDATE outputs SET created_at=? WHERE id=?").run("2026-08-01T01:02:00.000Z", newest.id);
    expect(storyboard.version).toBe(1);
    const covers = repository.listProjectCovers([withOutputs.id, empty.id]);
    const filled = covers.get(withOutputs.id);
    expect(filled?.productAssetId).toBe(firstAsset.id);
    expect(filled?.coverOutputId).toBe(selected.id);
    expect(filled?.previewOutputIds).toEqual([newest.id, oldest.id]);
    expect(filled?.outputCount).toBe(3);
    expect(covers.get(empty.id)).toEqual({ productAssetId: null, coverOutputId: null, previewOutputIds: [], outputCount: 0 });
    database.close();
  });
});
