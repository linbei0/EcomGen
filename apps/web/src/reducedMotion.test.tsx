import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StageBar } from "./components/StageBar";
import type { WorkbenchView } from "./lib/stages";
import { renderWithProviders } from "./test/render";

// renderWithProviders 已用 MotionConfig reducedMotion="always"（模拟系统减弱动态）。
// Reduced Motion 下动效组件仍须即时呈现内容并保持交互可用。
describe("reduced-motion 降级", () => {
  it("动效组件即时呈现且交互可用", async () => {
    const user = userEvent.setup();
    const seen: WorkbenchView[] = [];
    renderWithProviders(
      <StageBar current="setup" completed={new Set<WorkbenchView>(["setup"])} onChange={(view) => seen.push(view)} />,
    );

    for (const label of ["配置", "分镜", "结果"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeVisible();
    }
    await user.click(screen.getByRole("button", { name: /结果/ }));
    expect(seen).toEqual(["results"]);
  });
});
