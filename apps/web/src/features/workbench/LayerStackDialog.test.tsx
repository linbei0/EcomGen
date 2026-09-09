import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { LayerExportView } from "./LayersPanel";
import { LayerStackDialog } from "./LayerStackDialog";

const record = {
  id: "cffdbade-77c4-466f-a72a-0366bb160c6d",
  status: "SUCCEEDED",
  includeBackground: true,
  psdDownloadUrl: "/files/layer-exports/cffdbade",
  error: null,
  createdAt: "2026-09-10T01:02:03.000Z",
  layerFiles: [
    { name: "00_背景.png", kind: "background", downloadUrl: "/files/layer-exports/cffdbade/layers/0" },
    { name: "01_瓶身.png", kind: "element", downloadUrl: "/files/layer-exports/cffdbade/layers/1" },
    { name: "图层.psd", kind: "composite", downloadUrl: "/files/layer-exports/cffdbade/layers/2" },
  ],
} as unknown as LayerExportView;

describe("LayerStackDialog", () => {
  it("smoke：渲染全部可见图层行，composite 不进列表，显示底部提示", () => {
    render(<LayerStackDialog record={record} outputId="f91ad3e7-6723-49b8-8e14-974e9f0e389e" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "图层编排" })).toBeInTheDocument();
    expect(screen.getByText("背景")).toBeInTheDocument();
    expect(screen.getByText("元素")).toBeInTheDocument();
    expect(screen.getByText("00_背景")).toBeInTheDocument();
    expect(screen.getByText("01_瓶身")).toBeInTheDocument();
    expect(screen.queryByText("图层.psd")).not.toBeInTheDocument();
    expect(screen.getByText(/隐藏的图层不会包含进 ZIP 和 PSD/)).toBeInTheDocument();
  });
  it("眼睛切换显隐：aria 状态翻转", async () => {
    const user = userEvent.setup();
    render(<LayerStackDialog record={record} outputId="f91ad3e7" onClose={vi.fn()} />);
    const eye = screen.getByLabelText("隐藏图层 01_瓶身");
    await user.click(eye);
    expect(screen.getByLabelText("显示图层 01_瓶身")).toBeInTheDocument();
    await user.click(screen.getByLabelText("显示图层 01_瓶身"));
    expect(screen.getByLabelText("隐藏图层 01_瓶身")).toBeInTheDocument();
  });
  it("Escape 与关闭按钮都会回调 onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<LayerStackDialog record={record} outputId="f91ad3e7" onClose={onClose} />);
    await user.click(screen.getByLabelText("关闭"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
