import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
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

  it("创建向导提交项目并带上所选模板", async () => {
    const user = userEvent.setup();
    let captured: unknown;
    server.use(
      http.post(`${BASE}/projects`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ ...PROJECT_FIXTURE, name: "新耳机" }, { status: 201 });
      }),
    );

    renderWithProviders(<HomePage />);
    await user.click(await screen.findByRole("button", { name: /新建项目/ }));
    await user.type(screen.getByLabelText(/项目名称/), "新耳机");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(await screen.findByRole("listitem", { name: /白底/ }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "创建项目" }));

    await waitFor(() => {
      expect(captured).toMatchObject({
        name: "新耳机",
        platformTargets: ["DOMESTIC"],
        defaultMode: "CREATIVE",
        reasoningModelId: "gpt-4o",
        imageModelId: "gpt-image-1",
      });
    });
  });
});
