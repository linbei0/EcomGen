import { Eye, EyeOff, FileArchive, FileImage, GripVertical, Layers3, X } from "lucide-react";
import { Button } from "antd";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { buildManifest, buildPsdDocument, buildZipEntries, decodeImageDatas, drawComposite, fetchLayerBytes, moveLayer, resolveAssetUrl, visibleLayers, type StackLayer } from "../../lib/layerStackExport";
import type { LayerExportView } from "./LayersPanel";
import styles from "./workbench.module.css";

interface LayerStackDialogProps { record: LayerExportView; outputId: string; onClose: () => void; }

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

/** AI 分层导出的图层编排：显隐/排序仅作用于预览与导出，不回写存储结果。 */
export function LayerStackDialog({ record, outputId, onClose }: LayerStackDialogProps) {
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
        const manifest = buildManifest({ exportId: record.id, outputId, createdAt: record.createdAt }, layers, hiddenIds);
        const files: Record<string, Uint8Array> = {};
        for (const entry of buildZipEntries(layers, hiddenIds, bytesByUrl, manifest)) files[entry.name] = entry.data;
        const { zip } = await import("fflate");
        const zipped = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => zip(files, (failure, data) => (failure ? reject(new Error(String(failure))) : resolve(data))));
        downloadBlob(new Blob([zipped], { type: "application/zip" }), `layers-${recordId}.zip`);
      } else {
        const bytesByUrl = await fetchLayerBytes(visible.map((layer) => layer.downloadUrl));
        const imageDataByUrl = await decodeImageDatas(bytesByUrl);
        const first = visible.map((layer) => imageDataByUrl.get(layer.downloadUrl)).find(Boolean);
        if (!first) throw new Error("没有可见图层");
        // 存储的 composite 产物是 PSD 文件本身，不能当位图解码；合成底图按当前可见层实时绘制，与预览一致
        const compositeCanvas = drawComposite(visible, imageDataByUrl);
        const compositeContext = compositeCanvas.getContext("2d");
        if (!compositeContext) throw new Error("无法创建画布上下文");
        const compositeImageData = compositeContext.getImageData(0, 0, compositeCanvas.width, compositeCanvas.height);
        const document = buildPsdDocument(first.width, first.height, layers, hiddenIds, imageDataByUrl, compositeImageData);
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
    <div className={styles.layerStackOverlay} role="dialog" aria-label="图层编排">
      <header className={styles.layerStackHeader}>
        <span className={styles.layerStackBadge}><Layers3 size={15} strokeWidth={1.75} /></span>
        <h2 className={styles.layerStackTitle}>图层编排</h2>
        <span className={styles.layerStackCount}>{`${layers.length} 层`}</span>
        <span className={styles.layerStackNote}>不改动原图层</span>
        <div className={styles.layerStackHeaderAction}>
          <Button size="small" icon={<FileImage size={13} />} loading={busy === "png"} disabled={busy !== null && busy !== "png"} onClick={() => void runExport("png")}>导出合成图</Button>
          <Button size="small" icon={<FileArchive size={13} />} loading={busy === "zip"} disabled={busy !== null && busy !== "zip"} onClick={() => void runExport("zip")}>导出 ZIP</Button>
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
          {visible.length === 0 ? <p className={styles.layerStackStageHint}>所有图层均已隐藏，点眼睛图标恢复</p> : null}
        </div>
        <aside className={styles.layerStackPanel}>
          <p className={styles.layerStackPanelTitle}>{`图层顺序（${layers.length}）`}</p>
          <div className={styles.layerStackRows}>
            {[...layers].reverse().map((layer, displayIndex) => (
              <div key={layer.downloadUrl} data-row="true" className={styles.layerStackRow} data-hidden-row={hiddenIds.has(layer.id) || undefined}>
                <button type="button" className={styles.layerStackGrip} aria-label={`拖拽排序 ${layer.name}`} onPointerDown={startDrag(displayIndex)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><GripVertical size={14} /></button>
                <span className={styles.layerStackThumb}><img src={resolveUrl(layer.downloadUrl)} alt="" decoding="async" draggable={false} className={styles.layerStackThumbImage} /></span>
                <span className={styles.layerStackMeta}>
                  <span className={styles.layerStackName} title={layer.name}>{layer.name.replace(/\.png$/i, "")}</span>
                  <span className={styles.layerStackKind}>{layer.kind === "background" ? "背景" : "元素"}</span>
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
        <p>隐藏的图层不会包含进 ZIP 和 PSD；排序与显隐仅作用于本次预览，原始图层文件保持不变。</p>
        {error ? <p className={styles.editError} role="alert">{error}</p> : null}
      </footer>
    </div>
  );
}
