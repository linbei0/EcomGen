import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawSurface, type DrawTool } from "./DrawSurface";

/**
 * 画布被父组件重渲染清空是一个已经发生过的缺陷。
 *
 * 尺寸原先按 `size` 对象的身份判定依赖，而两个调用方都内联构造 `size={{ width, height }}`；
 * 落笔又会经 `onDirtyChange` 触发父组件渲染，于是每画一笔父组件重渲染一次、画布就被重置一次。
 * 这里钉住两条：同尺寸的重渲染不得重置画布；底色真的变了必须重置——少了后一条，
 * "把重置 effect 整个删掉"也能让前一条通过。
 *
 * jsdom 没有 canvas 实现（getContext 返回 null），用只记账的 2D 上下文替身：
 * 数 fillRect（重置路径唯一的写入动作，笔迹绘制走 stroke/fill 不混入），
 * 并记下每次调用的参数——选框的几何（位置、缩放）只能从参数上钉住。
 */
interface Call { name: string; args: number[]; }

function recordingContext(onFillRect: () => void, ops: string[], calls: Call[]): CanvasRenderingContext2D {
  const record = (name: string) => (...args: unknown[]) => {
    ops.push(name);
    calls.push({ name, args: args.filter((value): value is number => typeof value === "number") });
  };
  return {
    globalCompositeOperation: "source-over",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    fillRect: (...args: unknown[]) => { onFillRect(); record("fillRect")(...args); },
    clearRect: record("clearRect"),
    drawImage: record("drawImage"),
    save: record("save"),
    restore: record("restore"),
    setLineDash: record("setLineDash"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    closePath: record("closePath"),
    stroke: record("stroke"),
    fill: record("fill"),
    arc: record("arc"),
    rect: record("rect"),
    ellipse: record("ellipse"),
    strokeRect: record("strokeRect"),
    putImageData: record("putImageData"),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
  } as unknown as CanvasRenderingContext2D;
}

/**
 * jsdom 没有 PointerEvent，`fireEvent.pointerDown` 会退化成普通 Event，`button`/`clientX` 都是 undefined，
 * 落笔判断 `event.button !== 0` 直接就把事件丢了。用 MouseEvent 冒充：字段齐全，React 照样分发给 onPointerXxx。
 */
function pointerEvent(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
}

/** 交互层是最上面那张画布：底下依次是已提交像素层与选框层，只有它接指针事件。 */
function surfaceOf(container: HTMLElement): HTMLCanvasElement {
  const canvases = container.querySelectorAll("canvas");
  return canvases[canvases.length - 1]!;
}

/** 随手绕一圈（非共线，面积不为零），模拟自然框选的轨迹。 */
function encircle(container: HTMLElement): void {
  const surface = surfaceOf(container);
  fireEvent(surface, pointerEvent("pointerdown", 10, 10));
  const path: Array<[number, number]> = [[40, 10], [40, 40], [10, 40], [12, 12]];
  for (const [x, y] of path) fireEvent(surface, pointerEvent("pointermove", x, y));
  fireEvent(surface, pointerEvent("pointerup", 12, 12));
}

function drag(container: HTMLElement, fromX: number, fromY: number, toX: number, toY: number): void {
  const surface = surfaceOf(container);
  fireEvent(surface, pointerEvent("pointerdown", fromX, fromY));
  fireEvent(surface, pointerEvent("pointermove", (fromX + toX) / 2, (fromY + toY) / 2));
  fireEvent(surface, pointerEvent("pointermove", toX, toY));
  fireEvent(surface, pointerEvent("pointerup", toX, toY));
}

/** 拖到一半松手，用来把"删除"这类在 pointerup 才发生的事与之前的重绘分开观察。 */
function dragUntilPointerUp(container: HTMLElement, fromX: number, fromY: number, toX: number, toY: number): { release: () => void } {
  const surface = surfaceOf(container);
  fireEvent(surface, pointerEvent("pointerdown", fromX, fromY));
  fireEvent(surface, pointerEvent("pointermove", toX, toY));
  return { release: () => fireEvent(surface, pointerEvent("pointerup", toX, toY)) };
}

function rectCalls(calls: readonly Call[]): number[][] {
  return calls.filter((call) => call.name === "rect").map((call) => call.args);
}

describe("DrawSurface", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalRect = HTMLCanvasElement.prototype.getBoundingClientRect;
  // 指针事件会从画布冒泡到舞台容器，两边都会用到捕获 API，所以补在 Element 上。
  const originalCapture = { set: Element.prototype.setPointerCapture, release: Element.prototype.releasePointerCapture, has: Element.prototype.hasPointerCapture };
  let fillRects = 0;
  let ops: string[] = [];
  let calls: Call[] = [];

  beforeEach(() => {
    fillRects = 0;
    ops = [];
    calls = [];
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      return recordingContext(() => { fillRects += 1; }, ops, calls);
    } as unknown as HTMLCanvasElement["getContext"];
    // jsdom 没有布局，也没有指针捕获：给个固定盒子，落笔坐标才不是 NaN。
    HTMLCanvasElement.prototype.getBoundingClientRect = function (this: HTMLCanvasElement) {
      return { x: 0, y: 0, left: 0, top: 0, right: this.width, bottom: this.height, width: this.width, height: this.height, toJSON: () => ({}) } as DOMRect;
    };
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.hasPointerCapture = () => false;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.getBoundingClientRect = originalRect;
    Element.prototype.setPointerCapture = originalCapture.set;
    Element.prototype.releasePointerCapture = originalCapture.release;
    Element.prototype.hasPointerCapture = originalCapture.has;
  });

  const base = { background: "#000000", brushColors: ["#ffffff"] as const, tools: ["brush"] as readonly DrawTool[], stageHeight: 200 };

  it("尺寸对象换了身份但数值没变时不重置画布", () => {
    const { rerender } = render(<DrawSurface {...base} size={{ width: 64, height: 64 }} />);
    const afterMount = fillRects;
    expect(afterMount).toBeGreaterThan(0);

    rerender(<DrawSurface {...base} size={{ width: 64, height: 64 }} />);
    rerender(<DrawSurface {...base} size={{ width: 64, height: 64 }} />);

    expect(fillRects).toBe(afterMount);
  });

  it("底色变化时重置画布", () => {
    const { rerender } = render(<DrawSurface {...base} size={{ width: 64, height: 64 }} />);
    const afterMount = fillRects;

    rerender(<DrawSurface {...base} background="#ffffff" size={{ width: 64, height: 64 }} />);

    expect(fillRects).toBe(afterMount + 1);
  });

  /*
   * 自定义笔色被"调色板收回"逻辑当成失效色重置掉，是一个已经发生过的缺陷：那条 effect 原先
   * 依赖 color，而用户挑的自定义色按定义不在 brushColors 内，于是"刚在取色器里确认就被改回第一个
   * 预设"，表现为自定义颜色无效。改稿面板的笔色与草图弹窗的笔色共用这段代码，所以两处一起坏。
   */
  it("取色器里挑的自定义色不会被调色板收回默认色", () => {
    const { container } = render(
      <DrawSurface {...base} brushColors={["#ffffff", "#000000"] as const} size={{ width: 64, height: 64 }} />,
    );
    const custom = container.querySelector<HTMLInputElement>('input[type="color"]');
    expect(custom).not.toBeNull();

    fireEvent.change(custom!, { target: { value: "#abcdef" } });

    expect(custom!.value).toBe("#abcdef");
    expect(custom!.closest("label")?.getAttribute("data-active")).toBe("true");
  });

  /*
   * 改稿画布上的框选必须是描边，不能填充——这是一个已经发生过的缺陷。
   *
   * 标注是叠在候选图上传给模型的：填成实心就把框内的原像素盖死了，模型再也看不到"这里原来是
   * 什么颜色"，只能靠说明猜。描边既指了位置，又把原样留给模型。草图（drawing）模式也走描边，
   * 但那条路是栅格笔迹，所以两种模式分开断言。
   */
  it("改稿上框选落成描边选框（不填充）；草图上仍是栅格描边", () => {
    const marks = render(<DrawSurface {...base} mode="annotation" tools={["rect"]} size={{ width: 64, height: 64 }} />);
    drag(marks.container, 8, 8, 48, 48);
    expect(rectCalls(calls)).toContainEqual([8, 8, 40, 40]);
    expect(ops).toContain("setLineDash");
    expect(ops).toContain("stroke");
    // 填充路径一次都不能出现：它会盖掉框内的原像素。
    expect(ops).not.toContain("fill");

    ops = [];
    calls = [];
    const sketch = render(<DrawSurface {...base} tools={["rect"]} size={{ width: 64, height: 64 }} />);
    drag(sketch.container, 8, 8, 48, 48);
    expect(ops).toContain("stroke");
    expect(ops).not.toContain("fill");
    // 草图仍走栅格：拖动中的形状落成像素要经过 preview 层的 drawImage。
    expect(ops).toContain("drawImage");
  });

  /*
   * 实时移动选框：画好的框要能整体拖走，位置在拖动过程中就跟着走，而不是松手才跳。
   * 这是"拉错了只能重画"的直接反面。
   */
  it("画好的框可以拖动，位置与缩放实时跟随", () => {
    const { container } = render(<DrawSurface {...base} mode="annotation" tools={["rect"]} size={{ width: 64, height: 64 }} />);
    drag(container, 8, 8, 48, 48);

    // 从框内拖动：整框平移 (dx, dy) = (+8, +8)。
    calls = [];
    drag(container, 28, 28, 36, 36);
    expect(rectCalls(calls)).toContainEqual([16, 16, 40, 40]);

    // 抓右下角手柄：外框被拉到 (56,56)，于是变成 48×48。
    calls = [];
    drag(container, 56, 56, 64, 64);
    expect(rectCalls(calls)).toContainEqual([16, 16, 48, 48]);
  });

  it("拖到画布外时选框被夹住，不会被拖到看不见的地方", () => {
    const { container } = render(<DrawSurface {...base} mode="annotation" tools={["rect"]} size={{ width: 64, height: 64 }} />);
    drag(container, 8, 8, 48, 48);

    calls = [];
    drag(container, 28, 28, 200, 200);
    // 40×40 的框在 64×64 的画布上最多移到右下角 (24, 24)。
    expect(rectCalls(calls)).toContainEqual([24, 24, 40, 40]);
  });

  /*
   * 擦除要能删框：框画在独立一层上，`destination-out` 只擦得掉像素层的笔迹，对框完全无效。
   * 少了这条，拉错一个框就只能"清空整张"或撤销（撤销还会连后面的笔迹一起退掉）。
   */
  it("擦除扫过选框会把它删掉", () => {
    const { container } = render(<DrawSurface {...base} mode="annotation" tools={["rect", "erase"]} size={{ width: 64, height: 64 }} />);
    drag(container, 8, 8, 48, 48);
    expect(rectCalls(calls)).toContainEqual([8, 8, 40, 40]);

    // 切到擦除工具（工具条上的分段控件）。
    fireEvent.click(container.querySelector('[aria-label="擦除"]')!);
    const pending = dragUntilPointerUp(container, 4, 28, 56, 28);
    const beforeRelease = ops.length;
    pending.release();
    // 删除发生在松手时：松手之后的那次重绘里不能再有框。
    expect(ops.slice(beforeRelease)).toContain("clearRect");
    expect(ops.slice(beforeRelease)).not.toContain("rect");
  });

  /* 撤销必须把框一起退掉：框与像素层是两个状态，只回滚一边会得到两个时代混在一起的结果。 */
  it("撤销把选框一起退掉", () => {
    const { container } = render(<DrawSurface {...base} mode="annotation" tools={["rect"]} size={{ width: 64, height: 64 }} />);
    drag(container, 8, 8, 48, 48);

    const before = ops.length;
    fireEvent.click(container.querySelector('button[aria-label="撤销"]')!);

    expect(ops.slice(before)).toContain("putImageData");
    expect(ops.slice(before)).not.toContain("rect");
  });

  /*
   * 悬停手柄的光标走 data-hover 属性：只在形状类工具下、且指针确实压在一个选框的手柄上时出现。
   * 少一条"没有框时不是手柄光标"，切工具时残留的缩放光标就会一直骗人。
   */
  it("悬停手柄的光标属性只跟随形状类工具的选框", () => {
    // 画布上还没有框：悬停不该出现手柄光标。
    const rect = render(<DrawSurface {...base} mode="annotation" tools={["rect"]} size={{ width: 64, height: 64 }} />);
    fireEvent(surfaceOf(rect.container), pointerEvent("pointermove", 2, 2));
    expect(surfaceOf(rect.container).getAttribute("data-hover")).toBeNull();

    drag(rect.container, 8, 8, 48, 48);
    fireEvent(surfaceOf(rect.container), pointerEvent("pointermove", 48, 48));
    expect(surfaceOf(rect.container).getAttribute("data-hover")).toBe("se");

    // 画笔不拖框，这个属性必须已经消失。
    const brush = render(<DrawSurface {...base} tools={["brush", "rect"] as readonly DrawTool[]} size={{ width: 64, height: 64 }} />);
    fireEvent(surfaceOf(brush.container), pointerEvent("pointermove", 2, 2));
    expect(surfaceOf(brush.container).getAttribute("data-hover")).toBeNull();
  });

  /*
   * 笔径提示必须随笔径变化。
   *
   * 钉的是画在画布上的覆盖环：半径 = 笔径的一半、圆心在指针处。光标是一张改不了尺寸的图片，
   * 所以粗细只能由画布自己画。滑杆用键盘驱动——antd 的滑块手柄支持 Home/End 直接到两端，
   * 不依赖 jsdom 里根本不存在的布局。
   */
  it("笔迹覆盖环跟着指针走，半径随笔径变化", () => {
    const { container } = render(<DrawSurface {...base} tools={["brush", "rect"] as readonly DrawTool[]} size={{ width: 64, height: 64 }} />);
    const surface = surfaceOf(container);
    const lastArc = () => calls.filter((call) => call.name === "arc").at(-1);

    ops = [];
    calls = [];
    fireEvent(surface, pointerEvent("pointermove", 20, 24));
    // 默认笔径 10 → 半径 5；这笔落下去盖住的就是这么大一块。
    expect(ops).toContain("setLineDash");
    expect(lastArc()?.args).toEqual([20, 24, 5, 0, Math.PI * 2]);

    const slider = container.querySelector('[role="slider"]')!;
    calls = [];
    fireEvent.keyDown(slider, { keyCode: 35 }); // End：笔径到上限 240
    expect(lastArc()?.args[2]).toBe(120);
    fireEvent.keyDown(slider, { keyCode: 36 }); // Home：到底 4
    expect(lastArc()?.args[2]).toBe(2);

    // 切到框选：环撤掉——框选是区域语义，不按笔径，留着这个圈只会让人以为它影响框的大小。
    calls = [];
    fireEvent.click(container.querySelector('[aria-label="矩形"]')!);
    expect(calls.filter((call) => call.name === "arc")).toHaveLength(0);
    fireEvent(surface, pointerEvent("pointermove", 30, 30));
    expect(calls.filter((call) => call.name === "arc")).toHaveLength(0);
  });

  /* 指针离开画布之后环要消失，否则停在边缘的那个圈会被当成"笔还在那儿"。 */
  it("指针离开画布后覆盖环被撤掉", () => {
    const { container } = render(<DrawSurface {...base} tools={["brush"]} size={{ width: 64, height: 64 }} />);
    const surface = surfaceOf(container);
    fireEvent(surface, pointerEvent("pointermove", 20, 24));
    expect(calls.filter((call) => call.name === "arc")).not.toHaveLength(0);

    calls = [];
    fireEvent(surface, new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
    expect(calls.filter((call) => call.name === "arc")).toHaveLength(0);
  });

  /*
   * 自然框选：随手一圈落成一个闭合选框（不闭合的话它连区域都说不清）。
   * 顺带钉住"太小的拖拽不算画过"——一个几乎看不见的框会让界面显示"已画选框"，
   * 模型却只看到原图上多了个杂点。
   */
  it("自然框选落成闭合选框，微小拖拽不算画过", () => {
    const drawn = vi.fn();
    const circled = render(<DrawSurface {...base} mode="annotation" tools={["lasso"]} size={{ width: 64, height: 64 }} onDirtyChange={drawn} />);
    encircle(circled.container);
    expect(ops).toContain("closePath");
    expect(ops).toContain("setLineDash");
    expect(ops).toContain("stroke");
    expect(ops).not.toContain("fill");
    expect(drawn).toHaveBeenCalledWith(true);

    ops = [];
    const nothing = vi.fn();
    const shaky = render(<DrawSurface {...base} mode="annotation" tools={["lasso"]} size={{ width: 64, height: 64 }} onDirtyChange={nothing} />);
    drag(shaky.container, 10, 10, 10.5, 10.5);
    // 松手之后（框被丢弃）的那次重绘里不该再有闭合路径。
    expect(ops.slice(ops.lastIndexOf("clearRect"))).not.toContain("closePath");
    expect(nothing).not.toHaveBeenCalledWith(true);
  });
});
