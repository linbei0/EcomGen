import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { suiteFixtures } from "../../test/msw/fixtures";
import { BASE, suiteStore, suitesResponse } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithProviders } from "../../test/render";
import { SuitePickerDialog } from "./SuitePickerDialog";

const FIXTURE_COUNT = 45;

/**
 * 受控宿主：value/onChange 与真实调用方一致，由外部持有选择结果。
 * jsdom 没有布局引擎，react-virtuoso 量不出高度因而不会挂载卡片节点，
 * 所以这里断言的是数据层契约（按页请求、服务端筛选、全库计数）；
 * 卡片数量随滚动有界收敛属于渲染层结论，由浏览器复测承担。
 */
function Host() {
  const [value, setValue] = useState<string[]>([]);
  return <SuitePickerDialog open value={value} onChange={setValue} onClose={() => {}} />;
}

describe("SuitePickerDialog 分页与筛选", () => {
  const requests: string[] = [];

  beforeEach(() => {
    suiteStore.push(...suiteFixtures(FIXTURE_COUNT));
    requests.length = 0;
    server.use(
      // 品类导航来自 taxonomy 接口，夹具按两个 L1 覆盖
      http.get(`${BASE}/suite-categories`, () =>
        HttpResponse.json({ l1: ["护肤个护", "食品饮料"], l2: { 护肤个护: ["面部护理"], 食品饮料: ["休闲零食"] } }),
      ),
      http.get(`${BASE}/suites`, ({ request }) => {
        requests.push(request.url);
        return HttpResponse.json(suitesResponse(new URL(request.url).searchParams));
      }),
    );
  });

  it("首屏只取一页，并把分页与检索参数交给服务端", async () => {
    renderWithProviders(<Host />);
    expect(await screen.findByRole("button", { name: /全部\s*45/ })).toBeInTheDocument();

    expect(requests).toHaveLength(1);
    const first = new URL(requests[0]!);
    expect(first.searchParams.get("limit")).toBe("40");
    expect(first.searchParams.get("cursor")).toBeNull();
    expect(first.searchParams.get("q")).toBeNull();
  });

  it("左侧导航按全库口径显示计数，切换品类只改变请求范围", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);
    expect(await screen.findByRole("button", { name: /全部\s*45/ })).toBeInTheDocument();

    // 夹具按奇偶交替分配两个 L1
    expect(screen.getByRole("button", { name: /护肤个护\s*23/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /食品饮料\s*22/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /食品饮料\s*22/ }));
    await waitFor(() => expect(requests.some((url) => new URL(url).searchParams.get("l1") === "食品饮料")).toBe(true));

    // 筛选后的导航计数仍是全库统计，不能跟着筛选变化
    expect(screen.getByRole("button", { name: /全部\s*45/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /护肤个护\s*23/ })).toBeInTheDocument();
  });

  it("搜索防抖后以 q 参数请求服务端，不做本地全量过滤", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);
    expect(await screen.findByRole("button", { name: /全部\s*45/ })).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "搜索套图" }), "叶子 007");
    await waitFor(() => expect(requests.some((url) => new URL(url).searchParams.get("q") === "叶子 007")).toBe(true));

    // 搜索不改变全库计数
    expect(screen.getByRole("button", { name: /全部\s*45/ })).toBeInTheDocument();
  });
});
