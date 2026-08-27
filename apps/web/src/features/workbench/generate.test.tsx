import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import {
  GENERATE_JOB_FIXTURE,
  ITEM_ID,
  ITEM_ID_B,
  PROJECT_ID,
  STORYBOARD_FIXTURE,
  STORYBOARD_ITEM_B_FIXTURE,
  STORYBOARD_ITEM_FIXTURE,
  projectDetailPayload,
  storyboardPayload,
} from "../../test/msw/fixtures";
import { BASE } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithProviders } from "../../test/render";
import { WorkbenchPage } from "./WorkbenchPage";

const confirmedBoard = {
  storyboard: { ...STORYBOARD_FIXTURE, status: "CONFIRMED" as const },
  items: [
    { ...STORYBOARD_ITEM_FIXTURE, status: "CONFIRMED" as const },
    { ...STORYBOARD_ITEM_B_FIXTURE, status: "CONFIRMED" as const },
  ],
};

function renderBoard() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId" element={<WorkbenchPage />} />
    </Routes>,
    { initialEntries: [`/projects/${PROJECT_ID}?view=storyboard`] },
  );
}

describe("工作台 · 确认并生成", () => {
  it("全选后可一次提交全部 itemId", async () => {
    const user = userEvent.setup();
    let captured: unknown;
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(
          projectDetailPayload({
            storyboard: confirmedBoard.storyboard,
            items: confirmedBoard.items,
          }),
        ),
      ),
      http.get(`${BASE}/projects/:projectId/storyboard`, () =>
        HttpResponse.json(storyboardPayload(confirmedBoard.storyboard, confirmedBoard.items)),
      ),
      http.post(`${BASE}/projects/:projectId/generation-jobs`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(
          {
            jobs: [
              { ...GENERATE_JOB_FIXTURE, storyboardItemId: ITEM_ID },
              { ...GENERATE_JOB_FIXTURE, id: "ffffffff-0000-4111-8222-333333333333", storyboardItemId: ITEM_ID_B },
            ],
          },
          { status: 202 },
        );
      }),
    );

    renderBoard();
    expect(await screen.findByRole("button", { name: "全选" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "全选" }));
    await user.click(screen.getByRole("button", { name: "确认并生成" }));
    await waitFor(() => {
      expect(captured).toMatchObject({
        storyboardItemIds: [ITEM_ID, ITEM_ID_B],
      });
    });
  });

  it("已确认分镜只提交勾选的 itemId", async () => {
    const user = userEvent.setup();
    let captured: unknown;
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(
          projectDetailPayload({
            storyboard: confirmedBoard.storyboard,
            items: confirmedBoard.items,
          }),
        ),
      ),
      http.get(`${BASE}/projects/:projectId/storyboard`, () =>
        HttpResponse.json(storyboardPayload(confirmedBoard.storyboard, confirmedBoard.items)),
      ),
      http.post(`${BASE}/projects/:projectId/generation-jobs`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ jobs: [{ ...GENERATE_JOB_FIXTURE, storyboardItemId: ITEM_ID }] }, { status: 202 });
      }),
    );

    renderBoard();
    await user.click(await screen.findByRole("checkbox", { name: "选择白底/纯色底产品主图" }));
    await user.click(screen.getByRole("button", { name: "确认并生成" }));
    await waitFor(() => {
      expect(captured).toMatchObject({ storyboardItemIds: [ITEM_ID] });
    });
  });

  it("失败任务可在结果区重试且原卡片消失，不展示虚假百分比", async () => {
    const user = userEvent.setup();
    let retried = false;
    const failedJob = {
      ...GENERATE_JOB_FIXTURE,
      status: "FAILED" as const,
      progress: 30,
      retryable: true,
      error: { message: "生图失败", requestId: "gen-1" },
    };
    const items = [
      { ...STORYBOARD_ITEM_FIXTURE, status: "GENERATED" as const },
      { ...STORYBOARD_ITEM_B_FIXTURE, status: "CONFIRMED" as const },
    ];
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(
          projectDetailPayload({
            storyboard: confirmedBoard.storyboard,
            items,
            // 与真实 retry 端点契约一致：原失败任务被标记 CANCELLED，替换为新的 QUEUED 重试任务
            jobs: retried
              ? [
                  { ...failedJob, status: "CANCELLED" as const, cancelRequested: true, retryable: false },
                  { ...failedJob, id: "eeeeeeee-ffff-4000-8111-222222222222", status: "QUEUED" as const, progress: 0, retryable: false, error: null },
                ]
              : [failedJob],
            outputs: [],
          }),
        ),
      ),
      http.get(`${BASE}/projects/:projectId/storyboard`, () =>
        HttpResponse.json(storyboardPayload(confirmedBoard.storyboard, items)),
      ),
      http.post(`${BASE}/jobs/:jobId/retry`, () => {
        retried = true;
        return HttpResponse.json({ ...failedJob, id: "eeeeeeee-ffff-4000-8111-222222222222", status: "QUEUED", progress: 0, retryable: false, error: null });
      }),
    );

    renderWithProviders(
      <Routes>
        <Route path="/projects/:projectId" element={<WorkbenchPage />} />
      </Routes>,
      { initialEntries: [`/projects/${PROJECT_ID}?view=results`] },
    );
    expect(await screen.findByText("生图失败（请求 ID：gen-1）")).toBeInTheDocument();
    expect(screen.queryByText("30%")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试生成" }));
    await waitFor(() => {
      expect(retried).toBe(true);
      expect(screen.queryByText("生图失败（请求 ID：gen-1）")).not.toBeInTheDocument();
    });
  });

  it("失败任务可关闭，不再常驻结果区", async () => {
    const user = userEvent.setup();
    let closed = false;
    const failedJob = {
      ...GENERATE_JOB_FIXTURE,
      status: "FAILED" as const,
      progress: 30,
      retryable: true,
      error: { message: "生图失败", requestId: "gen-1" },
    };
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(projectDetailPayload({
          storyboard: confirmedBoard.storyboard,
          items: confirmedBoard.items,
          jobs: closed ? [{ ...failedJob, status: "CANCELLED" as const, cancelRequested: true }] : [failedJob],
          outputs: [],
        })),
      ),
      http.post(`${BASE}/jobs/:jobId/cancel`, () => {
        closed = true;
        return HttpResponse.json({ ...failedJob, status: "CANCELLED", cancelRequested: true });
      }),
    );

    renderWithProviders(
      <Routes>
        <Route path="/projects/:projectId" element={<WorkbenchPage />} />
      </Routes>,
      { initialEntries: [`/projects/${PROJECT_ID}?view=results`] },
    );
    expect(await screen.findByText("生图失败（请求 ID：gen-1）")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭失败提示" }));
    await waitFor(() => {
      expect(screen.queryByText("生图失败（请求 ID：gen-1）")).not.toBeInTheDocument();
    });
  });
});
