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
  OUTPUT_ID_B,
  PROJECT_ID,
  STORYBOARD_FIXTURE,
  STORYBOARD_ITEM_FIXTURE,
  projectDetailPayload,
} from "../../test/msw/fixtures";
import { BASE } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithProviders } from "../../test/render";
import { WorkbenchPage } from "./WorkbenchPage";

function renderExport(outputs = [OUTPUT_FIXTURE, OUTPUT_B_FIXTURE]) {
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
    { initialEntries: [`/projects/${PROJECT_ID}?view=results`] },
  );
}

describe("工作台 · 导出", () => {
  it("打包下载显式提交已选择的 outputIds", async () => {
    const user = userEvent.setup();
    let captured: unknown;
    server.use(
      http.post(`${BASE}/projects/:projectId/export-jobs`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ job: EXPORT_JOB_FIXTURE, export: EXPORT_FIXTURE }, { status: 202 });
      }),
    );
    renderExport();
    await user.click(await screen.findByRole("button", { name: "全选图片" }));
    await user.click(await screen.findByRole("button", { name: /打包下载/ }));
    await waitFor(() => {
      expect(captured).toMatchObject({
        outputIds: [OUTPUT_ID, OUTPUT_ID_B],
        platformTargets: ["DOMESTIC"],
        includeDetailPageSlices: false,
      });
    });
  });

  it("成功后提供下载，优先 downloadUrl", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${BASE}/projects/:projectId/export-jobs`, () =>
        HttpResponse.json({ job: EXPORT_JOB_FIXTURE, export: EXPORT_FIXTURE }, { status: 202 }),
      ),
      http.get(`${BASE}/exports/:exportId`, () =>
        HttpResponse.json({
          ...EXPORT_FIXTURE,
          status: "SUCCEEDED",
          downloadUrl: "https://files.local/pack.zip",
        }),
      ),
    );
    renderExport();
    await user.click(await screen.findByRole("button", { name: "全选图片" }));
    await user.click(await screen.findByRole("button", { name: /打包下载/ }));
    const link = await screen.findByRole("link", { name: "打开 ZIP" });
    expect(link).toHaveAttribute("href", "https://files.local/pack.zip");
  });
});
