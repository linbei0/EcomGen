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

function renderWorkbench(view = "setup") {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId" element={<WorkbenchPage />} />
    </Routes>,
    { initialEntries: [`/projects/${PROJECT_ID}?view=${view}`] },
  );
}

describe("工作台 · 配置", () => {
  it("展示产品图分组与像素保护角标，不展示变体", async () => {
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
    expect(screen.queryByLabelText("变体名称")).not.toBeInTheDocument();
    expect(screen.queryByText("黑色")).not.toBeInTheDocument();
    expect(document.querySelector("[class*='assetRole']")).toHaveTextContent("产品图");
    expect(screen.getByLabelText("像素保护素材")).toBeInTheDocument();
  });

  it("素材区提供图片上传入口", async () => {
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

    await user.click(screen.getByLabelText("目标平台"));
    await user.click(await screen.findByText("Amazon"));
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ platformTargets: ["AMAZON"] }));

    await user.click(screen.getByLabelText("默认模式"));
    await user.click(await screen.findByText("像素保护 · 保留主体像素"));
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ defaultMode: "PIXEL_PROTECTED" }));
  });

  it("描述失焦保存，推理模型下拉不含生图模型且切换即 PATCH", async () => {
    const user = userEvent.setup();
    const patches: Record<string, unknown>[] = [];
    server.use(
      http.patch(`${BASE}/projects/:projectId`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patches.push(body);
        return HttpResponse.json({ ...PROJECT_FIXTURE, ...body });
      }),
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
    renderWorkbench();

    const textarea = await screen.findByLabelText("商品描述");
    await user.clear(textarea);
    await user.type(textarea, "不锈钢保温杯");
    fireEvent.blur(textarea);
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ productDescription: "不锈钢保温杯" }));

    const combobox = screen.getByLabelText("推理模型");
    await user.click(combobox);
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
