import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Segmented, Slider, Space, Tooltip } from "antd";
import { ArrowUpRight, Brush, Circle, Eraser, Info, LassoSelect, Maximize, Redo2, Ruler, Square, Trash2, Undo2 } from "lucide-react";
import backdropStyles from "./backdrop.module.css";
import styles from "./DrawSurface.module.css";

/**
 * 共用的绘制面：草图板与改稿标注板都是"在固定尺寸的画布上画，再导出一张 PNG"，
 * 所以共用一个组件，避免历史记录与指针逻辑各写一份。两者的数据契约不同，由 `mode` 表达：
 * 草图导出的图本身就是成品（底色一并导出），改稿导出的是一层标注（未画到的像素透明）。
 *
 * 三个性能与正确性约束：
 * - 已提交的笔迹画在已提交层上，正在拖拽的矩形/椭圆/箭头只画在 preview 层上。
 *   旧实现每移动一次指针就 getImageData + putImageData 整张画布（4K 下 33MB 往返），
 *   这里换成 clearRect + 重绘，没有逐帧的像素回读。
 * - 撤销历史按总字节封顶而不是按条数：4K 下一条快照就是 33MB，按 20 条存会到 660MB。
 * - 尺寸只按宽高**数值**变化判定，绝不按对象身份：调用方普遍内联构造 `size={{ width, height }}`，
 *   按身份判定会让父组件每渲染一次就重置一次画布（详见 `size` 的说明）。
 * - 视图的缩放/平移只作用在 CSS transform 上，从不改画布尺寸、不进导出。这样坐标换算可以一直用
 *   `getBoundingClientRect()`：它把 transform 算进去，于是任意缩放下落笔位置都还是对的。
 *
 * 底图（imageUrl）只用于对齐，永远不进入导出：草图要表达的是"位置与比例"，把底图的像素
 * 一起交出去会让模型去复制底图的内容；改稿的标注层由服务端叠到候选图上，在这里再叠一次
 * 只是把同一张图算两遍。
 */

export type DrawTool = "brush" | "lasso" | "rect" | "ellipse" | "arrow" | "erase";

/** 形状类工具：在改稿画布上它们是**选框**（可选中、可移动、可缩放），不是涂上去的色块。 */
const SHAPE_TOOLS = ["lasso", "rect", "ellipse"] as const;
type ShapeTool = (typeof SHAPE_TOOLS)[number];

function isShapeTool(tool: DrawTool): tool is ShapeTool {
  return (SHAPE_TOOLS as readonly DrawTool[]).includes(tool);
}

export interface DrawSurfaceHandle {
  /** 导出当前画布；没有任何笔迹与选框时返回 null。 */
  exportPng: () => Promise<Blob | null>;
  clear: () => void;
}

interface Point { x: number; y: number; }
interface Bounds { x: number; y: number; width: number; height: number; }
/** 选框上的抓取点：八个手柄，加上"整框拖动"。 */
type ShapeHandle = "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/**
 * 一个选框。
 *
 * 存点集而不是存外框：矩形/椭圆是两点，套索是一串轨迹点，缩放时整组点一起做仿射变换，
 * 三种形状因此共用同一套手柄数学——不必为套索再写一份。
 *
 * 选框只描边、不填充，这一点是有意的：标注要叠在候选图上传给模型，填成实心就把框内的原像素
 * 盖死了，模型再也看不到"这里原来是什么颜色"，只能靠说明猜。描边既指了位置，又把原样留给模型。
 */
interface Mark { id: string; tool: ShapeTool; points: Point[]; color: string; }

/** 一次落笔前的完整状态：像素层与选框都必须一起回滚，只回滚一边会得到两个时代混在一起的结果。 */
interface HistoryEntry { image: ImageData | null; marks: Mark[]; ink: boolean; }

interface DrawSurfaceProps {
  /**
   * 画布的自然尺寸；给 null 时按底图的实际像素测量。
   *
   * 允许内联构造（`size={{ width, height }}`）——尺寸变化只比较宽高数值，不看对象身份。
   * 早前这里以对象身份为依赖，而落笔会经 onDirtyChange 触发父组件渲染，于是每画一笔父组件
   * 重渲染一次、画布就被重置一次，表现是"画一下就没了"。
   */
  size: { width: number; height: number } | null;
  /** 仅用于显示对齐的底图。 */
  imageUrl?: string | null;
  /**
   * 画布模式。两者差的不是配色而是**导出的东西是什么**：
   * - `drawing`：导出所见即所得的一张成品图（草图参考图），底色用 `background`。
   * - `annotation`：导出叠在候选图上的一层标注——未画到的像素透明，颜色就是用户挑的笔色本身；
   *   形状类工具在这里是可调整的选框（见 `Mark`）。
   *
   * 改稿必须走第二种：标注要能被服务端原样叠到候选图上，所以它不能带一层自己的底色；
   * 而笔色在这里是**要表达的颜色**，不是"标记色"，不能像选区蒙版那样随手换成任意看得见的颜色。
   */
  mode?: "drawing" | "annotation";
  /**
   * `drawing` 模式的画布底色；`annotation` 模式下恒为透明（未画到的像素必须能透出底图）。
   *
   * 纯黑/纯白在这里是**数据**而不是界面用色：草图的底要交给模型当参考图，两个极值才不会有歧义。
   * 设计 token 里"禁纯黑纯白"约束的是界面，不约束这张图的内容。
   */
  background?: string;
  brushColors: readonly string[];
  tools: readonly DrawTool[];
  /**
   * 舞台高度。
   *
   * 给长度就是固定高度（草图弹窗用它，弹窗本身按内容撑开）；
   * 给 `"fill"` 表示吃掉父容器剩下的高度——绘制态用它：那块区域是定高的，
   * 画布写死高度的话，剩下的空间会变成画布下方一整片空白，画布本身反倒没利用上。
   */
  stageHeight?: number | string;
  /** 舞台底色。透明像素靠它落地，默认给中性面板底；改稿绘制态要传用户当前选的那块预览底色。 */
  stageBackdrop?: StageBackdrop;
  /**
   * 有底图时画布怎么叠在底图上：
   * - `tracing`：半透明压盖，白底草图用（底图只是描摹参考）。
   * - `overlay`：笔迹以半透明色洗叠在底图上（改稿标注用）——画的时候要看得见底图，
   *   否则一笔就把要改的地方盖住，位置便无从判断。
   */
  underlayDisplay?: "tracing" | "overlay";
  onDirtyChange?: (dirty: boolean) => void;
}

export type StageBackdrop = "checker" | "white" | "black" | "surface";

/** 撤销历史的总字节上限。 */
const HISTORY_BUDGET_BYTES = 192 * 1024 * 1024;
const HISTORY_MAX_ENTRIES = 24;
const MIN_BRUSH = 4;
const MAX_BRUSH = 240;
/** 画布与舞台边缘之间留白的单边像素；缩放时从可用空间里扣掉。 */
const STAGE_MARGIN = 12;
const DEFAULT_STAGE_HEIGHT = "min(56vh, 520px)";

/** 缩放范围：1 表示"适应窗口"。下限留够预览余地，上限到能看清单像素边缘。 */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
/** 滚轮灵敏度：一格滚轮（deltaY≈100）约缩放 1.2 倍；乘法步进让手感在各倍率下一致。 */
const WHEEL_ZOOM_SENSITIVITY = 0.0018;

/** 手柄的用色与工作台的编辑蓝一致：它是操作提示，不属于用户画的内容，绝不进导出。 */
const HANDLE_COLOR = "#1888f2";
const HANDLE_FILL = "#f8fbff";

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

/**
 * 平移量的上限：画布中心最远只能拖到舞台边缘。
 *
 * 不设上限的话图可以被拖到完全看不见，用户会以为画布空了；这里保证任何时刻都还有一部分在视野里，
 * 而且"点一下百分比就回到适应窗口"，不需要用户自己去猜怎么找回来。
 */
function clampPan(value: number, span: number): number {
  const limit = Math.max(0, span / 2);
  return Math.max(-limit, Math.min(limit, value));
}

const TOOL_LABELS: Record<DrawTool, { label: string; icon: typeof Brush }> = {
  brush: { label: "画笔", icon: Brush },
  lasso: { label: "自然框选", icon: LassoSelect },
  rect: { label: "矩形", icon: Square },
  ellipse: { label: "椭圆", icon: Circle },
  arrow: { label: "箭头", icon: ArrowUpRight },
  erase: { label: "擦除", icon: Eraser },
};

/**
 * 工具名随模式变。
 *
 * 同一个"矩形"在两块画布上是两件事：草图上它是画出来的空心形状，改稿上它是一个可以拖动缩放的选框。
 * 沿用同一个名字，用户会以为草图上的矩形也能拖。
 */
function toolLabel(tool: DrawTool, annotating: boolean): string {
  if (!annotating) return TOOL_LABELS[tool].label;
  if (tool === "rect") return "矩形框选";
  if (tool === "ellipse") return "椭圆框选";
  return TOOL_LABELS[tool].label;
}

/** 显式列全会用到的键，而不是 `styles[stageBackdrop]`：键写错时这里会直接报缺键，字符串索引不会。 */
const STAGE_BACKDROPS = {
  checker: backdropStyles.checker,
  white: backdropStyles.white,
  black: backdropStyles.black,
  surface: backdropStyles.surface,
} satisfies Record<StageBackdrop, string | undefined>;

/** 画笔默认笔径。细笔起步：默认值应当适合描线与修边，粗笔是"想画大块"时才去调的。 */
const DEFAULT_BRUSH = 10;

/**
 * 框选类工具的最小成区面积（画布像素²）。
 *
 * 小于它的拖拽当成"没画"：手抖点一下会落下一个几乎看不见的小框，界面却会显示"已画选框"，
 * 用户以为自己指明了要改的地方，模型看到的只是原图上多了一个杂点。宁可当没画过。
 */
const MIN_SHAPE_AREA = 64;

/** 套索路径的抽稀步长（画布像素）。低于它的位移不新增顶点，路径够描述形状就行。 */
const LASSO_MIN_STEP = 2;

/**
 * 选框线的粗细。按画布宽度取比例、与笔径滑杆无关：选框是区域语义，
 * 用画笔那档笔径会画出一圈几十像素的粗边，反而把框住的画面糊掉。
 */
function markLineWidth(canvasWidth: number): number {
  return Math.max(3, Math.round(canvasWidth / 250));
}

/** 选框的虚线节奏跟着线宽走，换任何尺寸的画布看起来都是同一种线。 */
function markDash(lineWidth: number): number[] {
  return [lineWidth * 3, lineWidth * 2];
}

function markBounds(mark: Mark): Bounds {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of mark.points) {
    left = Math.min(left, point.x); right = Math.max(right, point.x);
    top = Math.min(top, point.y); bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 把一组点从旧外框仿射到新外框：矩形、椭圆、套索共用这一份缩放数学。 */
function mapPoints(points: readonly Point[], from: Bounds, to: Bounds): Point[] {
  const scaleX = from.width === 0 ? 1 : to.width / from.width;
  const scaleY = from.height === 0 ? 1 : to.height / from.height;
  return points.map((point) => ({ x: to.x + (point.x - from.x) * scaleX, y: to.y + (point.y - from.y) * scaleY }));
}

/** 拖动整框：整体平移，并夹在画布内——框被拖到画布外就既看不见也拖不回来了。 */
function moveMark(mark: Mark, from: Point, to: Point, width: number, height: number): Mark {
  const bounds = markBounds(mark);
  const dx = Math.max(-bounds.x, Math.min(width - bounds.x - bounds.width, to.x - from.x));
  const dy = Math.max(-bounds.y, Math.min(height - bounds.y - bounds.height, to.y - from.y));
  return { ...mark, points: mark.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
}

/** 拉手柄：先按工作台的规则算出新外框，再把点集映射进去。 */
function resizeMark(mark: Mark, handle: Exclude<ShapeHandle, "move">, point: Point, width: number, height: number): Mark {
  const minSize = 8;
  const bounds = markBounds(mark);
  let left = bounds.x;
  let right = bounds.x + bounds.width;
  let top = bounds.y;
  let bottom = bounds.y + bounds.height;
  if (handle.includes("w")) left = Math.max(0, Math.min(right - minSize, point.x));
  if (handle.includes("e")) right = Math.min(width, Math.max(left + minSize, point.x));
  if (handle.includes("n")) top = Math.max(0, Math.min(bottom - minSize, point.y));
  if (handle.includes("s")) bottom = Math.min(height, Math.max(top + minSize, point.y));
  const next: Bounds = { x: left, y: top, width: right - left, height: bottom - top };
  return { ...mark, points: mapPoints(mark.points, bounds, next) };
}

/** 八个手柄的位置，顺序与 `ShapeHandle` 一致。 */
function handlePositions(bounds: Bounds): Array<[Exclude<ShapeHandle, "move">, number, number]> {
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  return [
    ["nw", left, top], ["n", left + bounds.width / 2, top], ["ne", right, top],
    ["e", right, top + bounds.height / 2], ["se", right, bottom],
    ["s", left + bounds.width / 2, bottom], ["sw", left, bottom], ["w", left, top + bounds.height / 2],
  ];
}

/**
 * 命中判定：手柄优先，其次边框附近算"移动"，再次框内也算"移动"。
 *
 * 手柄必须先判：手柄就压在外框上，先判边框的话，想拉角点会被当成拖整框，位置永远调不准。
 * 容差按显示比例放大（`tolerance` 由调用方按画布/屏幕比例算），否则缩小显示时手柄会点不中。
 */
function shapeHandleAt(bounds: Bounds, point: Point, tolerance: number): ShapeHandle | null {
  const hit = handlePositions(bounds).find(([, x, y]) => Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance);
  if (hit) return hit[0];
  const inRangeX = point.x >= bounds.x - tolerance && point.x <= bounds.x + bounds.width + tolerance;
  const inRangeY = point.y >= bounds.y - tolerance && point.y <= bounds.y + bounds.height + tolerance;
  return inRangeX && inRangeY ? "move" : null;
}

/**
 * 悬停时的笔迹覆盖环：半径就是笔径的一半，画出来的是这一笔实际会盖住的那块。
 *
 * 画在画布上而不是做成 CSS 光标，是因为光标是一张固定尺寸的图片：改不了大小，笔径从 4 调到 240
 * 它还是同一个圈，用户依旧不知道笔有多粗；而且画布缩放后笔径换算到屏幕像素会超过浏览器的光标图上限
 * （Chrome 为 128 逻辑像素），放大到一定程度光标会整个消失。工作台编辑的笔刷环同样画在画布上。
 * 线宽与虚线节奏按画布宽度取比例，大图上才不会细得看不见。
 */
function paintFootprint(context: CanvasRenderingContext2D, point: Point, radius: number, canvasWidth: number, color: string): void {
  context.save();
  context.lineWidth = Math.max(2, canvasWidth / 700);
  context.setLineDash([Math.max(5, canvasWidth / 150), Math.max(4, canvasWidth / 190)]);
  context.strokeStyle = color;
  context.beginPath();
  context.arc(point.x, point.y, Math.max(1, radius), 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

/**
 * 覆盖环的用色。
 *
 * 画笔跟随当前笔色——环同时说明"多粗"和"什么颜色"。擦除得跟画布分开看：改稿的擦除落在透明画布上
 * （底下是照片），近白可见；草图的底色是一整张白纸，近白的环等于没有，得用中灰。
 */
function footprintColor(annotating: boolean, tool: DrawTool, brushColor: string): string {
  if (tool !== "erase") return brushColor;
  return annotating ? "#f0f3f5" : "#5b6570";
}

/** 把一条选框画到给定上下文（画布显示与导出共用，导出时不传 selectedId，手柄不落盘）。 */
function paintMarks(context: CanvasRenderingContext2D, marks: readonly Mark[], width: number, dashed: boolean): void {
  for (const mark of marks) {
    const bounds = markBounds(mark);
    context.save();
    context.strokeStyle = mark.color;
    context.lineWidth = width;
    context.lineJoin = "round";
    context.setLineDash(dashed ? markDash(width) : []);
    context.beginPath();
    if (mark.tool === "rect") {
      context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    } else if (mark.tool === "ellipse") {
      context.ellipse(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width / 2, bounds.height / 2, 0, 0, Math.PI * 2);
    } else {
      // 松手才闭合，但显示时立刻连回起点：用户要能当场看见"圈住的这块"就是最终那一个框。
      const first = mark.points[0];
      if (!first) continue;
      context.moveTo(first.x, first.y);
      for (const point of mark.points.slice(1)) context.lineTo(point.x, point.y);
      context.closePath();
    }
    context.stroke();
    context.restore();
  }
}

/** 选中框的八个手柄。画在显示层，永不进导出——它是操作提示，不是用户画的内容。 */
function paintHandles(context: CanvasRenderingContext2D, bounds: Bounds, canvasWidth: number): void {
  const half = Math.max(4, canvasWidth / 180);
  context.save();
  context.setLineDash([]);
  context.fillStyle = HANDLE_FILL;
  context.strokeStyle = HANDLE_COLOR;
  context.lineWidth = Math.max(2, canvasWidth / 650);
  for (const [, x, y] of handlePositions(bounds)) {
    context.fillRect(x - half, y - half, half * 2, half * 2);
    context.strokeRect(x - half, y - half, half * 2, half * 2);
  }
  context.restore();
}

/** 框选拖拽出来的区域面积（画布像素²）。只用来判断"这算不算一次有效框选"，自交之类的边角情况不必精确。 */
function shapeArea(tool: ShapeTool, from: Point, to: Point, points: readonly Point[]): number {
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  if (tool === "rect") return width * height;
  if (tool === "ellipse") return (Math.PI / 4) * width * height;
  if (points.length < 3) return 0;
  // 鞋带公式：套索是一圈随手画的闭合多边形。
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twice += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twice) / 2;
}

/** 落笔期间的状态。一次只允许一件事：要么在涂，要么在拖/缩放一个框，要么在画一个新框。 */
interface Interaction {
  start: Point;
  last: Point;
  before: HistoryEntry | null;
  /**
   * 正在移动/缩放的已有框；null 表示这次落笔会新建一个框或不涉及框。
   *
   * 存的是落笔那一刻的原框，不是"当前框"：移动/缩放都要从原位重算绝对值，
   * 按当前框叠加增量的话，每次指针移动都会把上一段的位移再算一遍，框会越拖越飘。
   */
  origin: Mark | null;
  handle: ShapeHandle | null;
  /** 套索轨迹（抽稀后的点）。 */
  points: Point[];
  /** 擦除扫过的范围，松手时用它决定哪些框该一起删掉。 */
  erased: Bounds | null;
  moved: boolean;
}

/** 落笔点周围的正方形范围，用来累积"擦除扫过哪里"。 */
function brushBounds(point: Point, size: number): Bounds {
  return { x: point.x - size / 2, y: point.y - size / 2, width: size, height: size };
}

function mergeBounds(current: Bounds | null, next: Bounds): Bounds {
  if (!current) return next;
  const x = Math.min(current.x, next.x);
  const y = Math.min(current.y, next.y);
  return { x, y, width: Math.max(current.x + current.width, next.x + next.width) - x, height: Math.max(current.y + current.height, next.y + next.height) - y };
}

function intersects(left: Bounds, right: Bounds): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

export const DrawSurface = forwardRef<DrawSurfaceHandle, DrawSurfaceProps>(function DrawSurface(
  { size, imageUrl, mode = "drawing", background = "#ffffff", brushColors, tools, stageHeight = DEFAULT_STAGE_HEIGHT, stageBackdrop = "surface", underlayDisplay = "tracing", onDirtyChange },
  ref,
) {
  const annotating = mode === "annotation";
  const fillsStage = stageHeight === "fill";
  /**
   * 未标记区域的实际底色。标注层恒为透明：那些像素要能透出底图，最终由服务端叠成源图。
   * 用 `baseColor` 而不是 `background` 进 reset 的依赖，底色以外的改动才不会白白重置画布。
   */
  const baseColor = annotating ? "transparent" : background;
  /**
   * 擦除的落笔色。标注层走 `destination-out`，源色的 alpha 必须为 1——
   * "transparent" 解析成 alpha 0，用它擦除等于什么都没擦。
   */
  const eraserPaint = annotating ? "#000000" : baseColor;
  const committedRef = useRef<HTMLCanvasElement | null>(null);
  const markLayerRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<HistoryEntry[]>([]);
  const redoRef = useRef<HistoryEntry[]>([]);
  const drawingRef = useRef<Interaction | null>(null);
  const dirtyRef = useRef(false);
  const markSeqRef = useRef(0);
  // 回调走 ref：它由调用方内联传入，每次渲染都换身份，不能让它进 reset 的依赖。
  const onDirtyChangeRef = useRef(onDirtyChange);
  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number } | null>(null);
  const [stageBox, setStageBox] = useState<{ width: number; height: number } | null>(null);
  const [tool, setTool] = useState<DrawTool>(tools[0] ?? "brush");
  const [color, setColor] = useState(brushColors[0] ?? "#fff");
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  /**
   * 指针当前悬停在哪个手柄上，只用来决定光标形状。
   *
   * 光标不直接用 JS 写 `style.cursor`：那样写进去之后就再没有人负责复位，切工具或指针离开画布
   * 之后会残留成与实际动作不符的形状。这里只报"悬停在什么上面"，形状由样式表按属性决定。
   */
  const [hoverHandle, setHoverHandle] = useState<ShapeHandle | null>(null);
  /**
   * 指针在画布上的最后位置（画布像素）。
   *
   * 走 ref 而不是 state：覆盖环要跟着指针逐帧移动，每动一下都触发一次渲染不值得；
   * 绘制时机由指针事件直接驱动（见 `drawMarkLayer`）。
   */
  const hoverPointRef = useRef<Point | null>(null);
  /** 正在画、还没落定的那个框：画到一半也要看得见，否则松手前完全不知道自己框到了哪。 */
  const [draft, setDraft] = useState<Mark | null>(null);
  const [historyDepth, setHistoryDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
  /**
   * 视图变换：缩放与平移。**只影响显示**——画布、导出与坐标全部仍是原生像素。
   *
   * 用 CSS transform 而不是重设画布尺寸：`getBoundingClientRect()` 会把 transform 算进去，
   * 于是现有的坐标换算 `(clientX - rect.left) / rect.width * canvas.width` 在任意缩放下都成立，
   * 落笔位置不需要另写一套数学。
   */
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  /**
   * 当前笔色是不是用户在取色器里自己挑的。
   *
   * 自定义色按定义不在 brushColors 内，长得和"调色板换掉后残留的旧色"一模一样；
   * 没有这个标记，下面那条收回逻辑就会把刚挑好的颜色当成失效色重置掉。
   */
  const customColorRef = useRef(false);
  /** 画布上是否已有内容。撤销要把它一起回滚，所以它跟着历史条目走（见 `HistoryEntry.ink`）。 */
  const inkRef = useRef(false);

  useEffect(() => { onDirtyChangeRef.current = onDirtyChange; }, [onDirtyChange]);

  const givenWidth = size?.width ?? null;
  const givenHeight = size?.height ?? null;
  const canvasWidth = givenWidth ?? measuredSize?.width ?? null;
  const canvasHeight = givenHeight ?? measuredSize?.height ?? null;
  // memo 保证同样的宽高得到同一个对象身份，reset 才能安全地把它当依赖。
  const dimensions = useMemo(
    () => (canvasWidth && canvasHeight ? { width: canvasWidth, height: canvasHeight } : null),
    [canvasWidth, canvasHeight],
  );

  /*
   * 调色板换了、且当前笔色是这套里已经不存在的旧色时，收回第一个。
   *
   * 依赖里不能有 color：用户挑的自定义色按定义不在 brushColors 内，一放进去就变成
   * "刚在取色器里确认就被改回预设"，表现出来就是自定义颜色没生效。
   * 用户显式挑过的颜色由 customColorRef 兜底，任何调色板变更都不覆盖它。
   */
  useEffect(() => {
    if (!brushColors.length) return;
    setColor((current) => (customColorRef.current || brushColors.includes(current) ? current : brushColors[0]!));
  }, [brushColors]);

  // 未给定尺寸时按底图实际像素测量：画布坐标必须与原图逐像素对齐，后续合成才有意义。
  useEffect(() => {
    if (givenWidth && givenHeight) return;
    if (!imageUrl) {
      setMeasuredSize(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const response = await fetch(imageUrl);
      const bitmap = await createImageBitmap(await response.blob());
      if (cancelled) { bitmap.close(); return; }
      setMeasuredSize({ width: bitmap.width, height: bitmap.height });
      bitmap.close();
    })();
    return () => { cancelled = true; };
  }, [givenWidth, givenHeight, imageUrl]);

  // 量舞台可用空间：画布要按容器实际尺寸做 contain 缩放，光靠 CSS 的 aspect-ratio 无法同时受宽高约束。
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setStageBox({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // 滚轮缩放。必须挂在原生事件上而不是 React 的 onWheel：React 在根容器上注册的 wheel 是
  // passive 的，handler 里的 preventDefault 会被忽略，滚轮会连带把外面的面板一起滚走。
  //
  // 缩放以光标为锚点：光标下的那个点缩放前后停在原处，否则放大一次就得重新找刚才看的位置。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = stage.getBoundingClientRect();
      // 光标相对舞台中心的位置；舞台中心就是"未平移时画布中心"所在处。
      const cursorX = event.clientX - box.left - box.width / 2;
      const cursorY = event.clientY - box.top - box.height / 2;
      setView((prev) => {
        const zoom = clampZoom(prev.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY));
        const ratio = zoom / prev.zoom;
        return {
          zoom,
          x: clampPan(cursorX - (cursorX - prev.x) * ratio, box.width),
          y: clampPan(cursorY - (cursorY - prev.y) * ratio, box.height),
        };
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  /** 舞台内的实际显示尺寸；保持原生比例，两边都不越界。 */
  const frameSize = useMemo(() => {
    if (!dimensions || !stageBox) return null;
    const availableWidth = stageBox.width - STAGE_MARGIN * 2;
    const availableHeight = stageBox.height - STAGE_MARGIN * 2;
    if (availableWidth <= 0 || availableHeight <= 0) return null;
    const scale = Math.min(availableWidth / dimensions.width, availableHeight / dimensions.height);
    return {
      width: Math.max(1, Math.round(dimensions.width * scale)),
      height: Math.max(1, Math.round(dimensions.height * scale)),
    };
  }, [dimensions, stageBox]);

  // 只有 ref 不触发重渲染：这个值只被导出时读一次，页面不需要因为它重绘。
  const reportDirty = useCallback((value: boolean) => {
    if (dirtyRef.current === value) return;
    dirtyRef.current = value;
    onDirtyChangeRef.current?.(value);
  }, []);

  /** 重置为底色、清空选框与预览层；历史一并丢弃。 */
  const reset = useCallback(() => {
    const canvas = committedRef.current;
    const preview = previewRef.current;
    const layer = markLayerRef.current;
    if (!canvas || !dimensions) return;
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.globalCompositeOperation = "source-over";
    // 透明底不能"填成透明的"（source-over 画一层 alpha 0 等于没画），只能清掉。
    if (baseColor === "transparent") context.clearRect(0, 0, canvas.width, canvas.height);
    else {
      context.fillStyle = baseColor;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (layer) {
      layer.width = dimensions.width;
      layer.height = dimensions.height;
      layer.getContext("2d")?.clearRect(0, 0, layer.width, layer.height);
    }
    if (preview) {
      preview.width = dimensions.width;
      preview.height = dimensions.height;
      preview.getContext("2d")?.clearRect(0, 0, preview.width, preview.height);
    }
    historyRef.current = [];
    redoRef.current = [];
    setHistoryDepth(0);
    setRedoDepth(0);
    setMarks([]);
    setSelectedMarkId(null);
    setDraft(null);
    inkRef.current = false;
    // 换了画布就回到适应窗口：上一个尺寸下的缩放与平移对这个新画布没有意义。
    setView({ zoom: 1, x: 0, y: 0 });
    reportDirty(false);
  }, [baseColor, dimensions, reportDirty]);

  // 依赖全是稳定值：只在真正换画布（尺寸或底色变了）时重置，不随父组件渲染重置。
  useEffect(() => { reset(); }, [reset]);

  // 每张快照 w×h×4 字节；先按预算算能留几条，再用固定条数封顶，小图上不至于留下上百条。
  const historyLimit = dimensions ? Math.max(1, Math.min(HISTORY_MAX_ENTRIES, Math.floor(HISTORY_BUDGET_BYTES / (dimensions.width * dimensions.height * 4)))) : 1;

  const snapshot = useCallback((): ImageData | null => {
    const canvas = committedRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return null;
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }, []);

  const pushHistory = useCallback((previous: HistoryEntry | null) => {
    if (!previous) return;
    historyRef.current = [...historyRef.current, previous].slice(-historyLimit);
    redoRef.current = [];
    setHistoryDepth(historyRef.current.length);
    setRedoDepth(0);
  }, [historyLimit]);

  /** 当前完整状态；落笔前先取一份，作为"撤销回到这一步"的目标。 */
  const capture = (): HistoryEntry => ({ image: snapshot(), marks, ink: inkRef.current });

  const pointFor = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = committedRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, ((event.clientX - rect.left) / rect.width) * canvas.width)),
      y: Math.max(0, Math.min(canvas.height, ((event.clientY - rect.top) / rect.height) * canvas.height)),
    };
  };

  /** 画布像素与屏幕像素的比例。手柄命中容差要按它放大，缩小显示时才点得中。 */
  const displayScale = (canvas: HTMLCanvasElement): number => {
    const displayWidth = canvas.getBoundingClientRect().width || canvas.width;
    return canvas.width / Math.max(1, displayWidth);
  };

  const paintStyleFor = (activeTool: DrawTool) => (activeTool === "erase" ? eraserPaint : color);
  /** 透明底上的擦除要真的把像素去掉；有底色的草图则是把底色涂回去。 */
  const compositeFor = (activeTool: DrawTool) => (activeTool === "erase" && annotating ? "destination-out" : "source-over") as GlobalCompositeOperation;

  const paintSegment = (from: Point, to: Point) => {
    const context = committedRef.current?.getContext("2d");
    if (!context) return;
    context.globalCompositeOperation = compositeFor(tool);
    context.strokeStyle = paintStyleFor(tool);
    context.fillStyle = paintStyleFor(tool);
    context.lineWidth = brushSize;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    // 单独补一个圆点：只落一次指针而不移动时，线段长度为 0 什么也画不出来。
    context.beginPath();
    context.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
    context.fill();
  };

  /** 把拖拽中的形状画到预览层；只清预览层，不触碰已提交的笔迹，也没有像素回读。 */
  const paintPreview = (from: Point, to: Point, points: readonly Point[] = []) => {
    const preview = previewRef.current;
    const context = preview?.getContext("2d");
    if (!preview || !context) return;
    context.clearRect(0, 0, preview.width, preview.height);
    context.globalCompositeOperation = compositeFor(tool);
    context.strokeStyle = paintStyleFor(tool);
    context.fillStyle = paintStyleFor(tool);
    context.lineWidth = brushSize;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    if (tool === "rect") {
      context.rect(Math.min(from.x, to.x), Math.min(from.y, to.y), Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    } else if (tool === "ellipse") {
      context.ellipse((from.x + to.x) / 2, (from.y + to.y) / 2, Math.abs(to.x - from.x) / 2, Math.abs(to.y - from.y) / 2, 0, 0, Math.PI * 2);
    } else if (tool === "lasso") {
      if (points.length > 1) {
        context.moveTo(points[0]!.x, points[0]!.y);
        for (const point of points.slice(1)) context.lineTo(point.x, point.y);
        context.closePath();
      }
    } else {
      // 箭头：主杆 + 两条尾翼；尾翼长度随线长收缩，避免短线画成一个大三角。
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = Math.max(brushSize, Math.hypot(to.x - from.x, to.y - from.y) * 0.25);
      context.moveTo(to.x, to.y);
      context.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7));
      context.moveTo(to.x, to.y);
      context.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7));
    }
    // 形状一律只描边：fill 会把框住的画面盖掉（改稿的框见 `Mark`，那里连像素都不落）。
    context.stroke();
  };

  const commitPreview = () => {
    const preview = previewRef.current;
    const context = committedRef.current?.getContext("2d");
    if (!preview || !context) return;
    // 必须显式复位合成模式：上一步若是擦除，上下文会停在 destination-out 上，
    // 这一次的贴图就会变成"把刚画好的形状擦掉"。
    context.globalCompositeOperation = "source-over";
    context.drawImage(preview, 0, 0);
    preview.getContext("2d")?.clearRect(0, 0, preview.width, preview.height);
  };

  /*
   * 选框画在独立的一层上，而不是塞进已提交的像素层：选框在落定前后都要能被整体拖动与缩放，
   * 一旦烧进像素就只能靠擦除重画。层本身不吃指针事件，交互统一由最上面的 preview 层接。
   *
   * 覆盖环也画在这一层（它同样不是用户画的内容，导出时由 `exportPng` 重新栅格化，不会带上）。
   * 指针每动一下环就要跟着动，而指针移动不触发 React 渲染，所以同一份绘制逻辑既供给 layout effect，
   * 也通过 ref 供给指针事件里的即时重绘——ref 指向最新一次渲染的闭包，笔径、选区都在里面。
   */
  const drawMarkLayer = useCallback(() => {
    const layer = markLayerRef.current;
    const context = layer?.getContext("2d");
    if (!layer || !context || !dimensions) return;
    if (layer.width !== dimensions.width || layer.height !== dimensions.height) {
      layer.width = dimensions.width;
      layer.height = dimensions.height;
    }
    context.clearRect(0, 0, layer.width, layer.height);
    const width = markLineWidth(layer.width);
    paintMarks(context, marks, width, annotating);
    if (draft) paintMarks(context, [draft], width, annotating);
    const selected = marks.find((mark) => mark.id === selectedMarkId);
    if (selected) paintHandles(context, markBounds(selected), layer.width);
    const hover = hoverPointRef.current;
    if (hover && (tool === "brush" || tool === "erase")) {
      paintFootprint(context, hover, brushSize / 2, layer.width, footprintColor(annotating, tool, color));
    }
  }, [annotating, brushSize, color, dimensions, draft, marks, selectedMarkId, tool]);

  const drawMarkLayerRef = useRef(drawMarkLayer);
  drawMarkLayerRef.current = drawMarkLayer;
  useLayoutEffect(() => { drawMarkLayer(); }, [drawMarkLayer]);

  /** 命中已有的框：先手柄后框内，倒序找——后画的在上层，用户点到的应当是看得见的那个。 */
  const markHitAt = (point: Point, tolerance: number): { mark: Mark; handle: ShapeHandle } | null => {
    for (const mark of [...marks].reverse()) {
      const handle = shapeHandleAt(markBounds(mark), point, tolerance);
      if (handle) return { mark, handle };
    }
    return null;
  };

  const commitInk = (before: HistoryEntry | null) => {
    pushHistory(before);
    inkRef.current = true;
    reportDirty(true);
  };

  /*
   * 擦除顺手把扫过的框删掉。
   *
   * 不这么做的话，擦除对框完全无效——框画在独立一层上，`destination-out` 只能擦掉像素层的笔迹。
   * 用户把一个框拉错了地方，除了"清空整张"与撤销就没有第三条路，而撤销会连后面的笔迹一起退掉。
   */
  const dropErasedMarks = (erased: Bounds | null) => {
    if (!erased || !marks.length) return;
    const survivors = marks.filter((mark) => !intersects(markBounds(mark), erased));
    if (survivors.length === marks.length) return;
    setMarks(survivors);
    setSelectedMarkId(null);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dimensions) return;
    // 只有左键落笔。右键留给平移（见舞台上的 onStagePointerDown），否则右键拖拽会一边平移一边画。
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFor(event);
    const before = capture();

    if (annotating && isShapeTool(tool)) {
      // 先找已经画好的框：手柄或框内都算命中，命中的话这次拖拽就是移动/缩放，不再新建。
      const hit = markHitAt(point, Math.max(6, 8 * displayScale(event.currentTarget)));
      if (hit) {
        setSelectedMarkId(hit.mark.id);
        setHoverHandle(hit.handle);
        drawingRef.current = { start: point, last: point, before, origin: hit.mark, handle: hit.handle, points: [], erased: null, moved: false };
        return;
      }
      setSelectedMarkId(null);
      drawingRef.current = { start: point, last: point, before, origin: null, handle: null, points: tool === "lasso" ? [point] : [], erased: null, moved: false };
      setDraft({ id: `draft-${markSeqRef.current}`, tool, points: [point, point], color });
      return;
    }

    drawingRef.current = { start: point, last: point, before, origin: null, handle: null, points: tool === "lasso" ? [point] : [], erased: tool === "erase" ? brushBounds(point, brushSize) : null, moved: false };
    if (tool === "brush" || tool === "erase") paintSegment(point, point);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dimensions) return;
    const drawing = drawingRef.current;
    if (!drawing) {
      // 没落笔时只更新悬停状态：拖到框上要能看出"这里可以拖/这里可以拉"，涂的时候要看得见笔有多粗。
      const point = pointFor(event);
      hoverPointRef.current = point;
      if (tool === "brush" || tool === "erase") drawMarkLayerRef.current();
      if (!annotating || !isShapeTool(tool)) return;
      const hit = markHitAt(point, Math.max(6, 8 * displayScale(event.currentTarget)));
      const next = hit?.handle ?? null;
      setHoverHandle((current) => (current === next ? current : next));
      return;
    }
    const point = pointFor(event);
    drawing.moved = true;

    if (annotating && isShapeTool(tool)) {
      if (drawing.origin && drawing.handle) {
        // 实时改：每一次指针移动都从原框重算并写回状态，松手时它已经在最终位置。
        const origin = drawing.origin;
        const next = drawing.handle === "move"
          ? moveMark(origin, drawing.start, point, dimensions.width, dimensions.height)
          : resizeMark(origin, drawing.handle, point, dimensions.width, dimensions.height);
        setMarks((current) => current.map((mark) => (mark.id === next.id ? next : mark)));
      } else {
        if (tool === "lasso") {
          // 按距离抽稀：指针事件的密度远高于路径需要的精度，全收下来在高分辨率画布上会堆出几千个顶点。
          const last = drawing.points[drawing.points.length - 1];
          if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= LASSO_MIN_STEP) drawing.points.push(point);
        }
        setDraft({ id: `draft-${markSeqRef.current}`, tool, points: tool === "lasso" ? [...drawing.points] : [drawing.start, point], color });
      }
      drawing.last = point;
      return;
    }

    if (tool === "brush" || tool === "erase") {
      paintSegment({ x: drawing.last.x, y: drawing.last.y }, point);
      if (tool === "erase") drawing.erased = mergeBounds(drawing.erased, brushBounds(point, brushSize));
      // 环跟着笔走：涂的时候它是"已经涂到哪、还差哪"的参照，落笔期间同样要看得见。
      hoverPointRef.current = point;
      drawMarkLayerRef.current();
    } else {
      if (tool === "lasso") {
        const last = drawing.points[drawing.points.length - 1];
        if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= LASSO_MIN_STEP) drawing.points.push(point);
      }
      paintPreview(drawing.start, point, drawing.points);
    }
    drawing.last = point;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drawing = drawingRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drawingRef.current = null;
    if (!drawing) return;
    const point = pointFor(event);

    if (annotating && isShapeTool(tool)) {
      if (drawing.origin && drawing.handle) {
        setDraft(null);
        // 没真的移动过就不占一格撤销：点一下框只是选中它。
        if (drawing.moved) commitInk(drawing.before);
        return;
      }
      setDraft(null);
      if (shapeArea(tool, drawing.start, point, drawing.points) < MIN_SHAPE_AREA) return;
      const mark: Mark = { id: `mark-${markSeqRef.current}`, tool, points: tool === "lasso" ? drawing.points : [drawing.start, point], color };
      markSeqRef.current += 1;
      setMarks((current) => [...current, mark]);
      setSelectedMarkId(mark.id);
      commitInk(drawing.before);
      return;
    }

    // 只有真的落下笔迹才写历史：点一下没拖动不该占掉一格撤销。
    if (!drawing.moved && tool !== "brush" && tool !== "erase") return;
    if (tool !== "brush" && tool !== "erase") commitPreview();
    dropErasedMarks(drawing.erased);
    commitInk(drawing.before);
  };

  /** 指针离开画布：悬停手柄与覆盖环都要撤掉，否则会留下一个指向画布外的圈。 */
  const onPointerLeave = () => {
    hoverPointRef.current = null;
    setHoverHandle(null);
    drawMarkLayerRef.current();
  };

  const resetView = () => setView({ zoom: 1, x: 0, y: 0 });

  /** 右键拖拽平移。挂在舞台上而不是画布上：画布外的留白处也该能拖，那里同样属于这块视图。 */
  const onStagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    setPanning(true);
  };

  const onStagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    pan.x = event.clientX;
    pan.y = event.clientY;
    const box = event.currentTarget.getBoundingClientRect();
    setView((prev) => ({ ...prev, x: clampPan(prev.x + dx, box.width), y: clampPan(prev.y + dy, box.height) }));
  };

  const onStagePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    panRef.current = null;
    setPanning(false);
  };

  const restore = (from: React.RefObject<HistoryEntry[]>, to: React.RefObject<HistoryEntry[]>) => {
    const canvas = committedRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !from.current.length) return;
    const previous = capture();
    const entry = from.current[from.current.length - 1]!;
    to.current = [...to.current, previous].slice(-historyLimit);
    from.current = from.current.slice(0, -1);
    if (entry.image) context.putImageData(entry.image, 0, 0);
    else context.clearRect(0, 0, canvas.width, canvas.height);
    setMarks(entry.marks);
    setSelectedMarkId(null);
    setDraft(null);
    setHistoryDepth(historyRef.current.length);
    setRedoDepth(redoRef.current.length);
    // 撤销到空画布之后就不该还能提交：这一点靠历史条目携带，而不是靠"曾经画过"来推断。
    inkRef.current = entry.ink;
    reportDirty(entry.ink);
  };

  const clear = useCallback(() => {
    const canvas = committedRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    pushHistory(capture());
    context.globalCompositeOperation = "source-over";
    if (baseColor === "transparent") context.clearRect(0, 0, canvas.width, canvas.height);
    else {
      context.fillStyle = baseColor;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    setMarks([]);
    setSelectedMarkId(null);
    setDraft(null);
    inkRef.current = false;
    reportDirty(false);
    // marks 进依赖：pushHistory 推的是"清空前的状态"，闭包里必须是最新的选框列表。
  }, [baseColor, marks, pushHistory, reportDirty]);

  useImperativeHandle(ref, () => ({
    /*
     * 导出的就是画布本身加矢量选框：两种模式的数据契约都在 reset 的底色里，导出不再另做变换。
     * 选框必须在这里才栅格化——手柄是操作提示，只有到这一步才确定它不该落盘。
     */
    exportPng: async () => {
      const canvas = committedRef.current;
      if (!canvas || !dirtyRef.current) return null;
      if (!marks.length) return new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
      const out = document.createElement("canvas");
      out.width = canvas.width;
      out.height = canvas.height;
      const context = out.getContext("2d");
      if (!context) return null;
      context.drawImage(canvas, 0, 0);
      paintMarks(context, marks, markLineWidth(out.width), annotating);
      return new Promise<Blob | null>((resolve) => out.toBlob((blob) => resolve(blob), "image/png"));
    },
    clear,
  }), [annotating, clear, marks]);

  return (
    <div className={styles.root}>
      <Space wrap size="small">
        {/* 工具与操作一律图标化：名称走 Tooltip，工具栏才放得下，也不再抢画布的注意力。 */}
        <Segmented
          value={tool}
          onChange={(value) => setTool(value as DrawTool)}
          options={tools.map((value) => {
            const label = toolLabel(value, annotating);
            const { icon: Icon } = TOOL_LABELS[value];
            return { value, label: <Tooltip title={label}><span aria-label={label}><Icon size={15} /></span></Tooltip> };
          })}
        />
        {/* 框选是区域语义，跟笔径无关；滑杆留在原地但停用，免得调了没反应像是坏了。 */}
        <Tooltip title={annotating && isShapeTool(tool) ? "笔径（框选不按笔径，切回画笔或擦除时生效）" : "笔径"}>
          <Ruler size={14} style={{ opacity: annotating && isShapeTool(tool) ? 0.35 : 0.7 }} />
        </Tooltip>
        <Slider style={{ width: 120 }} min={MIN_BRUSH} max={MAX_BRUSH} value={brushSize} onChange={setBrushSize} disabled={annotating && isShapeTool(tool)} />
        {/* 按钮外面这层 span 不是装饰：antd 的 Tooltip 在禁用按钮上收不到指针事件，靠 span 承接悬停。 */}
        <Tooltip title="撤销"><span><Button size="small" aria-label="撤销" icon={<Undo2 size={14} />} disabled={!historyDepth} onClick={() => restore(historyRef, redoRef)} /></span></Tooltip>
        <Tooltip title="重做"><span><Button size="small" aria-label="重做" icon={<Redo2 size={14} />} disabled={!redoDepth} onClick={() => restore(redoRef, historyRef)} /></span></Tooltip>
        <Tooltip title="滚轮缩放、右键拖拽平移；点这里回到适应窗口">
          <span>
            <Button
              size="small"
              aria-label="还原视图"
              icon={<Maximize size={14} />}
              disabled={view.zoom === 1 && view.x === 0 && view.y === 0}
              onClick={resetView}
            />
          </span>
        </Tooltip>
        <Tooltip title="清空"><span><Button size="small" aria-label="清空" icon={<Trash2 size={14} />} onClick={clear} /></span></Tooltip>
      </Space>
      <div
        ref={stageRef}
        className={`${styles.stage} ${STAGE_BACKDROPS[stageBackdrop]} ${fillsStage ? styles.stageFill : ""}`}
        // fill 模式不写高度：写了固定高度，flex 就没机会把它撑开，下方会剩一片空白。
        style={fillsStage ? undefined : { height: stageHeight }}
        data-panning={panning ? "true" : undefined}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        // 右键是平移手势，不该弹出上下文菜单。
        onContextMenu={(event) => event.preventDefault()}
      >
        {dimensions ? (
          <div
            className={styles.frame}
            style={{
              ...(frameSize
                ? { width: frameSize.width, height: frameSize.height }
                : { width: `min(100% - ${STAGE_MARGIN * 2}px, ${dimensions.width}px)`, aspectRatio: `${dimensions.width} / ${dimensions.height}` }),
              // 恒等变换时不写 transform：省掉一个没必要的合成层。
              ...(view.zoom === 1 && view.x === 0 && view.y === 0 ? {} : { transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }),
            }}
          >
            {imageUrl ? <img className={styles.underlay} src={imageUrl} alt="" /> : null}
            <canvas ref={committedRef} className={styles.committed} data-underlay-mode={imageUrl ? underlayDisplay : undefined} />
            {/* 选框层不吃指针事件：交互统一由 preview 层接，两层都接会让同一次落笔被处理两遍。 */}
            <canvas ref={markLayerRef} className={styles.marks} />
            <canvas
              ref={previewRef}
              className={styles.preview}
              data-underlay-mode={imageUrl ? underlayDisplay : undefined}
              /*
               * 悬停手柄只在形状类工具下有意义，切走之后这个属性自动消失，不会留下过期的缩放光标。
               * 画笔与擦除的笔径提示不在这里：环要跟着笔径变，只能画在画布上（见 `paintFootprint`）。
               */
              data-hover={annotating && isShapeTool(tool) ? hoverHandle ?? undefined : undefined}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerLeave}
            />
          </div>
        ) : (
          <span style={{ fontSize: 12, opacity: 0.7 }}>正在读取画布尺寸…</span>
        )}
      </div>
      {/* 笔色贴在画布下方：选色是画的过程中反复做的动作，离画布越近越省视线移动。 */}
      <div className={styles.footer}>
        {brushColors.length > 1 ? (
          <div className={styles.swatches}>
            {brushColors.map((value) => (
              <button
                key={value}
                type="button"
                className={styles.swatch}
                data-active={value === color}
                style={{ background: value }}
                aria-label={`笔色 ${value}`}
                aria-pressed={value === color}
                onClick={() => {
                  customColorRef.current = false;
                  setColor(value);
                }}
              />
            ))}
            {/* 预设之外的任意色：彩虹环是入口，选过之后这一格显示当前色。 */}
            <label
              className={styles.swatchCustom}
              data-active={!brushColors.includes(color)}
              style={brushColors.includes(color) ? undefined : { background: color }}
              title="自定义颜色"
            >
              <input
                type="color"
                value={color}
                aria-label="自定义笔色"
                onChange={(event) => {
                  customColorRef.current = true;
                  setColor(event.target.value);
                }}
              />
            </label>
          </div>
        ) : <span />}
        <span className={styles.meta}>
          {/* 只报当前倍率，不兼作按钮：还原是一个动作，动作放在工具栏里那排按钮中间；
              同一个动作挂两处只会让人猜"这两个是不是一回事"。 */}
          {dimensions ? <span className={styles.zoom}>{Math.round(view.zoom * 100)}%</span> : null}
          {dimensions ? <span className={styles.dims}>{dimensions.width}×{dimensions.height}</span> : null}
          <Tooltip title={`画布以原生像素导出${imageUrl ? "，坐标与底图逐像素对齐；底图只用于对齐，不进入导出结果" : ""}。`}>
            <span className={styles.info}><Info size={12} aria-hidden /></span>
          </Tooltip>
        </span>
      </div>
    </div>
  );
});
