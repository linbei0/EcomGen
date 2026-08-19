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
  it("已确认分镜一次提交全部 itemId", async () => {
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
    expect(await screen.findByRole("button", { name: "开始生成" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await waitFor(() => {
      expect(captured).toMatchObject({
        storyboardItemIds: [ITEM_ID, ITEM_ID_B],
      });
    });
  });

  it("失败任务可在结果区重试，不展示虚假百分比", async () => {
    const user = userEvent.setup();
    let retried = false;
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
            jobs: [
              {
                ...GENERATE_JOB_FIXTURE,
                status: "FAILED",
                progress: 30,
                retryable: true,
                error: { message: "生图失败", requestId: "gen-1" },
              },
            ],
            outputs: [],
          }),
        ),
      ),
      http.get(`${BASE}/projects/:projectId/storyboard`, () =>
        HttpResponse.json(storyboardPayload(confirmedBoard.storyboard, items)),
      ),
      http.get(`${BASE}/jobs/:jobId`, () =>
        HttpResponse.json({
          ...GENERATE_JOB_FIXTURE,
          status: "FAILED",
          progress: 30,
          retryable: true,
          error: { message: "生图失败", requestId: "gen-1" },
        }),
      ),
      http.post(`${BASE}/jobs/:jobId/retry`, () => {
        retried = true;
        return HttpResponse.json({
          ...GENERATE_JOB_FIXTURE,
          id: "eeeeeeee-ffff-4000-8111-222222222222",
          status: "QUEUED",
          progress: 0,
          retryable: false,
          error: null,
        });
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
    });
  });
});
