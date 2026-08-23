import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes, useParams } from "react-router";
import { describe, expect, it } from "vitest";

import { ASSET_ID, OUTPUT_ID, OUTPUT_ID_B, PROJECT_FIXTURE } from "../../test/msw/fixtures";
import { BASE } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithProviders } from "../../test/render";
import { HomePage } from "./HomePage";

describe("首页 · 项目画廊", () => {
  it("渲染品牌区、健康指示与设置入口", async () => {
    const user = userEvent.setup();
    renderWithProviders(<HomePage />);

    expect(screen.getByText(/上传一张商品图/)).toBeInTheDocument();
    expect(await screen.findByText("项目画廊 · 暂无项目")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已归档" })).toBeInTheDocument();
    expect(await screen.findByText("API 已连接")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByText("设置 · Provider")).toBeInTheDocument();
  });

  it("有项目时渲染画廊卡片", async () => {
    server.use(
      http.get(`${BASE}/projects`, () =>
        HttpResponse.json({ items: [PROJECT_FIXTURE], nextCursor: null }),
      ),
    );
    renderWithProviders(<HomePage />);
    expect(await screen.findByRole("link", { name: /无线耳机 SPU/ })).toBeInTheDocument();
    expect(screen.queryByText("项目画廊 · 暂无项目")).not.toBeInTheDocument();
    expect(screen.queryByText("国内平台")).not.toBeInTheDocument();
    expect(screen.queryByText("创意")).not.toBeInTheDocument();
  });

  it("有生成图时显示原图角标与套图数量", async () => {
    server.use(
      http.get(`${BASE}/projects`, () =>
        HttpResponse.json({
          items: [
            {
              ...PROJECT_FIXTURE,
              cover: {
                productAssetId: ASSET_ID,
                coverOutputId: OUTPUT_ID,
                previewOutputIds: [OUTPUT_ID_B],
                outputCount: 3,
              },
            },
          ],
          nextCursor: null,
        }),
      ),
    );
    renderWithProviders(<HomePage />);
    expect(await screen.findByRole("link", { name: /无线耳机 SPU/ })).toBeInTheDocument();
    expect(screen.getByText("原图")).toBeInTheDocument();
    expect(screen.getByText("生成 3 张套图")).toBeInTheDocument();
    expect(screen.queryByText("国内平台")).not.toBeInTheDocument();
    expect(screen.queryByText("创意")).not.toBeInTheDocument();
  });

  it("可从卡片菜单归档项目", async () => {
    const user = userEvent.setup();
    let archived = false;
    server.use(
      http.get(`${BASE}/projects`, () => HttpResponse.json({ items: [{ ...PROJECT_FIXTURE, archivedAt: null }], nextCursor: null })),
      http.patch(`${BASE}/projects/:projectId`, async ({ request }) => {
        const body = (await request.json()) as { archived?: boolean };
        archived = body.archived === true;
        return HttpResponse.json({ ...PROJECT_FIXTURE, archivedAt: archived ? "2026-08-01T01:00:00.000Z" : null });
      }),
    );
    renderWithProviders(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /项目操作：归档/ }));
    await user.click(await screen.findByText("归档项目"));
    await waitFor(() => expect(archived).toBe(true));
  });

  it("归档项目经用户确认后才永久删除", async () => {
    const user = userEvent.setup();
    let deleted = false;
    const archivedProject = { ...PROJECT_FIXTURE, archivedAt: "2026-08-01T01:00:00.000Z" };
    server.use(
      http.get(`${BASE}/projects`, ({ request }) => {
        const archived = new URL(request.url).searchParams.get("archived") === "true";
        return HttpResponse.json({ items: archived && !deleted ? [archivedProject] : [], nextCursor: null });
      }),
      http.delete(`${BASE}/projects/:projectId`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<HomePage />);

    await user.click(await screen.findByRole("button", { name: /已归档/ }));
    await user.click(await screen.findByRole("button", { name: "项目操作：恢复或删除" }));
    await user.click(await screen.findByText("删除项目"));
    expect((await screen.findAllByText("永久删除项目？")).length).toBeGreaterThan(0);
    expect(deleted).toBe(false);

    await user.click(screen.getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.queryByRole("link", { name: PROJECT_FIXTURE.name })).not.toBeInTheDocument());
  });
});

function ProjectRouteProbe() {
  const { projectId } = useParams();
  return <div>工作台占位 {projectId}</div>;
}

describe("首页 · 一键创建", () => {
  it("点击新建项目直接 POST 默认值并跳转工作台", async () => {
    const user = userEvent.setup();
    let captured: unknown;
    server.use(
      http.post(`${BASE}/projects`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ ...PROJECT_FIXTURE, name: "未命名项目" }, { status: 201 });
      }),
    );

    renderWithProviders(
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/projects/:projectId" element={<ProjectRouteProbe />} />
      </Routes>,
    );

    await user.click(await screen.findByRole("button", { name: /新建项目/ }));

    await waitFor(() => {
      expect(captured).toMatchObject({
        name: "未命名项目",
        platformTargets: [],
        targetMarket: null,
        copyLanguage: null,
        defaultMode: "CREATIVE",
        reasoningModelId: "gpt-4o",
        imageModelId: "gpt-image-1",
      });
    });
    expect(await screen.findByText(/工作台占位/)).toBeInTheDocument();
  });

  it("无可用模型对时打开设置且不创建项目", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${BASE}/providers`, () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    let posted = false;
    server.use(
      http.post(`${BASE}/projects`, () => {
        posted = true;
        return HttpResponse.json(PROJECT_FIXTURE, { status: 201 });
      }),
    );

    renderWithProviders(<HomePage />);

    await user.click(await screen.findByRole("button", { name: /新建项目/ }));

    expect(await screen.findByText("设置 · Provider")).toBeInTheDocument();
    expect(posted).toBe(false);
  });
});
