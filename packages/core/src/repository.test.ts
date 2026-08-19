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
});
