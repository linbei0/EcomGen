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

/** 两个用例共用的结果区操作：全选图片后打开导出弹窗并确认。 */
async function submitExport() {
  const user = userEvent.setup();
  renderExport();
  await user.click(await screen.findByRole("button", { name: "全选图片" }));
  await user.click(await screen.findByRole("button", { name: /打包下载/ }));
  await user.click(await screen.findByRole("button", { name: "开始导出" }));
}

describe("工作台 · 导出", () => {
  it("打包下载显式提交已选择的 outputIds", async () => {
    let captured: unknown;
    server.use(
      http.post(`${BASE}/projects/:projectId/export-jobs`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ job: EXPORT_JOB_FIXTURE, export: EXPORT_FIXTURE }, { status: 202 });
      }),
    );
    await submitExport();
    await waitFor(() => {
      expect(captured).toMatchObject({
        outputIds: [OUTPUT_ID, OUTPUT_ID_B],
        platformTargets: ["TAOBAO"],
      });
    });
  });

  it("导出弹窗选择合成长图后请求携带 longImage 配置", async () => {
    let captured: unknown;
    server.use(
      http.post(`${BASE}/projects/:projectId/export-jobs`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ job: EXPORT_JOB_FIXTURE, export: EXPORT_FIXTURE }, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderExport();
    await user.click(await screen.findByRole("button", { name: "全选图片" }));
    await user.click(await screen.findByRole("button", { name: /打包下载/ }));
    await user.click(await screen.findByRole("radio", { name: /合成长图/ }));
    await user.click(await screen.findByRole("checkbox", { name: /切片/ }));
    await user.click(await screen.findByRole("button", { name: "开始导出" }));
    await waitFor(() => {
      expect(captured).toMatchObject({ longImage: { targetWidth: 750, sliceHeight: 960 } });
    });
  });

  it("调整拼接顺序后按新顺序提交 outputIds", async () => {
    let captured: unknown;
    server.use(
      http.post(`${BASE}/projects/:projectId/export-jobs`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ job: EXPORT_JOB_FIXTURE, export: EXPORT_FIXTURE }, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderExport();
    await user.click(await screen.findByRole("button", { name: "全选图片" }));
    await user.click(await screen.findByRole("button", { name: /打包下载/ }));
    await user.click(await screen.findByRole("radio", { name: /合成长图/ }));
    await user.click(await screen.findByRole("button", { name: "下移第 1 屏" }));
    await user.click(await screen.findByRole("button", { name: "开始导出" }));
    await waitFor(() => {
      expect(captured).toMatchObject({ outputIds: [OUTPUT_ID_B, OUTPUT_ID] });
    });
  });

  it("成功后提供下载，优先 downloadUrl", async () => {
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
    await submitExport();
    const link = await screen.findByRole("link", { name: "打开 ZIP" });
    expect(link).toHaveAttribute("href", "https://files.local/pack.zip");
  });
});
