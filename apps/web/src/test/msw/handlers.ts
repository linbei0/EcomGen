import { http, HttpResponse } from "msw";

import {
  ASSET_FIXTURE,
  EXPORT_FIXTURE,
  EXPORT_JOB_FIXTURE,
  GENERATE_JOB_FIXTURE,
  OUTPUT_FIXTURE,
  PLAN_JOB_FIXTURE,
  PROJECT_FIXTURE,
  STORYBOARD_FIXTURE,
  STORYBOARD_ITEM_B_FIXTURE,
  STORYBOARD_ITEM_FIXTURE,
  TEMPLATE_FIXTURES,
  VARIANT_FIXTURE,
  projectDetailPayload,
  storyboardPayload,
} from "./fixtures";

/** 与 config/env.ts 的默认 API_BASE_URL 保持一致；测试只拦截该源。 */
export const BASE = "http://127.0.0.1:8787/api/v1";

export const PROVIDER_FIXTURE = {
  id: "7d0b0d1e-4b1c-4c2d-9a3e-2f5b6c7d8e9f",
  name: "OpenAI 官方",
  baseUrl: "https://api.openai.com/v1",
  hasApiKey: true,
  models: [
    {
      id: "gpt-4o",
      supportsVision: true,
      supportsTools: true,
      supportsStructuredOutput: true,
      imageApiKind: null,
    },
    {
      id: "gpt-image-1",
      supportsVision: false,
      supportsTools: false,
      supportsStructuredOutput: false,
      imageApiKind: "openai_images",
    },
  ],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

/** 严格按 docs/openapi.yaml 手写；契约变更时先改 handlers 再改组件。 */
export const handlers = [
  http.get("http://127.0.0.1:8787/health", () => HttpResponse.json({ status: "ok" })),

  http.get(`${BASE}/providers`, () =>
    HttpResponse.json({ items: [PROVIDER_FIXTURE], nextCursor: null }),
  ),

  http.post(`${BASE}/providers`, async ({ request }) => {
    const body = (await request.json()) as {
      name: string;
      baseUrl: string;
      models: unknown[];
    };
    return HttpResponse.json(
      {
        ...PROVIDER_FIXTURE,
        id: "11111111-2222-4333-8444-555555555555",
        name: body.name,
        baseUrl: body.baseUrl,
        models: body.models,
      },
      { status: 201 },
    );
  }),

  http.patch(`${BASE}/providers/:providerId`, async ({ request, params }) => {
    const body = (await request.json()) as { name: string; baseUrl: string; models: unknown[] };
    return HttpResponse.json({
      ...PROVIDER_FIXTURE,
      id: params.providerId as string,
      name: body.name,
      baseUrl: body.baseUrl,
      models: body.models,
    });
  }),

  http.delete(`${BASE}/providers/:providerId`, () => new HttpResponse(null, { status: 204 })),

  http.post(`${BASE}/providers/:providerId/test`, async ({ request, params }) => {
    const body = (await request.json()) as { modelId: string; kind?: "reasoning" | "image" };
    return HttpResponse.json({
      ok: true,
      providerId: params.providerId as string,
      modelId: body.modelId,
      kind: body.kind ?? "image",
      latencyMs: 87,
      modelAvailable: true,
    });
  }),

  http.get(`${BASE}/ecom-templates`, () => HttpResponse.json(TEMPLATE_FIXTURES)),

  http.get(`${BASE}/projects`, () => HttpResponse.json({ items: [], nextCursor: null })),

  http.post(`${BASE}/projects`, async ({ request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json({ ...PROJECT_FIXTURE, name: body.name }, { status: 201 });
  }),

  http.get(`${BASE}/projects/:projectId`, ({ params }) =>
    HttpResponse.json(projectDetailPayload({ id: params.projectId as string })),
  ),

  http.patch(`${BASE}/projects/:projectId`, async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...PROJECT_FIXTURE, id: params.projectId as string, ...body });
  }),

  http.delete(`${BASE}/assets/:assetId`, () => new HttpResponse(null, { status: 204 })),

  http.post(`${BASE}/projects/:projectId/variants`, async ({ request, params }) => {
    const body = (await request.json()) as { name: string; attributes?: Record<string, string> };
    return HttpResponse.json({
      ...VARIANT_FIXTURE,
      id: "22222222-3333-4444-8555-666666666666",
      projectId: params.projectId as string,
      name: body.name,
      attributes: body.attributes ?? {},
    });
  }),

  http.post(`${BASE}/projects/:projectId/assets`, ({ params }) =>
    HttpResponse.json({
      ...ASSET_FIXTURE,
      id: "33333333-4444-4555-8666-777777777777",
      projectId: params.projectId as string,
    }),
  ),

  http.get(`${BASE}/files/assets/:assetId`, () => new HttpResponse(new Uint8Array([137, 80, 78, 71]), {
    headers: { "Content-Type": "image/png" },
  })),

  http.post(`${BASE}/projects/:projectId/planning-jobs`, () =>
    HttpResponse.json({ ...PLAN_JOB_FIXTURE, status: "QUEUED", progress: 0 }),
  ),

  http.get(`${BASE}/jobs/:jobId`, ({ params }) =>
    HttpResponse.json({ ...PLAN_JOB_FIXTURE, id: params.jobId as string }),
  ),

  http.post(`${BASE}/jobs/:jobId/retry`, ({ params }) =>
    HttpResponse.json({
      ...PLAN_JOB_FIXTURE,
      id: "eeeeeeee-ffff-4000-8111-222222222222",
      requestFingerprint: `retry-${params.jobId as string}`,
      status: "QUEUED",
      progress: 0,
      retryable: false,
      error: null,
    }),
  ),

  http.get(`${BASE}/projects/:projectId/storyboard`, () =>
    HttpResponse.json(storyboardPayload()),
  ),

  http.patch(`${BASE}/storyboard-items/:itemId`, async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const current =
      params.itemId === STORYBOARD_ITEM_B_FIXTURE.id
        ? STORYBOARD_ITEM_B_FIXTURE
        : STORYBOARD_ITEM_FIXTURE;
    return HttpResponse.json({ ...current, ...body, id: params.itemId as string });
  }),

  http.post(`${BASE}/projects/:projectId/storyboard/confirm`, () =>
    HttpResponse.json({ ...STORYBOARD_FIXTURE, status: "CONFIRMED" }),
  ),

  http.post(`${BASE}/projects/:projectId/generation-jobs`, async ({ request }) => {
    const body = (await request.json()) as { storyboardItemIds: string[] };
    return HttpResponse.json(
      {
        jobs: body.storyboardItemIds.map((itemId, index) => ({
          ...GENERATE_JOB_FIXTURE,
          id: `ffffffff-0000-4111-8222-33333333333${index}`,
          storyboardItemId: itemId,
        })),
      },
      { status: 202 },
    );
  }),

  http.post(`${BASE}/jobs/:jobId/cancel`, ({ params }) =>
    HttpResponse.json({
      ...GENERATE_JOB_FIXTURE,
      id: params.jobId as string,
      cancelRequested: true,
    }),
  ),

  http.get(`${BASE}/files/outputs/:outputId`, () =>
    new HttpResponse(new Uint8Array([137, 80, 78, 71]), {
      headers: { "Content-Type": "image/png" },
    }),
  ),

  http.patch(`${BASE}/outputs/:outputId/review`, async ({ request, params }) => {
    const body = (await request.json()) as { reviewDecision?: string; decision?: string; reviewNote?: string | null };
    const decision = body.reviewDecision ?? body.decision ?? "NEEDS_REVIEW";
    return HttpResponse.json({
      ...OUTPUT_FIXTURE,
      id: params.outputId as string,
      reviewDecision: decision,
      reviewNote: body.reviewNote ?? null,
    });
  }),

  http.post(`${BASE}/projects/:projectId/export-jobs`, async ({ request }) => {
    const body = (await request.json()) as { outputIds?: string[] };
    return HttpResponse.json(
      { job: EXPORT_JOB_FIXTURE, export: { ...EXPORT_FIXTURE, input: body.outputIds } },
      { status: 202 },
    );
  }),

  http.get(`${BASE}/exports/:exportId`, ({ params }) =>
    HttpResponse.json({ ...EXPORT_FIXTURE, id: params.exportId as string }),
  ),

  http.get(`${BASE}/files/exports/:exportId`, () =>
    new HttpResponse(new Uint8Array([80, 75, 3, 4]), {
      headers: { "Content-Type": "application/zip" },
    }),
  ),
];
