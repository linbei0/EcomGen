import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { MODEL_SPEC_DEFAULTS, type ModelSpec } from "@ecomgen/contracts";

import { BASE } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithProviders } from "../../test/render";
import { ModelsPage } from "./ModelsPage";

/** 模特测试数据：规格以契约基准款为底再覆盖身份维度，避免在测试里手抄 30 个字段。 */
function modelFixture(id: string, name: string, spec: Partial<ModelSpec>) {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    id,
    name,
    spec: { ...MODEL_SPEC_DEFAULTS, ...spec },
    notes: "",
    hasReferenceFace: false,
    portraitCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const MODELS = [
  modelFixture("11111111-1111-4111-8111-111111111111", "阿岚", { gender: "FEMALE", heritage: "NORTHERN_EUROPEAN", stature: "TALL_172" }),
  modelFixture("22222222-2222-4222-8222-222222222222", "小满", { gender: "MALE", heritage: "EAST_ASIAN", stature: "STANDARD_165" }),
];

/** 两位模特远少于旧版隐藏搜索框的阈值，用来验证搜索框始终可见。 */
function renderModels() {
  server.use(
    http.get(`${BASE}/models`, () => HttpResponse.json({ items: MODELS, nextCursor: null })),
    http.get(`${BASE}/models/:modelId/portraits`, () => HttpResponse.json({ items: [] })),
  );
  renderWithProviders(<ModelsPage />);
}

async function pickOption(user: ReturnType<typeof userEvent.setup>, fieldLabel: string, optionLabel: string) {
  // 身份面板默认收起：先展开筛选工具，再在对应维度里选值。
  const toggle = screen.getByRole("button", { name: "身份筛选" });
  if (toggle.getAttribute("aria-expanded") !== "true") await user.click(toggle);
  await user.click(screen.getByLabelText(fieldLabel));
  await user.click(await screen.findByTitle(optionLabel));
}

describe("模特库 · 检索与身份筛选", () => {
  it("少于 6 位模特仍可搜索，身份维度默认收起且与文本取交集", async () => {
    const user = userEvent.setup();
    renderModels();
    expect(await screen.findByRole("heading", { name: "阿岚", level: 2 })).toBeInTheDocument();
    // 面板收起时五个维度不可见，侧栏只有一行搜索。
    expect(screen.queryByLabelText("族裔气质")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("搜索模特"), "小满");
    await waitFor(() => expect(screen.getByText("1 / 2 位")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "小满", level: 2 })).toBeInTheDocument();

    // 小满是男模：展开面板、叠加「性别呈现 = 男」后仍命中，详情保持同一位模特。
    await pickOption(user, "性别呈现", "男");
    await waitFor(() => expect(screen.getByText("1 / 2 位")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "小满", level: 2 })).toBeInTheDocument();
  });

  it("维度取交集筛掉当前选中模特时详情切到第一位匹配者，零结果给出筛选空状态", async () => {
    const user = userEvent.setup();
    renderModels();
    expect(await screen.findByRole("heading", { name: "阿岚", level: 2 })).toBeInTheDocument();

    // 阿岚是北欧，选「东亚」把她筛掉：列表与详情同时切到唯一命中的小满。
    await pickOption(user, "族裔气质", "东亚");
    await waitFor(() => expect(screen.getByRole("heading", { name: "小满", level: 2 })).toBeInTheDocument());
    expect(screen.getByText("1 / 2 位")).toBeInTheDocument();

    // 再叠加「女」：两个维度的交集为空，列表与详情都进入筛选空状态而不是继续展示旧详情。
    await pickOption(user, "性别呈现", "女");
    await waitFor(() =>
      expect(screen.getByText("名称、身份摘要与五个身份维度之间取交集，放宽条件即可看到更多模特。")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();

    // 清除筛选后原来的模特回到列表与详情。
    await user.click(screen.getAllByRole("button", { name: "清除筛选" })[0]!);
    await waitFor(() => expect(screen.getByText("共 2 位")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "阿岚", level: 2 })).toBeInTheDocument();
  });
});
