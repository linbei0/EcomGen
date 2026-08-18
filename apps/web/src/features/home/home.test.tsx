import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes, useParams } from "react-router";
import { describe, expect, it } from "vitest";

import { PROJECT_FIXTURE } from "../../test/msw/fixtures";
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
    expect(await screen.findByText("API 已连接")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /配置 Provider/ }));
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
        platformTargets: ["DOMESTIC"],
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
