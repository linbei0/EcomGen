# 堆叠预览（Layer Stack Preview）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「AI 分层导出」结果视图增加全屏堆叠预览弹窗：显隐切换、拖拽排序、实时合成预览，并支持导出合成图 PNG / ZIP（排除隐藏层）/ PSD（排除隐藏层），全客户端实现不回写存储。

**Architecture:** LayersPanel 结果视图加「堆叠预览」按钮打开 `LayerStackDialog`；纯函数与导出编排集中在 `lib/layerStackExport.ts`；PSD 编码放入 module worker（ag-psd imageData 路径）；fflate/ag-psd 动态 import 不进主包。

**Tech Stack:** React 19 + antd v6 + CSS Modules；fflate（ZIP）、ag-psd（PSD）、lucide-react 图标；Vitest + Testing Library（jsdom，全局配置见 `apps/web/vite.config.ts`）。

**Spec:** `docs/superpowers/specs/2026-09-10-layer-stack-preview-design.md`

## Global Constraints

- 预览/排序/显隐一律不回写存储结果；任何导出失败不得静默，弹窗内报错可重试。
- fflate、ag-psd 只能动态 `import()`，不得静态 import 进主包（ag-psd 在测试文件中可静态 import）。
- 数组语义：`layers` 为 bottom→top（下标 0 = 最底层背景），与 worker `children[0]` 最底层约定一致；右侧列表按 top-first（数组倒序）显示。
- 预览层叠用 `zIndex = 数组下标`（设计稿中的 CSS `order` 不影响绝对定位元素的绘制顺序，改用 z-index，语义不变——实现时需向用户说明此偏差）。
- ZIP/PSD 编号沿用现有约定：bottom→top 顺序跳过隐藏层顺延编号 `01_名称.png`。
- 不提交 commit（用户未要求）；全程遵守 `AGENTS.md` 注释规范。
- PowerShell 无 head：长输出用 `Out-File` 到 `%TEMP%\opencode` 再读。

## File Structure

- Create: `apps/web/src/lib/layerStackExport.ts` — 纯函数（moveLayer/命名/manifest/ZIP/PSD 文档）+ 浏览器异步编排（fetch 并发、imageBitmap 解码、合成 canvas）。
- Create: `apps/web/src/lib/layerStackExport.test.ts` — 纯函数单测 + ag-psd readPsd 往返。
- Create: `apps/web/src/features/workbench/LayerStackDialog.tsx` — 全屏弹窗组件。
- Create: `apps/web/src/features/workbench/LayerStackDialog.test.tsx` — smoke + 显隐 + Escape/关闭。
- Create: `apps/web/src/features/workbench/layerPsd.worker.ts` — module worker，ag-psd writePsd → ArrayBuffer transferable。
- Modify: `apps/web/src/features/workbench/LayersPanel.tsx` — 导出 `LayerExportView` 类型、新增 stackOpen 状态与「堆叠预览」按钮、挂载弹窗。
- Modify: `apps/web/src/features/workbench/workbench.module.css` — 追加 `layerStack*` 样式。
- Modify: `apps/web/package.json` — 新增 fflate、ag-psd 依赖（pnpm 安装）。

---

### Task 1: 安装依赖

**Files:**
- Modify: `apps/web/package.json`（经 pnpm 安装产生）

**Interfaces:**
- Produces: 可 `import("fflate")`、`import("ag-psd")`（动态）与测试中静态 `import { readPsd } from "ag-psd"`。

- [ ] **Step 1: 安装 fflate 与 ag-psd**

```bash
pnpm --filter @ecomgen/web add fflate ag-psd
```

Expected: package.json dependencies 出现 `fflate`、`ag-psd`，lockfile 更新，无 peer 冲突。

- [ ] **Step 2: 验证安装**

```bash
pnpm --filter @ecomgen/web exec node -e "import('fflate').then(m => console.log(typeof m.zip)); import('ag-psd').then(m => console.log(typeof m.writePsd, typeof m.readPsd))"
```

Expected: 输出 `function`、`function function`。

---

### Task 2: layerStackExport.ts 纯函数与编排（TDD）

**Files:**
- Create: `apps/web/src/lib/layerStackExport.ts`
- Test: `apps/web/src/lib/layerStackExport.test.ts`

**Interfaces:**
- Consumes: `API_BASE_URL`（`src/config/env`）。
- Produces（后续任务依赖的精确签名）:

```ts
export interface StackLayer { id: string; name: string; kind: "element" | "background"; downloadUrl: string; }
export function resolveAssetUrl(url: string): string
export function moveLayer(layers: readonly StackLayer[], from: number, to: number): StackLayer[]
export function layerDisplayName(name: string): string            // 去 .png 后缀
export function numberedName(index: number, name: string): string  // index 为 1 起始序号 → "01_名称.png"
export function visibleLayers(layers: readonly StackLayer[], hiddenIds: ReadonlySet<string>): StackLayer[]
export function buildManifest(source: { exportId: string; outputId: string; createdAt: string }, layers: readonly StackLayer[], hiddenIds: ReadonlySet<string>): string
export function buildZipEntries(layers: readonly StackLayer[], hiddenIds: ReadonlySet<string>, bytesByUrl: ReadonlyMap<string, Uint8Array>, manifest: string): Array<{ name: string; data: Uint8Array }>
export function buildPsdDocument(width: number, height: number, layers: readonly StackLayer[], hiddenIds: ReadonlySet<string>, imageDataByUrl: ReadonlyMap<string, ImageData>, compositeImageData?: ImageData): Record<string, unknown>
export function drawComposite(layers: readonly StackLayer[], imageDataByUrl: ReadonlyMap<string, ImageData>): OffscreenCanvas
export async function fetchLayerBytes(urls: readonly string[], limit?: number): Promise<Map<string, Uint8Array>>
export async function decodeImageDatas(bytesByUrl: ReadonlyMap<string, Uint8Array>, limit?: number): Promise<Map<string, ImageData>>
```

- [ ] **Step 1: 写测试（先行，完整断言）**

```ts
import { readPsd } from "ag-psd";
import { describe, expect, it } from "vitest";

import { buildManifest, buildPsdDocument, buildZipEntries, layerDisplayName, moveLayer, numberedName, visibleLayers, type StackLayer } from "./layerStackExport";

const make = (id: string, name: string, kind: "element" | "background" = "element"): StackLayer => ({ id, name, kind, downloadUrl: `/files/${id}` });
const bytes = (text: string) => new TextEncoder().encode(text);

describe("moveLayer", () => {
  it("把元素从 from 移到 to，其余相对顺序不变", () => {
    const layers = ["a", "b", "c", "d"].map((id) => make(id, id));
    expect(moveLayer(layers, 0, 2).map((layer) => layer.id)).toEqual(["b", "c", "a", "d"]);
    expect(moveLayer(layers, 3, 0).map((layer) => layer.id)).toEqual(["d", "a", "b", "c"]);
  });
  it("越界目标收敛到有效区间，且不修改原数组", () => {
    const layers = ["a", "b"].map((id) => make(id, id));
    expect(moveLayer(layers, 0, 99).map((layer) => layer.id)).toEqual(["b", "a"]);
    expect(moveLayer(layers, 1, -5).map((layer) => layer.id)).toEqual(["b", "a"]);
    expect(layers.map((layer) => layer.id)).toEqual(["a", "b"]);
  });
});

describe("命名", () => {
  it("去掉 .png 后缀；1 起始两位序号", () => {
    expect(layerDisplayName("01_自定义元素 1.png")).toBe("01_自定义元素 1");
    expect(layerDisplayName("薄荷叶")).toBe("薄荷叶");
    expect(numberedName(1, "立着的菠萝.png")).toBe("01_立着的菠萝.png");
    expect(numberedName(12, "薄荷叶.png")).toBe("12_薄荷叶.png");
  });
});

describe("visibleLayers", () => {
  it("过滤隐藏层并保持原（bottom→top）顺序", () => {
    const layers = [make("bg", "背景.png", "background"), make("a", "a.png"), make("b", "b.png")];
    expect(visibleLayers(layers, new Set(["a", "bg"])).map((layer) => layer.id)).toEqual(["b"]);
    expect(visibleLayers(layers, new Set()).map((layer) => layer.id)).toEqual(["bg", "a", "b"]);
  });
});

describe("buildManifest", () => {
  it("记录来源、导出时间、完整层序与包含/排除清单", () => {
    const layers = [make("bg", "背景.png", "background"), make("a", "a.png"), make("b", "b.png")];
    const manifest = JSON.parse(buildManifest({ exportId: "exp-1", outputId: "out-1", createdAt: "2026-09-10T01:02:03.000Z" }, layers, new Set(["b"]))) as Record<string, unknown>;
    expect(manifest.source).toEqual({ exportId: "exp-1", outputId: "out-1", createdAt: "2026-09-10T01:02:03.000Z" });
    expect(manifest.order).toEqual(["背景.png", "a.png", "b.png"]);
    expect(manifest.included).toEqual(["背景.png", "a.png"]);
    expect(manifest.excluded).toEqual(["b.png"]);
    expect(typeof manifest.exportedAt).toBe("string");
  });
});

describe("buildZipEntries", () => {
  const layers = [make("bg", "背景.png", "background"), make("a", "a.png"), make("b", "b.png"), make("c", "c.png")];
  const bytesByUrl = new Map([["/files/bg", bytes("bg")], ["/files/a", bytes("a")], ["/files/b", bytes("b")], ["/files/c", bytes("c")]]);
  it("可见层 bottom→top 编号重命名（隐藏层序号顺延），manifest 收尾", () => {
    const manifest = buildManifest({ exportId: "exp-1", outputId: "out-1", createdAt: "2026-09-10T01:02:03.000Z" }, layers, new Set(["b"]));
    const entries = buildZipEntries(layers, new Set(["b"]), bytesByUrl, manifest);
    expect(entries.map((entry) => entry.name)).toEqual(["01_背景.png", "02_a.png", "03_c.png", "manifest.json"]);
    expect(new TextDecoder().decode(entries[0].data)).toBe("bg");
    expect(new TextDecoder().decode(entries.at(-1)!.data)).toBe(manifest);
  });
  it("可见层字节缺失时抛错，不产出半成品", () => {
    expect(() => buildZipEntries(layers, new Set(), new Map(), "{}")).toThrow(/图层文件缺失/);
  });
});

describe("buildPsdDocument + readPsd 往返", () => {
  const imageData = (color: number) => ({ width: 2, height: 2, data: new Uint8ClampedArray(16).fill(color) }) as ImageData;
  it("children 仅含可见层且自底向上，往返后层序与尺寸一致", () => {
    const layers = [make("bg", "背景.png", "background"), make("a", "a.png"), make("b", "b.png")];
    const imageDataByUrl = new Map([["/files/bg", imageData(10)], ["/files/a", imageData(20)], ["/files/b", imageData(30)]]);
    const document = buildPsdDocument(2, 2, layers, new Set(["b"]), imageDataByUrl);
    const parsed = readPsd(window.agPsdBuffer(document), { skipLayerImageData: false });
    expect(parsed.children?.map((child) => child.name)).toEqual(["背景", "a"]);
    expect(parsed.children?.[0].imageData?.width).toBe(2);
    expect(parsed.children?.[0].imageData?.data[0]).toBe(10);
    expect(parsed.children?.[1].imageData?.data[0]).toBe(20);
  });
});
```

注：`window.agPsdBuffer` 是占位写法，实现时直接使用 `writePsd(document)`（测试文件静态 import `writePsd` 即可——测试不在主包，静态引入无碍 bundle 约束）：

```ts
import { readPsd, writePsd } from "ag-psd";
// ...
const parsed = readPsd(writePsd(document as Parameters<typeof writePsd>[0]), { skipLayerImageData: false });
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @ecomgen/web exec vitest run src/lib/layerStackExport.test.ts
```

Expected: FAIL（`layerStackExport` 模块不存在）。

- [ ] **Step 3: 实现 layerStackExport.ts（完整代码）**

```ts
import { API_BASE_URL } from "../config/env";

/** 堆叠预览里的一个图层：id 取 downloadUrl（记录内唯一且稳定，可作 key/显隐标识）。 */
export interface StackLayer { id: string; name: string; kind: "element" | "background"; downloadUrl: string; }

/** 产物 downloadUrl 是裸 /files/... 路径；外部链接原样返回。 */
export function resolveAssetUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** 数组语义 bottom→top（下标 0 最底层）；把 from 移到 to，越界收敛，返回新数组。 */
export function moveLayer(layers: readonly StackLayer[], from: number, to: number): StackLayer[] {
  const next = [...layers];
  const boundedFrom = Math.max(0, Math.min(next.length - 1, from));
  const boundedTo = Math.max(0, Math.min(next.length - 1, to));
  const [moved] = next.splice(boundedFrom, 1);
  next.splice(boundedTo, 0, moved);
  return next;
}

export function layerDisplayName(name: string): string {
  return name.replace(/\.png$/i, "");
}

export function numberedName(index: number, name: string): string {
  return `${String(index).padStart(2, "0")}_${name}`;
}

export function visibleLayers(layers: readonly StackLayer[], hiddenIds: ReadonlySet<string>): StackLayer[] {
  return layers.filter((layer) => !hiddenIds.has(layer.id));
}

/** manifest 记录来源与层序语义：order 为完整当前层序（bottom→top），included/excluded 按同序拆分。 */
export function buildManifest(source: { exportId: string; outputId: string; createdAt: string }, layers: readonly StackLayer[], hiddenIds: ReadonlySet<string>): string {
  const included: string[] = [];
  const excluded: string[] = [];
  for (const layer of layers) (hiddenIds.has(layer.id) ? excluded : included).push(layer.name);
  return JSON.stringify({ source, exportedAt: new Date().toISOString(), order: layers.map((layer) => layer.name), included, excluded }, null, 2);
}

export function buildZipEntries(layers: readonly StackLayer[], hiddenIds: ReadonlySet<string>, bytesByUrl: ReadonlyMap<string, Uint8Array>, manifest: string): Array<{ name: string; data: Uint8Array }> {
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  let sequence = 0;
  for (const layer of layers) {
    if (hiddenIds.has(layer.id)) continue;
    const data = bytesByUrl.get(layer.downloadUrl);
    if (!data) throw new Error(`图层文件缺失：${layer.name}`);
    sequence += 1;
    entries.push({ name: numberedName(sequence, layerDisplayName(layer.name)) + ".png", data });
  }
  entries.push({ name: "manifest.json", data: new TextEncoder().encode(manifest) });
  return entries;
}

/** children 为 bottom→top 仅可见层；compositeImageData 存在时作为文档底图交给 ag-psd。 */
export function buildPsdDocument(width: number, height: number, layers: readonly StackLayer[], hiddenIds: ReadonlySet<string>, imageDataByUrl: ReadonlyMap<string, ImageData>, compositeImageData?: ImageData): Record<string, unknown> {
  const children = visibleLayers(layers, hiddenIds).map((layer) => {
    const imageData = imageDataByUrl.get(layer.downloadUrl);
    if (!imageData) throw new Error(`图层文件缺失：${layer.name}`);
    return { name: layerDisplayName(layer.name), imageData, left: 0, top: 0 };
  });
  return compositeImageData ? { width, height, children, compositeImageData } : { width, height, children };
}

/** 可见层按 bottom→top 顺序 source-over 合成；putImageData 到临时画布再 drawImage 保证 alpha 正确混合。 */
export function drawComposite(layers: readonly StackLayer[], imageDataByUrl: ReadonlyMap<string, ImageData>): OffscreenCanvas {
  const first = layers.map((layer) => imageDataByUrl.get(layer.downloadUrl)).find(Boolean);
  if (!first) throw new Error("图层文件缺失");
  const canvas = new OffscreenCanvas(first.width, first.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建画布上下文");
  for (const layer of layers) {
    const data = imageDataByUrl.get(layer.downloadUrl);
    if (!data) throw new Error(`图层文件缺失：${layer.name}`);
    const tile = new OffscreenCanvas(data.width, data.height);
    tile.getContext("2d")?.putImageData(data, 0, 0);
    context.drawImage(tile, 0, 0);
  }
  return canvas;
}

/** 按并发上限拉取图层字节；任一失败即整体失败（错误路径不静默）。 */
export async function fetchLayerBytes(urls: readonly string[], limit = 4): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>();
  const failures: string[] = [];
  let next = 0;
  const runWorker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const response = await fetch(resolveAssetUrl(url));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        result.set(url, new Uint8Array(await response.arrayBuffer()));
      } catch (cause) {
        failures.push(`${url}（${cause instanceof Error ? cause.message : String(cause)}）`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, runWorker));
  if (failures.length > 0) throw new Error(`图层文件下载失败：${failures.join("、")}`);
  return result;
}

/** createImageBitmap 解码为全尺寸 ImageData（并发上限），bitmap 用完即释放控制内存峰值。 */
export async function decodeImageDatas(bytesByUrl: ReadonlyMap<string, Uint8Array>, limit = 4): Promise<Map<string, ImageData>> {
  const result = new Map<string, ImageData>();
  const failures: string[] = [];
  const urls = [...bytesByUrl.keys()];
  let next = 0;
  const runWorker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const bitmap = await createImageBitmap(new Blob([bytesByUrl.get(url)!], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建画布上下文");
        context.drawImage(bitmap, 0, 0);
        result.set(url, context.getImageData(0, 0, bitmap.width, bitmap.height));
        bitmap.close();
      } catch (cause) {
        failures.push(`${url}（${cause instanceof Error ? cause.message : String(cause)}）`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, runWorker));
  if (failures.length > 0) throw new Error(`图层解码失败：${failures.join("、")}`);
  return result;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @ecomgen/web exec vitest run src/lib/layerStackExport.test.ts
```

Expected: 全部 PASS（readPsd 往返若因 ag-psd composite/类型问题失败，调整实现而非断言语义）。

---

### Task 3: LayerStackDialog + worker + CSS + LayersPanel 集成

**Files:**
- Create: `apps/web/src/features/workbench/LayerStackDialog.tsx`
- Create: `apps/web/src/features/workbench/LayerStackDialog.test.tsx`
- Create: `apps/web/src/features/workbench/layerPsd.worker.ts`
- Modify: `apps/web/src/features/workbench/LayersPanel.tsx`（导出类型 + 按钮 + 挂载）
- Modify: `apps/web/src/features/workbench/workbench.module.css`（追加样式）

**Interfaces:**
- Consumes: Task 2 全部导出；`LayerExportView`（LayersPanel，需加 export）。
- Produces: `LayerStackDialog({ record, onClose })`；`LayersPanel` 结果视图按钮。

- [ ] **Step 1: 写组件测试**

```tsx
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
    render(<LayerStackDialog record={record} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "堆叠预览" })).toBeInTheDocument();
    expect(screen.getByText("背景层")).toBeInTheDocument();
    expect(screen.getByText("透明层")).toBeInTheDocument();
    expect(screen.queryByText("01_瓶身")).not.toBeInTheDocument(); // 行名显示去 .png 后名称，见下一条
    expect(screen.getByText("00_背景")).toBeInTheDocument();
    expect(screen.getByText("01_瓶身")).toBeInTheDocument();
    expect(screen.queryByText("图层.psd")).not.toBeInTheDocument();
    expect(screen.getByText(/隐藏某层后导出 ZIP\/PSD 时该层将被排除/)).toBeInTheDocument();
  });
  it("眼睛切换显隐：aria 状态翻转", async () => {
    const user = userEvent.setup();
    render(<LayerStackDialog record={record} onClose={vi.fn()} />);
    const eye = screen.getByLabelText("隐藏图层 01_瓶身");
    await user.click(eye);
    expect(screen.getByLabelText("显示图层 01_瓶身")).toBeInTheDocument();
    await user.click(screen.getByLabelText("显示图层 01_瓶身"));
    expect(screen.getByLabelText("隐藏图层 01_瓶身")).toBeInTheDocument();
  });
  it("Escape 与关闭按钮都会回调 onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<LayerStackDialog record={record} onClose={onClose} />);
    await user.click(screen.getByLabelText("关闭"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

注：smoke 中 `expect(screen.queryByText("01_瓶身")).not.toBeInTheDocument();` 与下一行 `getByText("01_瓶身")` 自相矛盾——实现时删除错的那条（正确语义：行名显示 `01_瓶身` 存在、`图层.psd` 不存在）。以此为准，写测试时直接写成：

```ts
    expect(screen.getByText("00_背景")).toBeInTheDocument();
    expect(screen.getByText("01_瓶身")).toBeInTheDocument();
    expect(screen.queryByText("图层.psd")).not.toBeInTheDocument();
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @ecomgen/web exec vitest run src/features/workbench/LayerStackDialog.test.tsx
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 worker（完整代码）**

```ts
import { writePsd } from "ag-psd";

// psd 文档结构与请求相同：{width, height, children?, compositeImageData?}
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<Record<string, unknown>>) => void) | null;
  postMessage(message: { buffer?: ArrayBuffer; error?: string }, transfer?: Transferable[]): void;
};

// ag-psd 的 imageData 路径不需要 canvas；结果 ArrayBuffer 以 transferable 回传，避免主线程拷贝
ctx.onmessage = (event) => {
  try {
    const buffer = writePsd(event.data as Parameters<typeof writePsd>[0]);
    ctx.postMessage({ buffer }, [buffer]);
  } catch (cause) {
    ctx.postMessage({ error: cause instanceof Error ? cause.message : String(cause) });
  }
};
```

- [ ] **Step 4: 实现 LayerStackDialog.tsx（完整代码）**

```tsx
import { Eye, EyeOff, FileArchive, FileImage, GripVertical, Layers3, X } from "lucide-react";
import { Button } from "antd";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { API_BASE_URL } from "../../config/env";
import { buildManifest, buildPsdDocument, buildZipEntries, decodeImageDatas, drawComposite, fetchLayerBytes, moveLayer, resolveAssetUrl, visibleLayers, type StackLayer } from "../../lib/layerStackExport";
import type { LayerExportView } from "./LayersPanel";
import styles from "./workbench.module.css";

interface LayerStackDialogProps { record: LayerExportView; onClose: () => void; }

type ExportKind = "png" | "zip" | "psd";

/** 行高与 CSS .layerStackRow 保持一致：拖拽位移换算目标行的依据 */
const ROW_HEIGHT = 44;

/** 下载产物：objectURL 短暂存在，click 后立刻释放。 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** PSD 编码放进 module worker：主线程只负责解码与组装文档对象。 */
function renderPsdInWorker(document: Record<string, unknown>): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./layerPsd.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ buffer?: ArrayBuffer; error?: string }>) => {
      worker.terminate();
      if (event.data.error || !event.data.buffer) reject(new Error(event.data.error ?? "PSD 生成失败"));
      else resolve(event.data.buffer);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "PSD 生成失败"));
    };
    worker.postMessage(document);
  });
}

/** AI 分层导出的堆叠预览：显隐/排序仅作用于预览与导出，不回写存储结果。 */
export function LayerStackDialog({ record, onClose }: LayerStackDialogProps) {
  const [layers, setLayers] = useState<StackLayer[]>(() => (record.layerFiles ?? [])
    .filter((file) => file.kind !== "composite")
    .map((file) => ({ id: file.downloadUrl, name: file.name, kind: file.kind === "background" ? "background" : "element", downloadUrl: file.downloadUrl })));
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolveUrl = useCallback(resolveAssetUrl, []);
  const visible = visibleLayers(layers, hiddenIds);
  const recordId = record.id.slice(0, 8);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const toggleHidden = (id: string) => setHiddenIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // 拖拽期间只写行 transform（ref+DOM），drop 才提交 moveLayer：预览区零重渲染
  const dragRef = useRef<{ displayIndex: number; startY: number; rowEl: HTMLElement } | null>(null);
  const startDrag = (displayIndex: number) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const rowEl = event.currentTarget.closest("[data-row]") as HTMLElement | null;
    if (!rowEl) return;
    event.preventDefault();
    dragRef.current = { displayIndex, startY: event.clientY, rowEl };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.rowEl.dataset.dragging = "true";
    drag.rowEl.style.transform = `translateY(${event.clientY - drag.startY}px)`;
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    drag.rowEl.dataset.dragging = "false";
    delete drag.rowEl.dataset.dragging;
    drag.rowEl.style.transform = "";
    const offset = Math.round((event.clientY - drag.startY) / ROW_HEIGHT);
    if (offset === 0) return;
    // 列表按 top-first 显示（数组倒序）：上移一行 = 数组下标 +1
    const from = layers.length - 1 - drag.displayIndex;
    const to = Math.max(0, Math.min(layers.length - 1, from - offset));
    if (to !== from) setLayers((current) => moveLayer(current, from, to));
  };

  const runExport = async (kind: ExportKind) => {
    if (busy) return;
    setBusy(kind); setError(null);
    try {
      if (kind === "png") {
        const bytesByUrl = await fetchLayerBytes(visible.map((layer) => layer.downloadUrl));
        const imageDataByUrl = await decodeImageDatas(bytesByUrl);
        const blob = await drawComposite(visible, imageDataByUrl).convertToBlob({ type: "image/png" });
        downloadBlob(blob, `layers-${recordId}-composite.png`);
      } else if (kind === "zip") {
        const bytesByUrl = await fetchLayerBytes(visible.map((layer) => layer.downloadUrl));
        const manifest = buildManifest({ exportId: record.id, outputId: outputIdPlaceholder, createdAt: record.createdAt }, layers, hiddenIds);
        const files: Record<string, Uint8Array> = {};
        for (const entry of buildZipEntries(layers, hiddenIds, bytesByUrl, manifest)) files[entry.name] = entry.data;
        const { zip } = await import("fflate");
        const zipped = await new Promise<Uint8Array>((resolve, reject) => zip(files, (failure, data) => (failure ? reject(new Error(String(failure))) : resolve(data))));
        downloadBlob(new Blob([zipped], { type: "application/zip" }), `layers-${recordId}.zip`);
      } else {
        const composite = record.layerFiles?.find((file) => file.kind === "composite") ?? null;
        const urls = visible.map((layer) => layer.downloadUrl);
        if (composite) urls.push(composite.downloadUrl);
        const bytesByUrl = await fetchLayerBytes(urls);
        const imageDataByUrl = await decodeImageDatas(bytesByUrl);
        const first = visibleLayers(layers, hiddenIds).map((layer) => imageDataByUrl.get(layer.downloadUrl)).find(Boolean);
        if (!first) throw new Error("没有可见图层");
        const document = buildPsdDocument(first.width, first.height, layers, hiddenIds, imageDataByUrl, composite ? imageDataByUrl.get(composite.downloadUrl) : undefined);
        const buffer = await renderPsdInWorker(document);
        downloadBlob(new Blob([buffer], { type: "application/octet-stream" }), `layers-${recordId}.psd`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.layerStackOverlay} role="dialog" aria-label="堆叠预览">
      <header className={styles.layerStackHeader}>
        <span className={styles.layerStackBadge}><Layers3 size={15} strokeWidth={1.75} /></span>
        <h2 className={styles.layerStackTitle}>堆叠预览</h2>
        <span className={styles.layerStackCount}>{`${layers.length} 层`}</span>
        <span className={styles.layerStackNote}>预览不改原结果</span>
        <div className={styles.layerStackHeaderAction}>
          <Button size="small" icon={<FileImage size={13} />} loading={busy === "png"} disabled={busy !== null && busy !== "png"} onClick={() => void runExport("png")}>导出合成图 PNG</Button>
          <Button size="small" icon={<FileArchive size={13} />} loading={busy === "zip"} disabled={busy !== null && busy !== "zip"} onClick={() => void runExport("zip")}>导出 ZIP（排除隐藏层）</Button>
          <Button size="small" icon={<FileImage size={13} />} loading={busy === "psd"} disabled={busy !== null && busy !== "psd"} onClick={() => void runExport("psd")}>导出 PSD</Button>
          <button type="button" className={styles.layerStackClose} onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>
      </header>
      <div className={styles.layerStackBody}>
        <div className={styles.layerStackStage} data-empty={visible.length === 0 || undefined}>
          {layers.map((layer, index) => (
            <img key={layer.downloadUrl} src={resolveUrl(layer.downloadUrl)} alt={layer.name} decoding="async" draggable={false}
              className={styles.layerStackImage} data-hidden={hiddenIds.has(layer.id) || undefined} style={{ zIndex: index }} />
          ))}
          {visible.length === 0 ? <p className={styles.layerStackStageHint}>全部图层已隐藏</p> : null}
        </div>
        <aside className={styles.layerStackPanel}>
          <p className={styles.layerStackPanelTitle}>{`图层（${layers.length}）`}</p>
          <div className={styles.layerStackRows}>
            {[...layers].reverse().map((layer, displayIndex) => (
              <div key={layer.downloadUrl} data-row="true" className={styles.layerStackRow} data-hidden-row={hiddenIds.has(layer.id) || undefined}>
                <button type="button" className={styles.layerStackGrip} aria-label={`拖拽排序 ${layer.name}`} onPointerDown={startDrag(displayIndex)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><GripVertical size={14} /></button>
                <span className={styles.layerStackThumb}><img src={resolveUrl(layer.downloadUrl)} alt="" decoding="async" draggable={false} className={styles.layerStackThumbImage} /></span>
                <span className={styles.layerStackMeta}>
                  <span className={styles.layerStackName} title={layer.name}>{layer.name.replace(/\.png$/i, "")}</span>
                  <span className={styles.layerStackKind}>{layer.kind === "background" ? "背景层" : "透明层"}</span>
                </span>
                <button type="button" className={styles.layerStackEye} aria-label={hiddenIds.has(layer.id) ? `显示图层 ${layer.name.replace(/\.png$/i, "")}` : `隐藏图层 ${layer.name.replace(/\.png$/i, "")}`} data-hidden={hiddenIds.has(layer.id) || undefined} onClick={() => toggleHidden(layer.id)}>
                  {hiddenIds.has(layer.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            ))}
          </div>
        </aside>
      </div>
      <footer className={styles.layerStackFoot}>
        <p>隐藏某层后导出 ZIP/PSD 时该层将被排除；排序与显隐仅影响预览，不回写结果。</p>
        {error ? <p className={styles.editError} role="alert">{error}</p> : null}
      </footer>
    </div>
  );
}
```

注意：`outputIdPlaceholder` 需替换为真实 prop——组件 props 增加 `outputId: string`，manifest 的 `outputId` 用它。实现时：`interface LayerStackDialogProps { record: LayerExportView; outputId: string; onClose: () => void; }`，manifest 行改为 `outputId`；LayersPanel 传入已有 `outputId` prop。

- [ ] **Step 5: 追加 CSS（workbench.module.css 末尾）**

```css
/* ===== 堆叠预览弹窗 ===== */
.layerStackOverlay { position: fixed; inset: 0; z-index: 1200; display: flex; flex-direction: column; background: color-mix(in srgb, var(--bg-0) 92%, transparent); backdrop-filter: blur(14px); }
.layerStackHeader { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-bottom: 1px solid var(--line-1); background: var(--bg-1); }
.layerStackBadge { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border: 1px solid var(--accent-line); border-radius: var(--radius-s); background: var(--accent-subtle); color: var(--accent); }
.layerStackTitle { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-1); }
.layerStackCount { font-size: 12px; color: var(--text-3); }
.layerStackNote { padding: 3px 10px; border: 1px solid var(--line-1); border-radius: 999px; background: var(--bg-2); font-size: 11px; color: var(--text-3); }
.layerStackHeaderAction { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.layerStackClose { display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid var(--line-1); border-radius: var(--radius-s); background: var(--bg-2); color: var(--text-2); cursor: pointer; }
.layerStackClose:hover { border-color: var(--accent-line); color: var(--accent); }
.layerStackBody { flex: 1; display: grid; grid-template-columns: 1fr 320px; min-height: 0; }
.layerStackStage { position: relative; overflow: hidden; background: var(--bg-2); }
.layerStackImage { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; user-select: none; }
.layerStackImage[data-hidden] { visibility: hidden; }
.layerStackStageHint { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--text-3); font-size: 13px; }
.layerStackPanel { display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--line-1); background: var(--bg-1); }
.layerStackPanelTitle { margin: 0; padding: 12px 14px 8px; font-size: 12px; color: var(--text-3); }
.layerStackRows { flex: 1; overflow-y: auto; padding: 0 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.layerStackRow { display: flex; align-items: center; gap: 6px; height: 44px; flex: none; padding: 0 8px 0 4px; border: 1px solid var(--line-1); border-radius: var(--radius-s); background: var(--bg-2); touch-action: none; user-select: none; }
.layerStackRow[data-hidden-row] { opacity: 0.55; }
.layerStackRow[data-dragging] { position: relative; z-index: 2; border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg-2)); box-shadow: 0 10px 28px rgb(0 0 0 / 35%); }
.layerStackGrip { display: grid; place-items: center; width: 24px; height: 32px; flex: none; border: none; border-radius: var(--radius-s); background: transparent; color: var(--text-3); cursor: grab; }
.layerStackGrip:active { cursor: grabbing; }
.layerStackThumb { width: 32px; height: 32px; flex: none; overflow: hidden; border: 1px solid var(--line-1); border-radius: 4px;
  background-image: conic-gradient(var(--bg-3) 25%, var(--bg-1) 0 50%, var(--bg-3) 0 75%, var(--bg-1) 0); background-size: 12px 12px; }
.layerStackThumbImage { width: 100%; height: 100%; object-fit: contain; }
.layerStackMeta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.layerStackName { font-size: 12px; line-height: 1.3; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.layerStackKind { font-size: 10px; line-height: 1.3; color: var(--text-3); }
.layerStackEye { display: grid; place-items: center; width: 26px; height: 26px; flex: none; border: none; border-radius: var(--radius-s); background: transparent; color: var(--text-2); cursor: pointer; }
.layerStackEye:hover { color: var(--accent); }
.layerStackEye[data-hidden] { color: var(--text-3); }
.layerStackFoot { padding: 10px 20px; border-top: 1px solid var(--line-1); background: var(--bg-1); }
.layerStackFoot p { margin: 0; font-size: 12px; color: var(--text-3); }
```

- [ ] **Step 6: LayersPanel 集成（修改点）**

1. `LayersPanel.tsx` 顶部 import 增加：

```tsx
import { LayerStackDialog } from "./LayerStackDialog";
```

2. `interface LayerExportView` 加 `export` 前缀（供弹窗 type-only 引用）。

3. 组件内新增状态（放在 `const [error, setError]` 附近）：

```tsx
const [stackOpen, setStackOpen] = useState(false);
```

4. 结果视图底栏 done 分支（现有「下载 PSD / 重新选择元素」前插入）：

```tsx
{exportDone ? <>
  <Button block icon={<Layers3 size={14} />} onClick={() => setStackOpen(true)}>堆叠预览</Button>
  {exportRecord?.psdDownloadUrl ? <a className={styles.editLayersDownload} href={resolveUrl(exportRecord.psdDownloadUrl)} download={`layers-${outputId.slice(0, 8)}.psd`}><Button type="primary" block icon={<Download size={14} />}>下载 PSD</Button></a> : null}
  <Button block onClick={() => { setStackOpen(false); setExportRecord(null); setSelectedIds(new Set(allElements.map((element) => element.id))); }}>重新选择元素</Button>
</> : <>…原有…</>}
```

5. 组件 JSX 根（`</>` 前）挂载弹窗：

```tsx
{stackOpen && exportRecord ? <LayerStackDialog record={exportRecord} outputId={outputId} onClose={() => setStackOpen(false)} /> : null}
```

- [ ] **Step 7: 运行组件测试确认通过**

```bash
pnpm --filter @ecomgen/web exec vitest run src/features/workbench/LayerStackDialog.test.tsx
```

Expected: 3 用例 PASS。

- [ ] **Step 8: 前端审美走查（frontend-design/polish 视角，手动）**

- 弹窗层次：backdrop blur + 近实底、面板分区清晰；按钮组与标题对齐。
- 图层行 hover/拖拽态有反馈（accent 描边 + 阴影），隐藏行 55% 透明度。
- 键盘 Escape 可退出；焦点不困在拖拽手柄。
- 不引入与既有面板不一致的字号/圆角/颜色 token。

---

### Task 4: 终验

- [ ] **Step 1: 类型与测试**

```bash
pnpm --filter @ecomgen/web exec tsc -b --force
pnpm --filter @ecomgen/web test
```

Expected: tsc 0 error；web 测试全过（既有 Windows 5s 随机超时抖动若出现，单独重跑失败用例确认与本 feature 无关）。

- [ ] **Step 2: 构建与 bundle 隔离检查**

```bash
pnpm --filter @ecomgen/web build
```

然后：

```bash
rg -l "8BPS" apps/web/dist/assets
rg -c "8BPS" apps/web/dist/assets/index-*.js
```

Expected: `8BPS`（ag-psd 特征串）只出现在独立 chunk，不出现在 index 主 chunk；`fflate` 特征（`invalid flate data`）同理。dist 其他 chunk 名单作为报告输出。

- [ ] **Step 3: 报告**

向用户输出：改动文件清单、导出三链路的手动验证步骤（打开堆叠预览 → 隐藏一层 → 三种导出各点一次核对文件名与内容）、仍有限制（拖拽与 canvas 合成为手动验证、composite 底图若 ag-psd 不写则以图层合成呈现）。
