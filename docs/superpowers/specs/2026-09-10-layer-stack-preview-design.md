# 堆叠预览（Layer Stack Preview）设计

日期：2026-09-10
状态：待用户审阅
范围：`apps/web`，客户端实现，无服务端/契约改动

## 目标

在「AI 分层导出」结果视图（当前与历史记录通用）提供全屏堆叠预览弹窗：右侧图层列表支持显隐切换与拖拽排序，左侧实时合成预览；可导出合成图 PNG、ZIP（排除隐藏层）、PSD（排除隐藏层）。预览不改任何存储结果。

## 数据来源

`exportRecord.layerFiles`（不含 `composite`）：全幅同尺寸 PNG（背景层在数组首位 = PSD 最底层）。历史记录通过「历史导出」下拉切换 `exportRecord` 后同样可打开。

## 组件结构

- `LayerStackDialog.tsx`（LayersPanel 同目录）：全屏 overlay + 头部（标题/N 层/导出按钮组/关闭）+ 左预览区 + 右图层列表 + 底部提示。
- `lib/layerStackExport.ts`：纯函数与构建器——层序 reducer（`moveLayer`）、导出文件命名（`01_名称.png`）、ZIP 输入组装、PSD 文档对象组装。
- `layerPsd.worker.ts`：module worker，接收 `{name, data, width, height}[]`，调 ag-psd `writePsd`（imageData 路径，无需 canvas），回传 `ArrayBuffer`（transferable）。
- 依赖：`fflate`（ZIP，异步 `zip` API）、`ag-psd`（PSD）。两者均 `import()` 动态加载，只在点击对应导出时进入网络，不进主包。

## 交互

- 显隐：`hiddenIds: Set<string>`，眼睛 toggle；`composite` 文件不进列表。
- 排序：右侧行内 pointer 拖拽（自实现，非 HTML5 drag——避免系统 ghost 图与卡顿）。拖拽过程只改行 `transform`（ref + 直接 DOM，不触发 React 渲染），松手提交一次 `moveLayer`；预览层顺序用 CSS `order` 跟随数组。
- 预览堆叠：容器内所有 `<img>` 绝对定位、`object-fit: contain`，`style.order = 数组下标`；隐藏层 `visibility: hidden`。img 以 `downloadUrl` 为 key 稳定复用——重排只改 `order`，不重挂载、不重解码。

## 性能策略（用户约束：流程不卡顿）

1. **解码只有一次**：预览 `<img>` 与缩略图共用同一 URL，浏览器解码缓存复用；`decoding="async"` 打开弹窗时异步解码，不阻塞首帧。
2. **可见层才参与合成**：隐藏层 `visibility: hidden` 不产生绘制；拖拽/显隐只触发 GPU 合成，无 JS 重绘像素。
3. **拖拽零渲染**：拖拽期间行位移用 ref+transform 直接写 DOM，drop 才提交 state；img 稳定 key + `order`，预览区不重挂载。
4. **ZIP 不卡主线程**：fflate 异步 `zip()`（内置 worker 调度），PNG 已压缩采用 store 级别；点击后按钮进入 loading 态。
5. **PSD 在 Web Worker 构建**：图层 PNG 经 `createImageBitmap` 异步解码为 imageData 后 transfer 到 worker，ag-psd 编码不占主线程；完成前导出按钮 loading。
6. **内存峰值控制**：imageData 仅在导出时按需解码（并发上限 4），构建完成即释放；预览依赖浏览器缓存，不自持 RGBA。
7. **错误路径不冻结**：任一层 fetch/解码失败 → 取消本次导出 loading 并在弹窗内显示错误，可重试。

## 导出语义

- 合成图 PNG：主线程 canvas 按当前层序绘制可见层（GPU 加速），`toBlob` 异步 → `layers-{outputId 前 8 位}-composite.png`。
- ZIP（排除隐藏层）：按当前层序重命名 `01_xxx.png…`（跳过隐藏层序号顺延），含 `manifest.json`：来源记录 id/时间、包含与排除清单、层序。
- PSD（排除隐藏层）：children 按当前层序（仅可见层），每层 imageData；合成图 canvas 作为文档底图。下载名沿用现有约定 `layers-{outputId 前 8 位}.psd`。背景层是普通图层，可被拖到任意位置。

## 测试

- `moveLayer`/命名/manifest 组装：纯函数单测。
- ZIP 输入组装（排除隐藏、重命名、序号顺延）：单测。
- PSD 文档组装：jsdom 下以 imageData 构建 → `readPsd` 往返校验层序与名称（web 包 devDep 已含 ag-psd）。
- 组件：smoke 渲染 + 显隐 toggle 状态；拖拽与 canvas 绘制手动验证。
- 运行 `pnpm build`、`pnpm --filter @ecomgen/web test`；bundle 体积确认主包无 fflate/ag-psd。

## 仍有限制

- 导出不回写存储结果（弹窗内提示已声明）。
- 大图（2K×17 层）首次打开需解码，弱机上预览区可能逐层出现（缩略图先行的渐进呈现）。
