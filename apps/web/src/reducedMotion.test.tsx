import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StageBar } from "./components/StageBar";
import type { Stage } from "./lib/stages";
import { renderWithProviders } from "./test/render";

// renderWithProviders 已用 MotionConfig reducedMotion="always"（模拟系统减弱动态）。
// 断言：动效组件不抛错、内容即时呈现、交互仍可用（docs/09 测试清单第 10 项）。
describe("reduced-motion 降级", () => {
  it("动效组件即时呈现且交互可用", async () => {
    const user = userEvent.setup();
    const seen: Stage[] = [];
    renderWithProviders(
      <StageBar current="plan" completed={new Set<Stage>(["assets"])} onChange={(stage) => seen.push(stage)} />,
    );

    for (const label of ["素材", "规划", "分镜", "生成", "审核", "导出"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeVisible();
    }
    await user.click(screen.getByRole("button", { name: /导出/ }));
    expect(seen).toEqual(["export"]);
  });
});
