import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import {
  ITEM_ID,
  OUTPUT_B_FIXTURE,
  OUTPUT_FIXTURE,
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

describe("工作台 · 结果审核", () => {
  it("按中文分镜名分组，选入时双写 decision 与 reviewDecision", async () => {
    const user = userEvent.setup();
    let captured: unknown;
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
      http.patch(`${BASE}/outputs/:outputId/review`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ ...OUTPUT_FIXTURE, reviewDecision: "SELECTED" });
      }),
    );

    renderResults();
    expect(await screen.findByRole("heading", { name: /白底\/纯色底产品主图/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /场景化生活图/ })).toBeInTheDocument();
    expect(screen.queryByText("hero-image")).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "选入" })[0]!);
    await waitFor(() => {
      expect(captured).toMatchObject({ decision: "SELECTED", reviewDecision: "SELECTED" });
    });
  });

  it("无成图时引导回生成，不渲染假网格", async () => {
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(projectDetailPayload({ ...confirmed, outputs: [] })),
      ),
    );
    renderResults();
    expect(await screen.findByText("还没有成图")).toBeInTheDocument();
    expect(screen.queryByLabelText("选入")).not.toBeInTheDocument();
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
    await waitFor(() => {
      expect(captured).toMatchObject({ storyboardItemIds: [ITEM_ID], revision: "retry" });
    });
  });
});
