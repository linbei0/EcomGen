import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import {
  PLAN_JOB_FIXTURE,
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

function renderBoard() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId" element={<WorkbenchPage />} />
    </Routes>,
    { initialEntries: [`/projects/${PROJECT_ID}?view=storyboard`] },
  );
}

const detailWithBoard = projectDetailPayload({
  storyboard: STORYBOARD_FIXTURE,
  items: [STORYBOARD_ITEM_FIXTURE, STORYBOARD_ITEM_B_FIXTURE],
});

describe("工作台 · 分镜", () => {
  it("规划完成后停留在分镜页会自动刷新卡片", async () => {
    let completed = false;
    const emptyDetail = projectDetailPayload({
      jobs: [{ ...PLAN_JOB_FIXTURE, status: "RUNNING", progress: 90 }],
    });
    const completedDetail = projectDetailPayload({
      storyboard: STORYBOARD_FIXTURE,
      items: [STORYBOARD_ITEM_FIXTURE, STORYBOARD_ITEM_B_FIXTURE],
      jobs: [{ ...PLAN_JOB_FIXTURE, status: "SUCCEEDED", progress: 100 }],
    });
    server.use(
      http.get(`${BASE}/projects/:projectId`, () => HttpResponse.json(completed ? completedDetail : emptyDetail)),
      http.get(`${BASE}/projects/:projectId/storyboard`, () =>
        HttpResponse.json(completed ? storyboardPayload() : storyboardPayload(null, [])),
      ),
      http.get(`${BASE}/jobs/:jobId`, () => {
        completed = true;
        return HttpResponse.json({ ...PLAN_JOB_FIXTURE, status: "SUCCEEDED", progress: 100 });
      }),
    );

    renderBoard();
    expect(await screen.findByText("还没有分镜")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "白底/纯色底产品主图 分镜" })).toBeInTheDocument();
  });

  it("卡片显示中文名称，点击后弹窗编辑", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${BASE}/projects/:projectId`, () => HttpResponse.json(detailWithBoard)),
      http.get(`${BASE}/projects/:projectId/storyboard`, () =>
        HttpResponse.json(storyboardPayload()),
      ),
    );
    renderBoard();
    expect(await screen.findByRole("button", { name: "白底/纯色底产品主图 分镜" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "场景化生活图 分镜" })).toBeInTheDocument();
    expect(screen.queryByText("hero-image")).not.toBeInTheDocument();
    expect(screen.queryByText("通用")).not.toBeInTheDocument();
    expect(screen.getByLabelText("1 条风险")).toBeInTheDocument();
    expect(screen.getByText("2 个分镜 · 预计 2 张候选")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "白底/纯色底产品主图 分镜" }));
    expect(await screen.findByDisplayValue("白底主图，突出金属质感")).toBeInTheDocument();
    expect(screen.getAllByText("续航 8 小时").length).toBeGreaterThanOrEqual(1);
  });

  it("确认 409 时提示冲突并重新拉取分镜", async () => {
    const user = userEvent.setup();
    let storyboardGets = 0;
    server.use(
      http.get(`${BASE}/projects/:projectId`, () => HttpResponse.json(detailWithBoard)),
      http.get(`${BASE}/projects/:projectId/storyboard`, () => {
        storyboardGets += 1;
        return HttpResponse.json(storyboardPayload());
      }),
      http.post(`${BASE}/projects/:projectId/storyboard/confirm`, () =>
        HttpResponse.json(
          {
            error: {
              code: "CONFLICT",
              message: "A draft storyboard must exist before confirmation",
              requestId: "req-409",
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderBoard();
    await screen.findByRole("button", { name: "确认并生成" });
    const before = storyboardGets;
    await user.click(screen.getByRole("button", { name: "确认并生成" }));
    expect(await screen.findByText("分镜已被其他操作更新")).toBeInTheDocument();
    await waitFor(() => {
      expect(storyboardGets).toBeGreaterThan(before);
    });
  });
});
