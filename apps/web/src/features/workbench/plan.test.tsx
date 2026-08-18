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

function renderPlan() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId" element={<WorkbenchPage />} />
    </Routes>,
    { initialEntries: [`/projects/${PROJECT_ID}?stage=plan`] },
  );
}

describe("工作台 · 规划阶段", () => {
  it("提交规划时双写 imageTypes 与 requestedTypes", async () => {
    const user = userEvent.setup();
    let captured: unknown;
    server.use(
      http.get(`${BASE}/projects/:projectId`, () => HttpResponse.json(projectDetailPayload())),
      http.post(`${BASE}/projects/:projectId/planning-jobs`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ ...PLAN_JOB_FIXTURE, status: "QUEUED", progress: 8 });
      }),
    );

    renderPlan();
    expect(await screen.findByDisplayValue("无线耳机 SPU")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "白底/纯色底产品主图" }));
    await user.click(screen.getByRole("button", { name: "开始规划" }));

    await waitFor(() => {
      expect(captured).toMatchObject({
        imageTypes: ["hero-image"],
        requestedTypes: ["hero-image"],
        allowAgentRecommendations: true,
      });
    });
    expect(await screen.findByText("Pi 正在规划分镜")).toBeInTheDocument();
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

    renderPlan();
    expect(await screen.findByText("模型超时（请求 ID：req-9）")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试规划" }));
    await waitFor(() => {
      expect(retried).toBe(true);
    });
  });

  it("无素材时提示像素保护需要真实性图", async () => {
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(projectDetailPayload({ assets: [] })),
      ),
    );
    renderPlan();
    expect(
      await screen.findByText("未上传素材也可以规划，但像素保护分镜需要 PRODUCT_TRUTH 素材才能生成。"),
    ).toBeInTheDocument();
  });
});
