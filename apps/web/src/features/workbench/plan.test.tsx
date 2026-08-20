import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { PLAN_JOB_FIXTURE, PROJECT_ID, projectDetailPayload } from "../../test/msw/fixtures";
import { BASE } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithProviders } from "../../test/render";
import { WorkbenchPage } from "./WorkbenchPage";

function renderSetup() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId" element={<WorkbenchPage />} />
    </Routes>,
    { initialEntries: [`/projects/${PROJECT_ID}?view=setup`] },
  );
}

describe("工作台 · 规划", () => {
  it("手动选择后提交规划方式和 requestedTypes", async () => {
    const user = userEvent.setup();
    let captured: unknown;
    server.use(
      http.get(`${BASE}/projects/:projectId`, () => HttpResponse.json(projectDetailPayload())),
      http.post(`${BASE}/projects/:projectId/planning-jobs`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ ...PLAN_JOB_FIXTURE, status: "QUEUED", progress: 8 });
      }),
    );

    renderSetup();
    expect(await screen.findByDisplayValue("无线耳机 SPU")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "手动选择" }));
    await user.click(await screen.findByRole("button", { name: "白底/纯色底产品主图" }));
    await user.click(screen.getByRole("button", { name: "生成分镜" }));

    await waitFor(() => {
      expect(captured).toMatchObject({
        planningMode: "MANUAL",
        imageTypes: ["hero-image"],
        requestedTypes: ["hero-image"],
        candidatesPerType: 1,
        imageResolution: "1K",
        imageAspectRatio: "AUTO",
      });
    });
    expect(await screen.findByText("排队中")).toBeInTheDocument();
  });

  it("AI 智能规划不提交手动选择的图片类型", async () => {
    const user = userEvent.setup();
    let captured: Record<string, unknown> | undefined;
    server.use(
      http.get(`${BASE}/projects/:projectId`, () => HttpResponse.json(projectDetailPayload())),
      http.post(`${BASE}/projects/:projectId/planning-jobs`, async ({ request }) => {
        captured = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ...PLAN_JOB_FIXTURE, status: "QUEUED", progress: 8 });
      }),
    );

    renderSetup();
    await screen.findByDisplayValue("无线耳机 SPU");
    await user.click(screen.getByRole("button", { name: "手动选择" }));
    await user.click(await screen.findByRole("button", { name: "白底/纯色底产品主图" }));
    await user.click(screen.getByRole("button", { name: "AI 智能规划" }));
    await user.click(screen.getByRole("button", { name: "生成分镜" }));

    await waitFor(() => expect(captured).toMatchObject({ planningMode: "AI" }));
    expect(captured).not.toHaveProperty("requestedTypes");
    expect(captured).not.toHaveProperty("imageTypes");
  });

  it("搜索服务可用时保存联网视觉研究开关", async () => {
    const user = userEvent.setup();
    let patch: Record<string, unknown> | undefined;
    server.use(
      http.get("http://127.0.0.1:8787/health", () => HttpResponse.json({ status: "ok", webResearchAvailable: true })),
      http.get(`${BASE}/projects/:projectId`, () => HttpResponse.json(projectDetailPayload())),
      http.patch(`${BASE}/projects/:projectId`, async ({ request }) => {
        patch = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ ...projectDetailPayload(), ...patch });
      }),
    );

    renderSetup();
    const toggle = await screen.findByRole("switch", { name: "联网视觉研究" });
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);
    await waitFor(() => expect(patch).toEqual({ webResearchEnabled: true }));
  });

  it("失败任务展示错误并可重试", async () => {
    const user = userEvent.setup();
    let retried = false;
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(
          projectDetailPayload({
            jobs: [
              {
                ...PLAN_JOB_FIXTURE,
                status: "FAILED",
                progress: 40,
                retryable: true,
                error: { message: "模型超时", requestId: "req-9" },
              },
            ],
          }),
        ),
      ),
      http.get(`${BASE}/jobs/:jobId`, () =>
        HttpResponse.json({
          ...PLAN_JOB_FIXTURE,
          status: "FAILED",
          progress: 40,
          retryable: true,
          error: { message: "模型超时", requestId: "req-9" },
        }),
      ),
      http.post(`${BASE}/jobs/:jobId/retry`, () => {
        retried = true;
        return HttpResponse.json({
          ...PLAN_JOB_FIXTURE,
          id: "eeeeeeee-ffff-4000-8111-222222222222",
          status: "QUEUED",
          progress: 0,
          retryable: false,
          error: null,
        });
      }),
    );

    renderSetup();
    expect(await screen.findByText("模型超时（请求 ID：req-9）")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试规划" }));
    await waitFor(() => {
      expect(retried).toBe(true);
    });
  });

  it("像素保护且无产品图时给出失败提示", async () => {
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(projectDetailPayload({ defaultMode: "PIXEL_PROTECTED", assets: [] })),
      ),
    );
    renderSetup();
    expect(await screen.findByText("像素保护需要至少一张产品图，否则生成会失败。")).toBeInTheDocument();
  });
});
