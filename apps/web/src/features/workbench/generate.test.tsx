import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { COST_UNKNOWN_TEXT } from "../../lib/cost";
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

function renderGenerate() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId" element={<WorkbenchPage />} />
    </Routes>,
    { initialEntries: [`/projects/${PROJECT_ID}?stage=generate`] },
  );
}

describe("工作台 · 生成阶段", () => {
  it("确认弹窗数量等于勾选项，费用未知，提交显式 storyboardItemIds", async () => {
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

    renderGenerate();
    expect(await screen.findByRole("heading", { name: "无线耳机 SPU" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /生成 2 张/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全选未生成" }));
    expect(await screen.findByRole("button", { name: "生成 2 张" })).toBeInTheDocument();
    expect(screen.getByText(COST_UNKNOWN_TEXT)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "生成 2 张" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认生成 2 张" })).toBeInTheDocument();
    expect(screen.getAllByText(COST_UNKNOWN_TEXT).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("作为修订重新出图")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认生成 2 张" }));
    await waitFor(() => {
      expect(captured).toMatchObject({
        storyboardItemIds: [ITEM_ID, ITEM_ID_B].sort(),
      });
    });
    expect((captured as { revision?: string }).revision).toBeUndefined();
  });

  it("含已生成分镜时出现修订选项，失败任务可重试", async () => {
    const user = userEvent.setup();
    let captured: unknown;
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
      http.post(`${BASE}/projects/:projectId/generation-jobs`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ jobs: [GENERATE_JOB_FIXTURE] }, { status: 202 });
      }),
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

    renderGenerate();
    expect(await screen.findByText("生图失败（请求 ID：gen-1）")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试生成" }));
    await waitFor(() => {
      expect(retried).toBe(true);
    });

    await user.click(screen.getByRole("checkbox", { name: "选择 hero-image" }));
    await user.click(screen.getByRole("button", { name: "生成 1 张" }));
    expect(await screen.findByLabelText("作为修订重新出图")).toBeInTheDocument();
    await user.click(screen.getByLabelText("作为修订重新出图"));
    await user.type(screen.getByLabelText("修订说明"), "换冷白");
    await user.click(screen.getByRole("button", { name: "确认生成 1 张" }));
    await waitFor(() => {
      expect(captured).toMatchObject({
        storyboardItemIds: [ITEM_ID],
        revision: "换冷白",
      });
    });
  });
});
