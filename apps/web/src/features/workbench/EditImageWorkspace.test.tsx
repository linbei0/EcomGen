import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ASSET_FIXTURE, OUTPUT_FIXTURE, PROJECT_ID } from "../../test/msw/fixtures";
import { BASE } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithProviders } from "../../test/render";
import { EditImageWorkspace, resolveReferenceImageUrl } from "./EditImageWorkspace";

const alphaValues: number[] = [];
const fillStyles: string[] = [];
const strokeStyles: string[] = [];
const compositeOperations: GlobalCompositeOperation[] = [];
const renderOperations: string[] = [];
const tintFillStyles: string[] = [];
let currentAlpha = 1;
let currentFillStyle = "";
let currentStrokeStyle = "";
let pendingAnimationFrame: FrameRequestCallback | null = null;
const canvasContext = {
  get globalAlpha() { return currentAlpha; },
  set globalAlpha(value: number) { currentAlpha = value; alphaValues.push(value); renderOperations.push(`alpha:${value}`); },
  get fillStyle() { return currentFillStyle; },
  set fillStyle(value: string) { currentFillStyle = value; fillStyles.push(value); renderOperations.push(`fill:${value}`); },
  get strokeStyle() { return currentStrokeStyle; },
  set strokeStyle(value: string) { currentStrokeStyle = value; strokeStyles.push(value); },
  set globalCompositeOperation(value: GlobalCompositeOperation) { compositeOperations.push(value); renderOperations.push(`composite:${value}`); },
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  drawImage: vi.fn(() => { renderOperations.push("drawImage"); }),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  setLineDash: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  fillText: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
};
const offscreenCanvasContext = Object.create(canvasContext) as CanvasRenderingContext2D;
Object.defineProperties(offscreenCanvasContext, {
  globalAlpha: { get: () => 1, set: () => {} },
  fillStyle: { get: () => "", set: (value: string) => { tintFillStyles.push(value); } },
  strokeStyle: { get: () => "", set: () => {} },
  globalCompositeOperation: { get: () => "source-over", set: () => {} },
});

function renderEditor(project?: { reasoningProviderId: string; reasoningModelId: string; imageProviderId: string; imageModelId: string; imageResolution: "1K" | "2K" | "4K"; candidatesPerType: number }, assets = [] as Parameters<typeof EditImageWorkspace>[0]["assets"]) {
  return renderWithProviders(
    <EditImageWorkspace
      projectId={PROJECT_ID}
      project={project}
      output={OUTPUT_FIXTURE}
      outputs={[OUTPUT_FIXTURE]}
      assets={assets}
      onSelectOutput={() => {}}
      onClose={() => {}}
    />,
  );
}

function initializeCanvas(): void {
  const image = screen.getByAltText("待编辑图片");
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: 1000 },
    naturalHeight: { configurable: true, value: 1000 },
  });
  fireEvent.load(image);
}

function firePointer(canvas: HTMLCanvasElement, type: "pointerdown" | "pointermove" | "pointerup", pointerId: number, clientX: number, clientY: number): void {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    pointerId: { configurable: true, value: pointerId },
    clientX: { configurable: true, value: clientX },
    clientY: { configurable: true, value: clientY },
  });
  fireEvent(canvas, event);
}

function renderPendingFrame(): void {
  const callback = pendingAnimationFrame;
  pendingAnimationFrame = null;
  callback?.(0);
}

describe("图片编辑画布", () => {
  beforeEach(() => {
    currentAlpha = 1;
    alphaValues.length = 0;
    currentFillStyle = "";
    fillStyles.length = 0;
    currentStrokeStyle = "";
    strokeStyles.length = 0;
    compositeOperations.length = 0;
    renderOperations.length = 0;
    tintFillStyles.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContext(this: HTMLCanvasElement) {
      return (this.dataset.tool ? canvasContext : offscreenCanvasContext) as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,mock");
    pendingAnimationFrame = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { pendingAnimationFrame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
    HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
    HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => true);
    server.use(
      http.post(`${BASE}/projects/:projectId/outputs/:outputId/edit-sessions`, ({ params }) =>
        HttpResponse.json({ id: "edit-session-1", currentOutputId: params.outputId, memorySummary: {}, versions: [] }),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("相对 API 前缀下能解析参考图片地址", () => {
    expect(resolveReferenceImageUrl("/files/assets/reference.png", "/api/v1")).toBe("/api/v1/files/assets/reference.png");
    expect(resolveReferenceImageUrl("/api/v1/files/assets/reference.png", "/api/v1")).toBe("/api/v1/files/assets/reference.png");
  });

  it("拖动已框选区域后只提交移动后的选择框", async () => {
    const user = userEvent.setup();
    let submittedAnnotations: unknown;
    server.use(
      http.post(`${BASE}/edit-sessions/:sessionId/turns`, async ({ request }) => {
        submittedAnnotations = JSON.parse(String((await request.formData()).get("annotations")));
        return HttpResponse.json({ turnId: "turn-1" });
      }),
    );
    renderEditor();

    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-tool='rect']")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 } as DOMRect);
    initializeCanvas();
    expect(canvas.width).toBe(1000);
    firePointer(canvas, "pointerdown", 1, 100, 100);
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
    firePointer(canvas, "pointermove", 1, 300, 300);
    firePointer(canvas, "pointerup", 1, 300, 300);
    firePointer(canvas, "pointerdown", 2, 150, 100);
    firePointer(canvas, "pointermove", 2, 350, 250);
    firePointer(canvas, "pointerup", 2, 350, 250);
    await user.type(screen.getByPlaceholderText(/把选中的菠萝颜色/), "移动框选区域");
    await user.click(screen.getByRole("button", { name: "生成计划" }));

    expect(submittedAnnotations).toMatchObject({
      annotations: [{ type: "rect", bounds: { x: 300, y: 250, width: 200, height: 200 } }],
    });
  });

  it("默认收起本次生成设置，展开后提交自定义模型、分辨率和出图数", async () => {
    const user = userEvent.setup();
    let submittedAnnotations: Record<string, unknown> | undefined;
    server.use(
      http.get(`${BASE}/providers`, () => HttpResponse.json({ items: [
        { id: "reasoning-2", name: "推理 Provider", models: [{ id: "reasoning-model-2", supportsVision: true, supportsThinking: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null }] },
        { id: "image-2", name: "生图 Provider", models: [{ id: "image-model-2", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: "openai_images" }] },
      ], nextCursor: null })),
      http.post(`${BASE}/edit-sessions/:sessionId/turns`, async ({ request }) => {
        submittedAnnotations = JSON.parse(String((await request.formData()).get("annotations"))) as Record<string, unknown>;
        return HttpResponse.json({ turnId: "turn-1" });
      }),
    );
    renderEditor({ reasoningProviderId: "reasoning-1", reasoningModelId: "reasoning-model-1", imageProviderId: "image-1", imageModelId: "image-model-1", imageResolution: "1K", candidatesPerType: 1 });

    expect(screen.getByRole("button", { name: /本次生成设置/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("推理模型")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /本次生成设置/ }));
    expect(screen.getByLabelText("推理模型")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("推理模型"), "reasoning-2::reasoning-model-2");
    await user.selectOptions(screen.getByLabelText("生图模型"), "image-2::image-model-2");
    await user.selectOptions(screen.getByLabelText("分辨率"), "2K");
    fireEvent.change(screen.getByLabelText("出图数"), { target: { value: "3" } });
    await user.type(screen.getByPlaceholderText(/把选中的菠萝颜色/), "使用本次配置");
    await user.click(screen.getByRole("button", { name: "生成计划" }));

    expect(submittedAnnotations?.generationConfig).toEqual({
      reasoningProviderId: "reasoning-2",
      reasoningModelId: "reasoning-model-2",
      imageProviderId: "image-2",
      imageModelId: "image-model-2",
      imageResolution: "2K",
      candidateCount: 3,
    });
  });

  it("始终提供参考素材入口并提交用途明确的选择快照", async () => {
    const user = userEvent.setup(); let submittedSelections: unknown;
    server.use(
      http.get(`${BASE}/edit-sessions/:sessionId/reference-assets`, () => HttpResponse.json({ items: [{ id: "aaaaaaaa-1111-4222-8333-444444444444", source: "PROJECT", purpose: "PRODUCT_APPEARANCE", role: "PRODUCT_TRUTH", originalName: "phone-front.png", mimeType: "image/png", hash: "hash", createdAt: "2026-08-01T00:00:00.000Z", expiresAt: null, url: "/api/v1/files/assets/aaaaaaaa-1111-4222-8333-444444444444" }], suggestedSelections: [] })),
      http.post(`${BASE}/edit-sessions/:sessionId/turns`, async ({ request }) => { submittedSelections = JSON.parse(String((await request.formData()).get("referenceSelections"))); return HttpResponse.json({ turnId: "turn-1" }); }),
    );
    renderEditor();
    await user.click(screen.getByRole("button", { name: "选择" }));
    await user.click(await screen.findByRole("button", { name: /phone-front\.png/ }));
    await user.type(screen.getByPlaceholderText(/把选中的菠萝颜色/), "替换商品");
    await user.click(screen.getByRole("button", { name: "生成计划" }));
    expect(submittedSelections).toEqual([{ id: "aaaaaaaa-1111-4222-8333-444444444444", source: "PROJECT", purpose: "PRODUCT_APPEARANCE", order: 0 }]);
  });

  it("参考素材接口失败时仍显示项目详情中的素材", async () => {
    const user = userEvent.setup();
    server.use(http.get(`${BASE}/edit-sessions/:sessionId/reference-assets`, () => HttpResponse.json({ error: "failed" }, { status: 500 })));
    renderEditor(undefined, [{ ...ASSET_FIXTURE, url: `${BASE}/files/assets/${ASSET_FIXTURE.id}` }]);
    await user.click(screen.getByRole("button", { name: "选择" }));
    expect(await screen.findByText("product.png")).toBeInTheDocument();
  });

  it("从未选择成图切换到编辑状态时不会清空项目素材", async () => {
    const user = userEvent.setup(); const assets = [{ ...ASSET_FIXTURE, url: `${BASE}/files/assets/${ASSET_FIXTURE.id}` }];
    server.use(http.get(`${BASE}/edit-sessions/:sessionId/reference-assets`, () => HttpResponse.json({ error: "failed" }, { status: 500 })));
    const view = renderWithProviders(<EditImageWorkspace projectId={PROJECT_ID} output={undefined} outputs={[OUTPUT_FIXTURE]} assets={assets} onSelectOutput={() => {}} onClose={() => {}} />);
    view.rerender(<EditImageWorkspace projectId={PROJECT_ID} output={OUTPUT_FIXTURE} outputs={[OUTPUT_FIXTURE]} assets={assets} onSelectOutput={() => {}} onClose={() => {}} />);
    await user.click(await screen.findByRole("button", { name: "选择" }));
    expect(await screen.findByText("product.png")).toBeInTheDocument();
  });

  it("拖入参考图片时显示接收状态", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole("button", { name: "选择" }));

    const dropZone = await screen.findByTestId("reference-drop-zone");
    fireEvent.dragEnter(dropZone, { dataTransfer: { files: [] } });
    expect(dropZone.className).toContain("referencePopoverDragActive");
    fireEvent.dragLeave(dropZone, { relatedTarget: null });
    expect(dropZone.className).not.toContain("referencePopoverDragActive");
  });

  it("以不同的高可见度颜色渲染可编辑与保护涂抹", async () => {
    const user = userEvent.setup();
    renderEditor();

    initializeCanvas();
    await user.click(screen.getByRole("button", { name: "涂抹可编辑区域" }));
    expect(alphaValues).toContain(0.72);
    expect(tintFillStyles).toContain("#006dff");
    expect(compositeOperations).not.toContain("destination-in");
    await user.click(screen.getByRole("button", { name: "保护区域" }));
    expect(alphaValues).toContain(0.64);
    expect(tintFillStyles).toContain("#f07800");
  });

  it("拖动选框边框时移动整个区域并显示移动光标", async () => {
    const user = userEvent.setup();
    let submittedAnnotations: unknown;
    server.use(
      http.post(`${BASE}/edit-sessions/:sessionId/turns`, async ({ request }) => {
        submittedAnnotations = JSON.parse(String((await request.formData()).get("annotations")));
        return HttpResponse.json({ turnId: "turn-1" });
      }),
    );
    renderEditor();

    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-tool='rect']")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 } as DOMRect);
    initializeCanvas();
    firePointer(canvas, "pointerdown", 1, 100, 100);
    firePointer(canvas, "pointermove", 1, 300, 300);
    firePointer(canvas, "pointerup", 1, 300, 300);
    firePointer(canvas, "pointermove", 2, 150, 100);
    expect(canvas.style.cursor).toBe("move");
    firePointer(canvas, "pointerdown", 3, 150, 100);
    firePointer(canvas, "pointermove", 3, 250, 150);
    firePointer(canvas, "pointerup", 3, 250, 150);
    await user.type(screen.getByPlaceholderText(/把选中的菠萝颜色/), "移动选框边框");
    await user.click(screen.getByRole("button", { name: "生成计划" }));

    expect(submittedAnnotations).toMatchObject({
      annotations: [{ type: "rect", bounds: { x: 200, y: 150, width: 200, height: 200 } }],
    });
  });

  it("拖动选框角点时实时调整大小并显示对角缩放光标", async () => {
    const user = userEvent.setup();
    let submittedAnnotations: unknown;
    server.use(
      http.post(`${BASE}/edit-sessions/:sessionId/turns`, async ({ request }) => {
        submittedAnnotations = JSON.parse(String((await request.formData()).get("annotations")));
        return HttpResponse.json({ turnId: "turn-1" });
      }),
    );
    renderEditor();

    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-tool='rect']")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 } as DOMRect);
    initializeCanvas();
    firePointer(canvas, "pointerdown", 1, 100, 100);
    firePointer(canvas, "pointermove", 1, 300, 300);
    firePointer(canvas, "pointerup", 1, 300, 300);
    firePointer(canvas, "pointermove", 2, 300, 300);
    expect(canvas.style.cursor).toBe("nwse-resize");
    firePointer(canvas, "pointerdown", 3, 300, 300);
    canvasContext.strokeRect.mockClear();
    firePointer(canvas, "pointermove", 3, 400, 350);
    renderPendingFrame();
    expect(canvasContext.strokeRect).toHaveBeenCalledWith(100, 100, 300, 250);
    firePointer(canvas, "pointerup", 3, 400, 350);
    await user.type(screen.getByPlaceholderText(/把选中的菠萝颜色/), "拉伸选框角点");
    await user.click(screen.getByRole("button", { name: "生成计划" }));

    expect(submittedAnnotations).toMatchObject({
      annotations: [{ type: "rect", bounds: { x: 100, y: 100, width: 300, height: 250 } }],
    });
  });

  it("拖动选框边中点时只调整对应方向的尺寸", async () => {
    const user = userEvent.setup();
    let submittedAnnotations: unknown;
    server.use(
      http.post(`${BASE}/edit-sessions/:sessionId/turns`, async ({ request }) => {
        submittedAnnotations = JSON.parse(String((await request.formData()).get("annotations")));
        return HttpResponse.json({ turnId: "turn-1" });
      }),
    );
    renderEditor();

    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-tool='rect']")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 } as DOMRect);
    initializeCanvas();
    firePointer(canvas, "pointerdown", 1, 100, 100);
    firePointer(canvas, "pointermove", 1, 300, 300);
    firePointer(canvas, "pointerup", 1, 300, 300);
    firePointer(canvas, "pointermove", 2, 200, 100);
    expect(canvas.style.cursor).toBe("ns-resize");
    firePointer(canvas, "pointerdown", 3, 200, 100);
    firePointer(canvas, "pointermove", 3, 200, 50);
    firePointer(canvas, "pointerup", 3, 200, 50);
    await user.type(screen.getByPlaceholderText(/把选中的菠萝颜色/), "拉伸选框上边");
    await user.click(screen.getByRole("button", { name: "生成计划" }));

    expect(submittedAnnotations).toMatchObject({
      annotations: [{ type: "rect", bounds: { x: 100, y: 50, width: 200, height: 250 } }],
    });
  });

  it("即使之前选过橙色标注，编辑笔刷光标仍使用编辑蓝", async () => {
    const user = userEvent.setup();
    renderEditor();

    initializeCanvas();
    await user.click(screen.getByRole("button", { name: "箭头标注" }));
    await user.click(screen.getByRole("button", { name: "使用 #ffbf2f 标注" }));
    await user.click(screen.getByRole("button", { name: "涂抹可编辑区域" }));
    strokeStyles.length = 0;
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-tool='brush']")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 } as DOMRect);
    firePointer(canvas, "pointermove", 1, 120, 120);
    renderPendingFrame();

    expect(strokeStyles).toContain("#006dff");
    expect(strokeStyles).not.toContain("#ffbf2f");
  });
});
