export const PROVIDER_ID = "7d0b0d1e-4b1c-4c2d-9a3e-2f5b6c7d8e9f";
export const PROJECT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
export const ASSET_ID = "99999999-8888-4777-8666-555555555555";
export const PLAN_JOB_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
export const GENERATE_JOB_ID = "ffffffff-aaaa-4bbb-8ccc-dddddddddddd";
export const ITEM_ID = "cccccccc-dddd-4eee-8fff-000000000000";
export const ITEM_ID_B = "dddddddd-eeee-4fff-8000-111111111111";

export const EMPTY_COVER = {
  productAssetId: null,
  coverOutputId: null,
  previewOutputIds: [] as string[],
  outputCount: 0,
};

export const PROJECT_FIXTURE = {
  id: PROJECT_ID,
  name: "无线耳机 SPU",
  category: "消费电子",
  productDescription: "入耳式降噪耳机",
  verifiedFacts: ["续航 8 小时"],
  prohibitedClaims: ["医用级"],
  brandGuidelines: {},
  platformTargets: ["DOMESTIC"] as ("DOMESTIC" | "AMAZON")[],
  targetMarket: null,
  copyLanguage: null,
  reasoningProviderId: PROVIDER_ID,
  reasoningModelId: "gpt-4o",
  imageProviderId: PROVIDER_ID,
  imageModelId: "gpt-image-1",
  defaultMode: "CREATIVE" as const,
  imageResolution: "1K" as const,
  imageAspectRatio: "AUTO" as const,
  candidatesPerType: 1,
  webResearchEnabled: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  cover: EMPTY_COVER,
};

export const ASSET_FIXTURE = {
  id: ASSET_ID,
  projectId: PROJECT_ID,
  role: "PRODUCT_TRUTH" as const,
  kind: "PRODUCT" as const,
  storagePath: `projects/${PROJECT_ID}/assets/${ASSET_ID}.png`,
  hash: "abc",
  originalName: "product.png",
  mimeType: "image/png",
  width: 1024,
  height: 1024,
  createdAt: "2026-08-01T00:00:00.000Z",
};

export const TEMPLATE_FIXTURES = {
  source: {
    repository: "https://github.com/liangdabiao/ecom-details-image",
    commit: "1ec867b743179af3598db55388f65287c4e04de1",
    sourcePath: "packages/ecom-skill/src/templates",
  },
  items: [
    {
      id: "hero-image",
      upstreamNumber: 1,
      name: "白底/纯色底产品主图",
      keywords: ["主图"],
      trigger_phrases: ["产品主图", "白底图"],
      prompt_template: { zh: "白底产品主图" },
      defaults: {},
      variants: {},
      category_tips: { electronics: "突出机身轮廓与接口" },
      defaultSize: "1024x1024" as const,
    },
    {
      id: "lifestyle-scene",
      upstreamNumber: 2,
      name: "场景化生活图",
      keywords: ["场景"],
      trigger_phrases: ["场景图", "生活图"],
      prompt_template: { zh: "生活场景" },
      defaults: {},
      variants: {},
      category_tips: { beauty: "自然光与使用瞬间" },
      defaultSize: "1024x1024" as const,
    },
    {
      id: "flat-lay",
      upstreamNumber: 3,
      name: "平铺图",
      keywords: ["平铺"],
      trigger_phrases: ["平铺图", "俯拍"],
      prompt_template: { zh: "俯拍平铺" },
      defaults: {},
      variants: {},
      category_tips: { food: "保持器皿比例" },
      defaultSize: "1024x1024" as const,
    },
  ],
};

export const PLAN_JOB_FIXTURE = {
  id: PLAN_JOB_ID,
  projectId: PROJECT_ID,
  storyboardItemId: null,
  type: "PLAN" as const,
  status: "QUEUED" as const,
  progress: 0,
  retryable: false,
  input: { requestedTypes: ["hero-image"], planningMode: "AI" },
  requestFingerprint: "fp-plan",
  providerId: PROVIDER_ID,
  modelId: "gpt-4o",
  estimatedCost: { status: "UNKNOWN", unit: "provider-defined" },
  actualCost: null,
  cancelRequested: false,
  error: null,
  createdAt: "2026-08-01T00:10:00.000Z",
  updatedAt: "2026-08-01T00:10:00.000Z",
};

export const COPYWRITING_JOB_FIXTURE = {
  ...PLAN_JOB_FIXTURE,
  id: "abababab-bcbc-4dcd-8eee-ffffffffffff",
  type: "COPYWRITE" as const,
  input: { target: "PRODUCT_DESCRIPTION", regenerationKey: "mock-copywriting" },
  requestFingerprint: "fp-copywriting",
};

export const GENERATE_JOB_FIXTURE = {
  id: GENERATE_JOB_ID,
  projectId: PROJECT_ID,
  storyboardItemId: ITEM_ID,
  type: "GENERATE" as const,
  status: "QUEUED" as const,
  progress: 0,
  retryable: false,
  input: {},
  requestFingerprint: "fp-gen",
  providerId: PROVIDER_ID,
  modelId: "gpt-image-1",
  estimatedCost: { status: "UNKNOWN", unit: "provider-defined" },
  actualCost: null,
  cancelRequested: false,
  error: null,
  createdAt: "2026-08-01T00:20:00.000Z",
  updatedAt: "2026-08-01T00:20:00.000Z",
};

export const OUTPUT_ID = "eeeeeeee-1111-4222-8333-444444444444";
export const OUTPUT_ID_B = "eeeeeeee-1111-4222-8333-555555555555";
export const EXPORT_ID = "12121212-3434-4565-8787-909090909090";

export const OUTPUT_FIXTURE = {
  id: OUTPUT_ID,
  projectId: PROJECT_ID,
  storyboardItemId: ITEM_ID,
  jobId: GENERATE_JOB_ID,
  storagePath: `projects/${PROJECT_ID}/outputs/${OUTPUT_ID}.png`,
  hash: "out-a",
  candidateIndex: 1,
  createdAt: "2026-08-01T00:30:00.000Z",
};

export const OUTPUT_B_FIXTURE = {
  ...OUTPUT_FIXTURE,
  id: OUTPUT_ID_B,
  storyboardItemId: ITEM_ID_B,
  hash: "out-b",
  createdAt: "2026-08-01T00:31:00.000Z",
};

export const EXPORT_JOB_FIXTURE = {
  id: "34343434-4545-4676-8987-101010101010",
  projectId: PROJECT_ID,
  storyboardItemId: null,
  type: "EXPORT" as const,
  status: "QUEUED" as const,
  progress: 0,
  retryable: false,
  input: { outputIds: [OUTPUT_ID] },
  requestFingerprint: "fp-export",
  providerId: null,
  modelId: null,
  estimatedCost: { status: "UNKNOWN", unit: "local-storage" },
  actualCost: null,
  cancelRequested: false,
  error: null,
  createdAt: "2026-08-01T00:40:00.000Z",
  updatedAt: "2026-08-01T00:40:00.000Z",
};

export const EXPORT_FIXTURE = {
  id: EXPORT_ID,
  projectId: PROJECT_ID,
  jobId: EXPORT_JOB_FIXTURE.id,
  status: "QUEUED" as const,
  storagePath: null,
  createdAt: "2026-08-01T00:40:00.000Z",
};

export const STORYBOARD_FIXTURE = {
  projectId: PROJECT_ID,
  version: 1,
  status: "DRAFT" as const,
  campaignStyleLock: "冷白金属",
  createdAt: "2026-08-01T00:12:00.000Z",
  updatedAt: "2026-08-01T00:12:00.000Z",
};

export const STORYBOARD_ITEM_FIXTURE = {
  id: ITEM_ID,
  projectId: PROJECT_ID,
  storyboardVersion: 1,
  assetType: "hero-image",
  displayName: "白底/纯色底产品主图",
  templateVariant: null,
  candidateCount: 1,
  imageProviderId: PROVIDER_ID,
  imageModelId: "gpt-image-1",
  imageResolution: "1K" as const,
  imageAspectRatio: "AUTO" as const,
  referencedAssets: [] as string[],
  mode: "CREATIVE" as const,
  status: "DRAFT" as const,
  promptInstruction: "白底主图，突出金属质感",
  compiledPrompt: null,
  factClaims: ["续航 8 小时"],
  riskFlags: [] as string[],
  sortOrder: 0,
  createdAt: "2026-08-01T00:12:00.000Z",
  updatedAt: "2026-08-01T00:12:00.000Z",
};

export const STORYBOARD_ITEM_B_FIXTURE = {
  ...STORYBOARD_ITEM_FIXTURE,
  id: ITEM_ID_B,
  assetType: "lifestyle-scene",
  displayName: "场景化生活图",
  mode: "PIXEL_PROTECTED" as const,
  promptInstruction: "生活场景，保留主体像素",
  factClaims: [] as string[],
  riskFlags: ["缺少产品图"],
  sortOrder: 1,
};

export function storyboardPayload(
  storyboard: Record<string, unknown> | null = STORYBOARD_FIXTURE,
  items: unknown[] = [STORYBOARD_ITEM_FIXTURE, STORYBOARD_ITEM_B_FIXTURE],
) {
  return { storyboard, items };
}

export function projectDetailPayload(overrides: Record<string, unknown> = {}) {
  return {
    ...PROJECT_FIXTURE,
    assets: [ASSET_FIXTURE],
    storyboard: undefined,
    items: [],
    outputs: [],
    jobs: [],
    ...overrides,
  };
}
