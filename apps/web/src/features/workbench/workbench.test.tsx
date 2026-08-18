import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import { PROJECT_ID, projectDetailPayload } from "../../test/msw/fixtures";
import { BASE } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithProviders } from "../../test/render";
import { WorkbenchPage } from "./WorkbenchPage";

function renderWorkbench(stage = "assets") {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId" element={<WorkbenchPage />} />
    </Routes>,
    { initialEntries: [`/projects/${PROJECT_ID}?stage=${stage}`] },
  );
}

describe("工作台 · 素材阶段", () => {
  it("展示变体、分组素材与像素保护角标", async () => {
    server.use(
      http.get(`${BASE}/projects/:projectId`, () =>
        HttpResponse.json(
          projectDetailPayload({
            defaultMode: "PIXEL_PROTECTED",
          }),
        ),
      ),
    );
    renderWorkbench();
    expect(await screen.findByRole("heading", { name: "无线耳机 SPU" })).toBeInTheDocument();
    expect(screen.getByText("黑色")).toBeInTheDocument();
    expect(document.querySelector("[class*='assetRole']")).toHaveTextContent("商品真实性");
    expect(screen.getByLabelText("像素保护素材")).toBeInTheDocument();
  });

  it("添加变体", async () => {
    const user = userEvent.setup();
    let captured: unknown;
    server.use(
      http.post(`${BASE}/projects/:projectId/variants`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({
          id: "new-variant",
          projectId: PROJECT_ID,
          name: "白色",
          attributes: {},
          createdAt: "2026-08-01T00:00:00.000Z",
        });
      }),
    );
    renderWorkbench();
    await user.type(await screen.findByLabelText("变体名称"), "白色");
    await user.click(screen.getByRole("button", { name: /添加变体/ }));
    await waitFor(() => {
      expect(captured).toMatchObject({ name: "白色" });
    });
    expect(await screen.findByText("已添加变体")).toBeInTheDocument();
  });

  it("素材阶段提供图片上传入口", async () => {
    renderWorkbench();
    await screen.findByRole("heading", { name: "无线耳机 SPU" });
    const input = screen.getByLabelText("上传素材");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/*");
  });
});
