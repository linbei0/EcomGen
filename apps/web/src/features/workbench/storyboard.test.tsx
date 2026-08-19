import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import {
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
