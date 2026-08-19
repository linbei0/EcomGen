import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ options: undefined as { initialState?: { thinkingLevel?: string; model?: { compat?: Record<string, unknown>; reasoning?: boolean } } } | undefined, errorMessage: undefined as string | undefined }));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    public state = { messages: [] as Array<{ role: string; content: Array<{ type: string; text?: string }> }>, errorMessage: captured.errorMessage };

    public constructor(options: { initialState?: { thinkingLevel?: string } }) {
      captured.options = options;
    }

    public async prompt(): Promise<void> {
      if (captured.errorMessage) return;
      this.state.messages = [{ role: "assistant", content: [{ type: "text", text: JSON.stringify({ campaignStyleLock: "clean", items: [{ assetType: "hero-image", templateVariant: null, variantScope: "COMMON", mode: "CREATIVE", promptInstruction: "hero", factClaims: [], riskFlags: [], sortOrder: 0 }] }) }] }];
    }
  },
}));

vi.mock("@earendil-works/pi-ai/api/openai-completions.lazy", () => ({
  openAICompletionsApi: () => ({ stream: vi.fn() }),
}));

import { planStoryboard, type PlannerInput } from "./planner.js";

const input: PlannerInput = {
  model: {
    id: "model", name: "model", api: "openai-completions", provider: "provider" as never,
    baseUrl: "https://custom-gateway.example/v1", reasoning: true, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8_000,
    compat: { maxTokensField: "max_tokens", thinkingFormat: "qwen", supportsDeveloperRole: false },
  },
  apiKey: "secret",
  projectName: "tablet",
  productCategory: null,
  productDescription: null,
  verifiedFacts: [],
  prohibitedClaims: [],
  brandGuidelines: {},
  platformTargets: ["DOMESTIC"],
  defaultMode: "CREATIVE",
  variants: [],
  assets: [],
  requestedTypes: ["hero-image"],
};

describe("planStoryboard", () => {
  it("uses the pre-resolved Pi compatibility profile without inspecting the URL", async () => {
    captured.errorMessage = undefined;
    await planStoryboard(input);

    expect(captured.options?.initialState?.thinkingLevel).toBe("medium");
    expect(captured.options?.initialState?.model?.compat).toMatchObject({ maxTokensField: "max_tokens", thinkingFormat: "qwen", supportsDeveloperRole: false });
  });

  it("preserves the Agent error when no assistant text is produced", async () => {
    captured.errorMessage = "provider timed out";

    await expect(planStoryboard(input)).rejects.toThrow("provider timed out");

    captured.errorMessage = undefined;
  });
});
