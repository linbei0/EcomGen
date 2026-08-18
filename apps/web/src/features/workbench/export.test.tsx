import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import {
  EXPORT_FIXTURE,
  EXPORT_JOB_FIXTURE,
  OUTPUT_B_FIXTURE,
  OUTPUT_FIXTURE,
  OUTPUT_ID,
  PROJECT_ID,
  STORYBOARD_FIXTURE,
  STORYBOARD_ITEM_FIXTURE,
  projectDetailPayload,
} from "../../test/msw/fixtures";
import { BASE } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithProviders } from "../../test/render";
import { WorkbenchPage } from "./WorkbenchPage";

type OutputFixture = Omit<typeof OUTPUT_FIXTURE, "reviewDecision"> & {
  reviewDecision: "SELECTED" | "REJECTED" | "NEEDS_REVIEW";
};

function renderExport(outputs: OutputFixture[] = [{ ...OUTPUT_FIXTURE, reviewDecision: "SELECTED" }]) {
  server.use(
    http.get(`${BASE}/projects/:projectId`, () =>
      HttpResponse.json(
        projectDetailPayload({
          storyboard: { ...STORYBOARD_FIXTURE, status: "CONFIRMED" },
          items: [{ ...STORYBOARD_ITEM_FIXTURE, status: "GENERATED" }],
          outputs,
        }),
      ),
    ),
  );
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId" element={<WorkbenchPage />} />
    </Routes>,
    { initialEntries: [`/projects/${PROJECT_ID}?stage=export`] },
  );
}

describe("工作台 · 导出阶段", () => {
  it("只统计 SELECTED，并显式提交 outputIds", async () => {
    const user = userEvent.setup();
    let captured: unknown;
    server.use(
      http.post(`${BASE}/projects/:projectId/export-jobs`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ job: EXPORT_JOB_FIXTURE, export: EXPORT_FIXTURE }, { status: 202 });
      }),
    );
    renderExport([
      { ...OUTPUT_FIXTURE, reviewDecision: "SELECTED" },
      { ...OUTPUT_B_FIXTURE, reviewDecision: "REJECTED" },
    ]);
    expect(await screen.findByText("可导出 1 张")).toBeInTheDocument();
    expect(screen.queryByText(/约/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "导出 ZIP" }));
    await waitFor(() => {
      expect(captured).toMatchObject({
        outputIds: [OUTPUT_ID],
        platformTargets: ["DOMESTIC"],
        includeDetailPageSlices: false,
      });
    });
  });

  it("成功后提供下载，优先 downloadUrl", async () => {
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(
          projectDetailPayload({
            outputs: [{ ...OUTPUT_FIXTURE, reviewDecision: "SELECTED" }],
            jobs: [{ ...EXPORT_JOB_FIXTURE, status: "SUCCEEDED", progress: 100 }],
          }),
        ),
      ),
      http.get(`${BASE}/exports/:exportId`, () =>
        HttpResponse.json({
          ...EXPORT_FIXTURE,
          status: "SUCCEEDED",
          downloadUrl: "https://files.local/pack.zip",
        }),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/projects/:projectId" element={<WorkbenchPage />} />
      </Routes>,
      { initialEntries: [`/projects/${PROJECT_ID}?stage=export`] },
    );
    expect(await screen.findByText("可导出 1 张")).toBeInTheDocument();
  });
});
