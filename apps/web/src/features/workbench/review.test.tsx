import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import {
  ITEM_ID,
  OUTPUT_B_FIXTURE,
  OUTPUT_FIXTURE,
  OUTPUT_ID,
  PROJECT_ID,
  PROVIDER_ID,
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

const confirmed = {
  storyboard: { ...STORYBOARD_FIXTURE, status: "CONFIRMED" as const },
  items: [
    { ...STORYBOARD_ITEM_FIXTURE, status: "GENERATED" as const },
    { ...STORYBOARD_ITEM_B_FIXTURE, status: "GENERATED" as const },
  ],
};

function renderResults() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId" element={<WorkbenchPage />} />
    </Routes>,
    { initialEntries: [`/projects/${PROJECT_ID}?view=results`] },
  );
}

describe("工作台 · 结果", () => {
  it("按中文分镜名分组，每张成图提供单图下载入口", async () => {
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(
          projectDetailPayload({
            ...confirmed,
            outputs: [OUTPUT_FIXTURE, OUTPUT_B_FIXTURE],
          }),
        ),
      ),
      http.get(`${BASE}/projects/:projectId/storyboard`, () =>
        HttpResponse.json(storyboardPayload(confirmed.storyboard, confirmed.items)),
      ),
    );

    renderResults();
    expect(await screen.findByRole("heading", { name: /白底\/纯色底产品主图/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /场景化生活图/ })).toBeInTheDocument();
    expect(screen.queryByText("hero-image")).not.toBeInTheDocument();
    const downloadButtons = await screen.findAllByRole("button", { name: "下载原图" });
    expect(downloadButtons).toHaveLength(2);
  });

  it("无成图时引导回生成，不渲染假网格", async () => {
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(projectDetailPayload({ ...confirmed, outputs: [] })),
      ),
    );
    renderResults();
    expect(await screen.findByText("还没有成图")).toBeInTheDocument();
  });

  it("灯箱可重新生成该分镜", async () => {
    const user = userEvent.setup();
    let captured: unknown;
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(
          projectDetailPayload({
            ...confirmed,
            outputs: [OUTPUT_FIXTURE],
          }),
        ),
      ),
      http.get(`${BASE}/projects/:projectId/storyboard`, () =>
        HttpResponse.json(storyboardPayload(confirmed.storyboard, confirmed.items)),
      ),
      http.post(`${BASE}/projects/:projectId/generation-jobs`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ jobs: [] }, { status: 202 });
      }),
    );
    renderResults();
    await user.click(await screen.findByRole("button", { name: "灯箱" }));
    await user.click(await screen.findByRole("button", { name: "用此分镜重新生成" }));
    expect(await screen.findByText("重新生成配置")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "开始生成" }));
    await waitFor(() => {
      expect(captured).toMatchObject({
        storyboardItemIds: [ITEM_ID],
        revision: "retry",
        generationConfig: {
          imageResolution: "1K",
          imageAspectRatio: "AUTO",
          candidateCount: 1,
          imageModel: { providerId: PROVIDER_ID, modelId: "gpt-image-1" },
        },
      });
    });
  });

  it("编辑版本关系画布提供单图下载按钮", async () => {
    const user = userEvent.setup();
    const edited = {
      ...OUTPUT_FIXTURE,
      id: "eeeeeeee-1111-4222-8333-666666666666",
      parentOutputId: OUTPUT_ID,
      rootOutputId: OUTPUT_ID,
      editSessionId: "edit-session-1",
      editTurnId: "edit-turn-1",
    };
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(projectDetailPayload({ ...confirmed, outputs: [OUTPUT_FIXTURE, edited] })),
      ),
      http.get(`${BASE}/projects/:projectId/storyboard`, () =>
        HttpResponse.json(storyboardPayload(confirmed.storyboard, confirmed.items)),
      ),
    );
    renderResults();
    await user.click(await screen.findByRole("button", { name: "查看 1 个编辑版本" }));
    expect(await screen.findByRole("button", { name: "下载 V2" })).toBeInTheDocument();
  });
});
