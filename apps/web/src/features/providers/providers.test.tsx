import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { BASE, PROVIDER_FIXTURE } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithProviders } from "../../test/render";
import { SettingsDrawer } from "./SettingsDrawer";

function openDrawer() {
  renderWithProviders(<SettingsDrawer open onClose={() => {}} />);
}

describe("设置抽屉 · Provider", () => {
  it("展示 Provider 列表：密钥状态、模型统计、能力摘要", async () => {
    openDrawer();
    expect(await screen.findByText("OpenAI 官方")).toBeInTheDocument();
    expect(screen.getByText("已配置密钥")).toBeInTheDocument();
    expect(screen.getByText("2 个模型")).toBeInTheDocument();
    expect(screen.getByText("含生图模型")).toBeInTheDocument();
    expect(screen.getByText("含视觉模型")).toBeInTheDocument();
  });

  it("创建 Provider：按契约提交 name/baseUrl/apiKey/models", { timeout: 15_000 }, async () => {
    const user = userEvent.setup();
    let captured: unknown;
    server.use(
      http.post(`${BASE}/providers`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(
          { ...PROVIDER_FIXTURE, id: "11111111-2222-4333-8444-555555555555" },
          { status: 201 },
        );
      }),
    );

    openDrawer();
    await user.click(await screen.findByRole("button", { name: /添加 Provider/ }));
    await user.type(screen.getByLabelText(/名称/), "测试 Provider");
    await user.type(screen.getByLabelText("Base URL"), "https://api.test.local/v1");
    await user.type(screen.getByLabelText("API Key"), "sk-test");
    await user.type(screen.getByPlaceholderText("模型 ID，如 gpt-image-1"), "gpt-image-1");
    await user.click(screen.getByRole("button", { name: /^添加$/ }));

    expect(await screen.findByText("已添加 Provider")).toBeInTheDocument();
    expect(await screen.findByText("编辑 Provider")).toBeInTheDocument();
    expect(captured).toMatchObject({
      name: "测试 Provider",
      baseUrl: "https://api.test.local/v1",
      apiKey: "sk-test",
      models: [
        {
          id: "gpt-image-1",
          supportsVision: false,
          supportsTools: false,
          supportsStructuredOutput: false,
          imageApiKind: null,
        },
      ],
    });
  });

  it("测试连通性：按模型能力发送 kind 并展示延迟", async () => {
    const user = userEvent.setup();
    let captured: unknown;
    server.use(
      http.post(`${BASE}/providers/:providerId/test`, async ({ request, params }) => {
        captured = { body: await request.json(), providerId: params.providerId };
        return HttpResponse.json({
          ok: true,
          providerId: params.providerId as string,
          modelId: "gpt-image-1",
          kind: "image",
          latencyMs: 87,
          modelAvailable: true,
        });
      }),
    );

    openDrawer();
    await user.click(await screen.findByRole("button", { name: "编辑 OpenAI 官方" }));
    const testButtons = await screen.findAllByRole("button", { name: /测试/ });
    const imageModelRow = testButtons[1];
    expect(imageModelRow).toBeDefined();
    await user.click(imageModelRow!);

    expect(await screen.findByText(/连通 · 87ms/)).toBeInTheDocument();
    expect(captured).toMatchObject({
      providerId: PROVIDER_FIXTURE.id,
      body: { modelId: "gpt-image-1", kind: "image" },
    });
  });

  it("生图模型隐藏推理能力开关", async () => {
    const user = userEvent.setup();
    openDrawer();
    await user.click(await screen.findByRole("button", { name: "编辑 OpenAI 官方" }));

    expect(screen.getAllByText("视觉")).toHaveLength(1);
    expect(screen.getAllByText("思考")).toHaveLength(1);
    expect(screen.getAllByText("工具")).toHaveLength(1);
    expect(screen.getAllByText("结构化")).toHaveLength(1);
  });

  it("新添加的模型必须保存后才能测试", async () => {
    const user = userEvent.setup();
    openDrawer();
    await user.click(await screen.findByRole("button", { name: "编辑 OpenAI 官方" }));
    await user.click(screen.getByRole("button", { name: "添加模型" }));
    const testButtons = screen.getAllByRole("button", { name: "测试" });
    expect(testButtons).toHaveLength(3);
    expect(testButtons[2]).toBeDisabled();
  });

  it("删除 Provider：Popconfirm 确认后调用 DELETE", async () => {
    const user = userEvent.setup();
    let deletedId: string | undefined;
    server.use(
      http.delete(`${BASE}/providers/:providerId`, ({ params }) => {
        deletedId = params.providerId as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    openDrawer();
    await user.click(await screen.findByRole("button", { name: "删除 OpenAI 官方" }));
    await user.click(await screen.findByRole("button", { name: /^删除$/ }));

    await waitFor(() => expect(deletedId).toBe(PROVIDER_FIXTURE.id));
    expect(await screen.findByText("已删除 OpenAI 官方")).toBeInTheDocument();
  });

  it("VALIDATION_ERROR：展示契约错误消息与请求 ID", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${BASE}/providers`, () =>
        HttpResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "baseUrl 不是合法 URL",
              details: [],
              requestId: "3f6c2c90-1234-4000-8000-0000000000aa",
            },
          },
          { status: 400 },
        ),
      ),
    );

    openDrawer();
    await user.click(await screen.findByRole("button", { name: /添加 Provider/ }));
    await user.type(screen.getByLabelText(/名称/), "X");
    await user.type(screen.getByLabelText("Base URL"), "https://api.test.local/v1");
    await user.type(screen.getByLabelText("API Key"), "sk-test");
    await user.type(screen.getByPlaceholderText("模型 ID，如 gpt-image-1"), "m1");
    await user.click(screen.getByRole("button", { name: /^添加$/ }));

    expect(await screen.findByText(/baseUrl 不是合法 URL/)).toBeInTheDocument();
    expect(
      screen.getByText(/3f6c2c90-1234-4000-8000-0000000000aa/),
    ).toBeInTheDocument();
  });
});
