import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import { EcomRepository } from "./repository.js";

describe("EcomRepository", () => {
  it("keeps storyboard items bound to a project version and persists output review", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = repository.saveProvider({ name: "test", baseUrl: "https://example.test/v1", encryptedApiKey: "encrypted", models: [{ id: "reasoner", supportsVision: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null }, { id: "image", supportsVision: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: "openai_images" }] });
    const project = repository.createProject({ name: "cup", category: "home", productDescription: "insulated travel cup", verifiedFacts: ["304 stainless steel body"], prohibitedClaims: ["keeps hot for 24 hours"], brandGuidelines: { accent: "#1A3A2E" }, platformTargets: ["DOMESTIC"], reasoningProviderId: provider.id, reasoningModelId: "reasoner", imageProviderId: provider.id, imageModelId: "image", defaultMode: "PIXEL_PROTECTED" });
    const variant = repository.createVariant(project.id, "red", { color: "red" });
    const storyboard = repository.saveStoryboard(project.id, "quiet clean commercial photography", "DRAFT", [{ assetType: "hero-image", templateVariant: "luxury", variantScope: variant.id, mode: "PIXEL_PROTECTED", status: "DRAFT", promptInstruction: "hero image", compiledPrompt: null, factClaims: [], riskFlags: [], sortOrder: 0 }]);
    const item = repository.listStoryboardItems(project.id)[0];
    expect(storyboard.version).toBe(1);
    expect(item.variantScope).toBe(variant.id);
    expect(item.templateVariant).toBe("luxury");
    expect(repository.getProject(project.id)?.verifiedFacts).toEqual(["304 stainless steel body"]);
    expect(repository.confirmStoryboard(project.id)?.status).toBe("CONFIRMED");
    const job = repository.createJob({ id: "job-1", projectId: project.id, storyboardItemId: item.id, type: "GENERATE", input: {}, requestFingerprint: "fp-1", providerId: provider.id, modelId: "image", estimatedCost: { status: "UNKNOWN" } });
    expect(repository.findJobByFingerprint(project.id, "fp-1")?.id).toBe("job-1");
    expect(repository.updateJob(job.id, { cancelRequested: true })?.cancelRequested).toBe(true);
    const output = repository.createOutput({ projectId: project.id, storyboardItemId: item.id, jobId: job.id, storagePath: "outputs/cup.png", hash: "hash", reviewDecision: "NEEDS_REVIEW", reviewNote: null });
    expect(repository.reviewOutput(output.id, "SELECTED", "approved")?.reviewDecision).toBe("SELECTED");
    database.close();
  });
});
