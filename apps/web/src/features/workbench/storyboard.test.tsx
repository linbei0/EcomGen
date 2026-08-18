import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import {
  ITEM_ID,
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
    { initialEntries: [`/projects/${PROJECT_ID}?stage=storyboard&item=${ITEM_ID}`] },
  );
}

const detailWithBoard = projectDetailPayload({
  storyboard: STORYBOARD_FIXTURE,
  items: [STORYBOARD_ITEM_FIXTURE, STORYBOARD_ITEM_B_FIXTURE],
});

describe("工作台 · 分镜阶段", () => {
  it("渲染分镜卡、变体范围与风险角标", async () => {
    server.use(
      http.get(`${BASE}/projects/:projectId`, () => HttpResponse.json(detailWithBoard)),
      http.get(`${BASE}/projects/:projectId/storyboard`, () =>
        HttpResponse.json(storyboardPayload()),
      ),
    );
    renderBoard();
    expect(await screen.findByText("hero-image")).toBeInTheDocument();
    expect(screen.getByText("lifestyle-scene")).toBeInTheDocument();
    expect(screen.getByText("通用")).toBeInTheDocument();
    expect(screen.getAllByText("黑色").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("1 条风险")).toBeInTheDocument();
    expect(screen.getByText("2 个分镜 · 创意 1 / 像素保护 1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("白底主图，突出金属质感")).toBeInTheDocument();
    expect(screen.getByText("续航 8 小时")).toBeInTheDocument();
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
    await screen.findByRole("button", { name: "确认分镜" });
    const before = storyboardGets;
    await user.click(screen.getByRole("button", { name: "确认分镜" }));
    expect(await screen.findByText("分镜已被其他操作更新")).toBeInTheDocument();
    await waitFor(() => {
      expect(storyboardGets).toBeGreaterThan(before);
    });
  });
});
