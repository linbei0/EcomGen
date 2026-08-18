import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import {
  ASSET_FIXTURE,
  ASSET_ID,
  PROJECT_FIXTURE,
  PROJECT_ID,
  PROVIDER_ID,
  projectDetailPayload,
} from "../../test/msw/fixtures";
import { BASE, PROVIDER_FIXTURE } from "../../test/msw/handlers";
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
    expect(await screen.findByDisplayValue("无线耳机 SPU")).toBeInTheDocument();
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
    await screen.findByDisplayValue("无线耳机 SPU");
    const input = screen.getByLabelText("上传素材");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/*");
  });

  it("确认删除素材时调用 DELETE /assets/:id", async () => {
    const user = userEvent.setup();
    let deleted: string | null = null;
    server.use(
      http.delete(`${BASE}/assets/:assetId`, ({ params }) => {
        deleted = params.assetId as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWorkbench();
    await screen.findByDisplayValue("无线耳机 SPU");
    await user.click(screen.getByRole("button", { name: /^删除素材/ }));
    await user.click(await screen.findByRole("button", { name: "删除" }));
    await waitFor(() => expect(deleted).toBe(ASSET_ID));
  });

  it("粘贴图片时触发上传请求", async () => {
    // 注：MSW 拦截下 undici 无法读取 jsdom FormData 的 body（读取会挂起），
    // 这里只断言粘贴会发出 POST；role 非空与字段顺序由 serializeAssetForm 单测覆盖。
    let posted = 0;
    server.use(
      http.post(`${BASE}/projects/:projectId/assets`, () => {
        posted += 1;
        return HttpResponse.json(ASSET_FIXTURE);
      }),
    );
    renderWorkbench();
    await screen.findByDisplayValue("无线耳机 SPU");

    const file = new File(["img"], "paste.png", { type: "image/png" });
    // jsdom 的 ClipboardEvent clipboardData 为只读，fireEvent init 传不进去，手动定义
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", { value: { files: [file] } });
    fireEvent(document.body, pasteEvent);

    await waitFor(() => expect(posted).toBe(1));
  });
});

describe("工作台 · 左栏编辑", () => {
  it("名称失焦提交，平台与模式点击即提交", async () => {
    const user = userEvent.setup();
    const patches: Record<string, unknown>[] = [];
    server.use(
      http.patch(`${BASE}/projects/:projectId`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patches.push(body);
        return HttpResponse.json({ ...PROJECT_FIXTURE, ...body });
      }),
    );
    renderWorkbench();

    const nameInput = await screen.findByLabelText("项目名称");
    await user.clear(nameInput);
    await user.type(nameInput, "新名字");
    fireEvent.blur(nameInput);
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ name: "新名字" }));

    await user.click(screen.getByRole("button", { name: "Amazon" }));
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ platformTargets: ["DOMESTIC", "AMAZON"] }));

    await user.click(screen.getByRole("button", { name: /像素保护/ }));
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ defaultMode: "PIXEL_PROTECTED" }));
  });
});

describe("工作台 · 右栏检视", () => {
  it("描述失焦保存，推理模型下拉不含生图模型且切换即 PATCH", async () => {
    const user = userEvent.setup();
    const patches: Record<string, unknown>[] = [];
    server.use(
      http.patch(`${BASE}/projects/:projectId`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patches.push(body);
        return HttpResponse.json({ ...PROJECT_FIXTURE, ...body });
      }),
      // 额外提供一个候选推理模型，模拟真实切换（点击当前已选项 antd 不触发 onChange）
      http.get(`${BASE}/providers`, () =>
        HttpResponse.json({
          items: [
            {
              ...PROVIDER_FIXTURE,
              models: [
                ...PROVIDER_FIXTURE.models,
                { id: "claude-sonnet", supportsVision: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null },
              ],
            },
          ],
          nextCursor: null,
        }),
      ),
    );
    renderWorkbench("plan");

    const textarea = await screen.findByLabelText("商品描述");
    await user.clear(textarea);
    await user.type(textarea, "不锈钢保温杯");
    fireEvent.blur(textarea);
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ productDescription: "不锈钢保温杯" }));

    const combobox = screen.getAllByRole("combobox")[0]!;
    await user.click(combobox);
    // antd v6 在 DOM 里渲染两份选项（aria 副本不可交互），
    // 全局 getByText 命中的才是可点击副本；推理下拉的选项里不应出现生图模型
    await waitFor(() => {
      const optionTitles = Array.from(document.querySelectorAll(".ant-select-item-option")).map(
        (node) => node.getAttribute("title") ?? node.textContent,
      );
      expect(optionTitles).toContain("OpenAI 官方 / claude-sonnet");
      expect(optionTitles).not.toContain("OpenAI 官方 / gpt-image-1");
    });
    const next = await screen.findByText("OpenAI 官方 / claude-sonnet");

    await user.click(next);
    await waitFor(() =>
      expect(patches.at(-1)).toMatchObject({ reasoningModel: { providerId: PROVIDER_ID, modelId: "claude-sonnet" } }),
    );
  });
});
