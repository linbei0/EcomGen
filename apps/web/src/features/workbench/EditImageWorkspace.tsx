import { Button, Input, InputNumber, Modal, Tooltip } from "antd";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Brush, Eraser, Hand, Redo2, RotateCcw, Scan, Send, Shield, SquareDashedMousePointer, Type, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import type { Asset, Output } from "../../api/adapters/projectDetail";
import { API_BASE_URL } from "../../config/env";
import { errorText } from "../../lib/errorText";
import styles from "./workbench.module.css";

type Tool = "pan" | "rect" | "brush" | "erase" | "protect" | "arrow" | "text";
type TurnState = "PLANNING" | "PLAN_READY" | "NEED_INPUT" | "AWAITING_CONFIRMATION" | "GENERATING" | "SUCCEEDED" | "FAILED";
interface EditTurn { id: string; status: TurnState; plan: { userSummary?: string; operation?: string; requiresConfirmation?: boolean } | null; error: { message?: string } | null; }
interface Point { x: number; y: number; }
interface Bounds { x: number; y: number; width: number; height: number; }
interface TextDraft { point: Point; value: string; }
interface Snapshot { edit: string; protect: string; annotations: Array<Record<string, unknown>>; }

const MARK_COLORS = ["#1888f2", "#ff5c5c", "#ffbf2f", "#25bd7b", "#9968f2"];

function boundsFor(point: Point, size: number): Bounds { return { x: point.x - size / 2, y: point.y - size / 2, width: size, height: size }; }
function mergeBounds(current: Bounds | null, next: Bounds): Bounds { if (!current) return next; const x = Math.min(current.x, next.x); const y = Math.min(current.y, next.y); return { x, y, width: Math.max(current.x + current.width, next.x + next.width) - x, height: Math.max(current.y + current.height, next.y + next.height) - y }; }
function intersects(left: Bounds, right: Bounds): boolean { return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y; }

export function EditImageWorkspace({ projectId, output, assets, onClose }: { projectId: string; output: Output | undefined; assets: Asset[]; onClose: () => void }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const editMaskRef = useRef<HTMLCanvasElement | null>(null);
  const protectMaskRef = useRef<HTMLCanvasElement | null>(null);
  const interactionRef = useRef<{ start: Point | null; last: Point | null; erased: Bounds | null }>({ start: null, last: null, erased: null });
  const hoverRef = useRef<Point | null>(null);
  const previewRef = useRef<{ type: "rect" | "arrow"; start: Point; end: Point; color: string } | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const historyRef = useRef<Snapshot[]>([]);
  const historyIndexRef = useRef(-1);
  const [tool, setTool] = useState<Tool>("rect");
  const [brushSize, setBrushSize] = useState(48);
  const [markColor, setMarkColor] = useState(MARK_COLORS[0]!);
  const [textSize, setTextSize] = useState(32);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [message, setMessage] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turn, setTurn] = useState<EditTurn | null>(null);
  const [annotations, setAnnotations] = useState<Array<Record<string, unknown>>>([]);
  const [referenceAssetIds, setReferenceAssetIds] = useState<string[]>([]);
  const [outpaintEdges, setOutpaintEdges] = useState({ top: false, right: false, bottom: false, left: false });
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const redrawOverlay = (nextAnnotations = annotations) => {
    const overlay = overlayRef.current; const edit = editMaskRef.current; const protect = protectMaskRef.current;
    if (!overlay || !edit || !protect) return;
    const context = overlay.getContext("2d"); if (!context) return;
    context.clearRect(0, 0, overlay.width, overlay.height);
    context.save(); context.globalAlpha = 0.3; context.drawImage(edit, 0, 0); context.globalCompositeOperation = "source-in"; context.fillStyle = "#1888f2"; context.fillRect(0, 0, overlay.width, overlay.height); context.restore();
    context.save(); context.globalAlpha = 0.34; context.drawImage(protect, 0, 0); context.globalCompositeOperation = "source-in"; context.fillStyle = "#f29a18"; context.fillRect(0, 0, overlay.width, overlay.height); context.restore();
    context.save(); context.lineWidth = Math.max(3, overlay.width / 450);
    for (const annotation of nextAnnotations) {
      const color = typeof annotation.color === "string" ? annotation.color : "#4da6ff";
      if (annotation.type === "rect" && annotation.bounds && typeof annotation.bounds === "object") {
        const bounds = annotation.bounds as Bounds; context.save(); context.strokeStyle = color; context.fillStyle = color; context.globalAlpha = 0.12; context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height); context.globalAlpha = 1; context.setLineDash([Math.max(6, overlay.width / 110), Math.max(4, overlay.width / 170)]); context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height); context.restore();
      }
      if (annotation.type === "arrow" && Array.isArray(annotation.points) && annotation.points.length === 2) drawArrow(context, annotation.points[0] as Point, annotation.points[1] as Point, color, overlay.width);
      if (annotation.type === "text" && typeof annotation.text === "string" && annotation.point && typeof annotation.point === "object") {
        const point = annotation.point as Point; const size = typeof annotation.fontSize === "number" ? annotation.fontSize : 32; context.save(); context.fillStyle = color; context.font = `${size}px sans-serif`; context.textBaseline = "top"; context.fillText(annotation.text, point.x, point.y); context.restore();
      }
    }
    if (textDraft) {
      context.save(); context.fillStyle = markColor; context.globalAlpha = 0.78; context.font = `${textSize}px sans-serif`; context.textBaseline = "top"; context.fillText(textDraft.value || "输入文字", textDraft.point.x, textDraft.point.y); context.restore();
    }
    const preview = previewRef.current;
    if (preview?.type === "rect") { const bounds = { x: Math.min(preview.start.x, preview.end.x), y: Math.min(preview.start.y, preview.end.y), width: Math.abs(preview.start.x - preview.end.x), height: Math.abs(preview.start.y - preview.end.y) }; context.save(); context.strokeStyle = preview.color; context.fillStyle = preview.color; context.globalAlpha = 0.16; context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height); context.globalAlpha = 1; context.setLineDash([Math.max(6, overlay.width / 110), Math.max(4, overlay.width / 170)]); context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height); context.restore(); }
    if (preview?.type === "arrow") drawArrow(context, preview.start, preview.end, preview.color, overlay.width);
    const hover = hoverRef.current;
    if (hover && ["brush", "erase", "protect"].includes(tool)) { context.save(); context.lineWidth = Math.max(2, overlay.width / 700); context.setLineDash([Math.max(5, overlay.width / 150), Math.max(4, overlay.width / 190)]); context.strokeStyle = tool === "erase" ? "#f0f3f5" : tool === "protect" ? "#f29a18" : markColor; context.beginPath(); context.arc(hover.x, hover.y, brushSize / 2, 0, Math.PI * 2); context.stroke(); context.restore(); }
  };

  const scheduleRender = (nextAnnotations = annotations) => {
    if (renderFrameRef.current !== null) return;
    renderFrameRef.current = requestAnimationFrame(() => { renderFrameRef.current = null; redrawOverlay(nextAnnotations); });
  };

  useEffect(() => () => { if (renderFrameRef.current !== null) cancelAnimationFrame(renderFrameRef.current); }, []);
  useEffect(() => { redrawOverlay(annotations); }, [annotations, tool, brushSize, markColor, textDraft]);
  useEffect(() => { setSessionId(null); setTurn(null); setMessage(""); setAnnotations([]); setReferenceAssetIds([]); setOutpaintEdges({ top: false, right: false, bottom: false, left: false }); setHistory([]); setHistoryIndex(-1); setTextDraft(null); setZoom(1); setPanOffset({ x: 0, y: 0 }); }, [output?.id]);
  useEffect(() => { if (!turn || ["SUCCEEDED", "FAILED", "NEED_INPUT"].includes(turn.status)) return; const timer = window.setInterval(() => { void refreshTurn(turn.id); }, 1500); return () => window.clearInterval(timer); }, [turn?.id, turn?.status]);
  useEffect(() => { if (textDraft) window.requestAnimationFrame(() => textInputRef.current?.focus()); }, [textDraft]);

  const snapshot = (records = annotations): Snapshot => ({ edit: editMaskRef.current?.toDataURL() ?? "", protect: protectMaskRef.current?.toDataURL() ?? "", annotations: records.map((annotation) => structuredClone(annotation)) });
  const pushHistory = (records = annotations) => { const next = [...historyRef.current.slice(0, historyIndexRef.current + 1), snapshot(records)].slice(-20); historyRef.current = next; historyIndexRef.current = next.length - 1; setHistory(next); setHistoryIndex(next.length - 1); };
  const restoreHistory = (index: number) => {
    const value = historyRef.current[index]; if (!value || !editMaskRef.current || !protectMaskRef.current) return;
    const load = (canvas: HTMLCanvasElement, url: string) => new Promise<void>((resolve) => { const image = new Image(); image.onload = () => { canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); canvas.getContext("2d")?.drawImage(image, 0, 0); resolve(); }; image.src = url; });
    void Promise.all([load(editMaskRef.current, value.edit), load(protectMaskRef.current, value.protect)]).then(() => { historyIndexRef.current = index; setHistoryIndex(index); setAnnotations(value.annotations); redrawOverlay(value.annotations); });
  };

  const initializeCanvas = () => {
    const image = imageRef.current; const overlay = overlayRef.current; if (!image || !overlay || !image.naturalWidth || !image.naturalHeight) return;
    const edit = document.createElement("canvas"); const protect = document.createElement("canvas"); for (const canvas of [overlay, edit, protect]) { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; }
    editMaskRef.current = edit; protectMaskRef.current = protect; interactionRef.current = { start: null, last: null, erased: null }; const initial = snapshot([]); historyRef.current = [initial]; historyIndexRef.current = 0; setHistory([initial]); setHistoryIndex(0); redrawOverlay([]);
  };
  const pointFor = (event: ReactPointerEvent<HTMLCanvasElement>): Point | null => { const canvas = overlayRef.current; if (!canvas) return null; const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) }; };
  const stroke = (from: Point, to: Point) => {
    const targets = tool === "erase" ? [editMaskRef.current, protectMaskRef.current] : [tool === "protect" ? protectMaskRef.current : editMaskRef.current];
    for (const target of targets) { const context = target?.getContext("2d"); if (!context) continue; context.save(); context.lineWidth = brushSize; context.lineCap = "round"; context.lineJoin = "round"; context.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over"; context.strokeStyle = "white"; context.fillStyle = "white"; context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke(); context.beginPath(); context.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2); context.fill(); context.restore(); }
    scheduleRender();
  };
  const commitText = () => {
    if (!textDraft) return; const value = textDraft.value.trim(); if (!value) { setTextDraft(null); return; }
    const next = [...annotations, { id: crypto.randomUUID(), type: "text", point: textDraft.point, text: value, color: markColor, fontSize: textSize, semanticRole: "instruction" }]; setAnnotations(next); setTextDraft(null); pushHistory(next);
  };
  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointFor(event); if (!point) return; hoverRef.current = point;
    if (tool === "pan") { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); panRef.current = { startX: event.clientX, startY: event.clientY, originX: panOffset.x, originY: panOffset.y }; return; }
    if (tool === "text") return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); interactionRef.current = { start: point, last: point, erased: tool === "erase" ? boundsFor(point, brushSize) : null };
    if (tool === "brush" || tool === "erase" || tool === "protect") stroke(point, point);
  };
  const placeText = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== "text") return;
    const point = pointFor({ clientX: event.clientX, clientY: event.clientY } as ReactPointerEvent<HTMLCanvasElement>);
    if (!point) return;
    commitText(); setTextDraft({ point, value: "" });
  };
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool === "pan" && panRef.current) { setPanOffset({ x: panRef.current.originX + event.clientX - panRef.current.startX, y: panRef.current.originY + event.clientY - panRef.current.startY }); return; }
    const point = pointFor(event); if (!point) return; hoverRef.current = point;
    const current = interactionRef.current; if (!current.last) { scheduleRender(); return; }
    if (tool === "rect" || tool === "arrow") { previewRef.current = { type: tool, start: current.start!, end: point, color: markColor }; scheduleRender(); return; }
    stroke(current.last, point); current.last = point; if (tool === "erase") current.erased = mergeBounds(current.erased, boundsFor(point, brushSize));
  };
  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool === "pan") { panRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    const current = interactionRef.current; if (!current.start) return; const point = pointFor(event); interactionRef.current = { start: null, last: null, erased: null }; previewRef.current = null; let next = annotations;
    if (tool === "rect" && point && editMaskRef.current) { const bounds = { x: Math.min(current.start.x, point.x), y: Math.min(current.start.y, point.y), width: Math.abs(current.start.x - point.x), height: Math.abs(current.start.y - point.y) }; if (bounds.width > 2 && bounds.height > 2) { const context = editMaskRef.current.getContext("2d"); if (context) { context.fillStyle = "white"; context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height); } next = [...annotations, { id: crypto.randomUUID(), type: "rect", bounds, color: markColor, semanticRole: "target" }]; setAnnotations(next); } }
    if (tool === "arrow" && point) { next = [...annotations, { id: crypto.randomUUID(), type: "arrow", points: [current.start, point], color: markColor, semanticRole: "instruction" }]; setAnnotations(next); }
    if (tool === "erase" && current.erased) { next = annotations.filter((annotation) => annotation.type !== "rect" || !annotation.bounds || !intersects(annotation.bounds as Bounds, current.erased!)); setAnnotations(next); }
    redrawOverlay(next); pushHistory(next); event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const pointerLeave = () => { hoverRef.current = null; if (!interactionRef.current.last) scheduleRender(); };

  const ensureSession = async () => { if (sessionId) return sessionId; if (!output) throw new Error("未选择成图"); const response = await fetch(`${API_BASE_URL}/projects/${projectId}/outputs/${output.id}/edit-sessions`, { method: "POST" }); if (!response.ok) throw new Error(await response.text()); const data = await response.json() as { id: string }; setSessionId(data.id); return data.id; };
  const canvasBlob = (canvas: HTMLCanvasElement | null) => new Promise<Blob | null>((resolve) => canvas?.toBlob(resolve, "image/png"));
  const hasInk = (canvas: HTMLCanvasElement | null) => { if (!canvas) return false; const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data; return Boolean(pixels?.some((_, index) => index % 4 === 3 && pixels[index] !== 0)); };
  const submit = async () => {
    if (!output || !message.trim()) return; commitText();
    try { const [editMask, protectMask, id] = await Promise.all([hasInk(editMaskRef.current) ? canvasBlob(editMaskRef.current) : null, hasInk(protectMaskRef.current) ? canvasBlob(protectMaskRef.current) : null, ensureSession()]); const sourceWidth = editMaskRef.current?.width ?? 0; const sourceHeight = editMaskRef.current?.height ?? 0; const canvasExpansion = Object.values(outpaintEdges).some(Boolean) ? { top: outpaintEdges.top ? Math.round(sourceHeight * 0.2) : 0, right: outpaintEdges.right ? Math.round(sourceWidth * 0.2) : 0, bottom: outpaintEdges.bottom ? Math.round(sourceHeight * 0.2) : 0, left: outpaintEdges.left ? Math.round(sourceWidth * 0.2) : 0 } : undefined; const form = new FormData(); form.set("baseOutputId", output.id); form.set("message", message.trim()); form.set("annotations", JSON.stringify({ sourceWidth, sourceHeight, annotations, canvasExpansion })); form.set("referenceAssetIds", JSON.stringify(referenceAssetIds)); if (editMask) form.set("editMask", editMask, "edit-mask.png"); if (protectMask) form.set("protectMask", protectMask, "protect-mask.png"); const response = await fetch(`${API_BASE_URL}/edit-sessions/${id}/turns`, { method: "POST", body: form }); if (!response.ok) throw new Error(await response.text()); const result = await response.json() as { turnId: string }; setTurn({ id: result.turnId, status: "PLANNING", plan: null, error: null }); } catch (error) { setTurn({ id: "", status: "FAILED", plan: null, error: { message: errorText(error) } }); }
  };
  const refreshTurn = async (id: string) => { const response = await fetch(`${API_BASE_URL}/edit-turns/${id}`); if (response.ok) setTurn(await response.json() as EditTurn); };
  const approve = async () => { if (!turn?.id) return; const response = await fetch(`${API_BASE_URL}/edit-turns/${turn.id}/approve`, { method: "POST" }); if (response.ok) setTurn((current) => current ? { ...current, status: "GENERATING" } : current); };
  const clearMarks = () => { const edit = editMaskRef.current; const protect = protectMaskRef.current; if (!edit || !protect) return; edit.getContext("2d")?.clearRect(0, 0, edit.width, edit.height); protect.getContext("2d")?.clearRect(0, 0, protect.width, protect.height); setAnnotations([]); redrawOverlay([]); pushHistory([]); };
  const pending = turn?.status === "PLANNING" || turn?.status === "GENERATING";
  const toggleOutpaintEdge = (edge: keyof typeof outpaintEdges) => setOutpaintEdges((current) => ({ ...current, [edge]: !current[edge] }));
  const changeZoom = (delta: number) => setZoom((current) => Math.min(4, Math.max(0.25, Math.round((current + delta) * 20) / 20)));
  const handleCanvasWheel = (event: React.WheelEvent<HTMLDivElement>) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); changeZoom(event.deltaY > 0 ? -0.1 : 0.1); };
  const tools: Array<{ id: Tool; label: string; icon: ReactNode }> = [{ id: "pan", label: "移动画布", icon: <Hand size={18} /> }, { id: "rect", label: "框选可编辑区域", icon: <SquareDashedMousePointer size={18} /> }, { id: "brush", label: "涂抹可编辑区域", icon: <Brush size={18} /> }, { id: "erase", label: "擦除标记", icon: <Eraser size={18} /> }, { id: "protect", label: "保护区域", icon: <Shield size={18} /> }, { id: "arrow", label: "箭头标注", icon: <ArrowUpRight size={18} /> }, { id: "text", label: "文字标注", icon: <Type size={18} /> }];

  return <Modal open={Boolean(output)} onCancel={onClose} footer={null} width="min(1380px, calc(100vw - 32px))" className={styles.editModal} title="编辑图片">
    {output ? <div className={styles.editWorkspace}>
      <aside className={styles.editToolbar} aria-label="编辑工具">
        {tools.map((entry) => <Tooltip key={entry.id} title={entry.label}><button type="button" className={styles.editTool} data-active={tool === entry.id} onClick={() => { commitText(); setTool(entry.id); }} aria-label={entry.label}>{entry.icon}</button></Tooltip>)}
        <span className={styles.editDivider} />
        <Tooltip title="撤销"><button type="button" className={styles.editTool} disabled={historyIndex <= 0} onClick={() => restoreHistory(historyIndex - 1)}><Undo2 size={18} /></button></Tooltip><Tooltip title="重做"><button type="button" className={styles.editTool} disabled={historyIndex >= history.length - 1} onClick={() => restoreHistory(historyIndex + 1)}><Redo2 size={18} /></button></Tooltip><Tooltip title="清除标记"><button type="button" className={styles.editTool} onClick={clearMarks}><RotateCcw size={18} /></button></Tooltip>
        <span className={styles.editDivider} />
        <Tooltip title="缩小"><button type="button" className={styles.editTool} disabled={zoom <= 0.25} onClick={() => changeZoom(-0.25)} aria-label="缩小"><ZoomOut size={18} /></button></Tooltip><Tooltip title="放大"><button type="button" className={styles.editTool} disabled={zoom >= 4} onClick={() => changeZoom(0.25)} aria-label="放大"><ZoomIn size={18} /></button></Tooltip><Tooltip title="恢复 100% 并居中"><button type="button" className={styles.editTool} data-active={zoom !== 1 || panOffset.x !== 0 || panOffset.y !== 0} onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }} aria-label="恢复 100% 并居中"><Scan size={18} /></button></Tooltip>
      </aside>
      <section className={styles.editCanvasArea}>
        <div className={styles.editCanvasFrame} style={{ transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0) scale(${zoom})` }} onWheel={handleCanvasWheel}>
          <img ref={imageRef} src={output.url} alt="待编辑图片" onLoad={initializeCanvas} />
          <canvas ref={overlayRef} className={styles.editCanvas} data-tool={tool} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerLeave={pointerLeave} onClick={placeText} />
          {textDraft ? <input ref={textInputRef} autoFocus className={styles.editInlineText} style={{ left: `${(textDraft.point.x / (overlayRef.current?.width || 1)) * 100}%`, top: `${(textDraft.point.y / (overlayRef.current?.height || 1)) * 100}%`, color: markColor, fontSize: `${Math.max(14, textSize * ((overlayRef.current?.clientWidth || 1) / (overlayRef.current?.width || 1)))}px` }} value={textDraft.value} onChange={(event) => setTextDraft((current) => current ? { ...current, value: event.target.value } : current)} onBlur={commitText} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); commitText(); } if (event.key === "Escape") setTextDraft(null); }} placeholder="输入文字，Enter 确认" aria-label="输入文字标注" /> : null}
        </div>
      </section>
      <aside className={styles.editAgentPanel}>
        <div><p className={styles.editEyebrow}>AI 编辑</p><h2>告诉我想怎么改</h2><p className={styles.editHint}>蓝色为可编辑区域，橙色为保护区域。当前视图 {Math.round(zoom * 100)}%</p></div>
        {["rect", "arrow", "text"].includes(tool) ? <label className={styles.editColorPicker}><span>{tool === "text" ? "文字颜色" : "标注颜色"}</span><div>{MARK_COLORS.map((color) => <button key={color} type="button" aria-label={`使用 ${color} 标注`} data-active={markColor === color} style={{ backgroundColor: color }} onClick={() => setMarkColor(color)} />)}</div></label> : null}
        {(tool === "brush" || tool === "erase" || tool === "protect") ? <label className={styles.editBrushSize}>笔刷大小<input type="range" min="12" max="160" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label> : null}
        {tool === "text" ? <><label className={styles.editTextSize}>字号<InputNumber min={16} max={96} value={textSize} onChange={(value) => setTextSize(typeof value === "number" ? value : 32)} /></label><p className={styles.editTextHint}>{textDraft ? "正在编辑画布上的文字，Enter 确认" : "点击图片放置文字"}</p></> : null}
        {assets.filter((asset) => asset.kind === "REFERENCE").length > 0 ? <div className={styles.editReferences}><p>参考素材</p><div>{assets.filter((asset) => asset.kind === "REFERENCE").map((asset) => <button key={asset.id} type="button" data-selected={referenceAssetIds.includes(asset.id)} onClick={() => setReferenceAssetIds((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id])}><img src={asset.url} alt="" /><span>{asset.id.slice(0, 6)}</span></button>)}</div></div> : null}
        <div className={styles.editOutpaint}><p>扩展画布 <span>每侧 20%</span></p><div><Tooltip title="向上扩展"><button type="button" data-active={outpaintEdges.top} onClick={() => toggleOutpaintEdge("top")} aria-label="向上扩展"><ArrowUp size={16} /></button></Tooltip><Tooltip title="向右扩展"><button type="button" data-active={outpaintEdges.right} onClick={() => toggleOutpaintEdge("right")} aria-label="向右扩展"><ArrowRight size={16} /></button></Tooltip><Tooltip title="向下扩展"><button type="button" data-active={outpaintEdges.bottom} onClick={() => toggleOutpaintEdge("bottom")} aria-label="向下扩展"><ArrowDown size={16} /></button></Tooltip><Tooltip title="向左扩展"><button type="button" data-active={outpaintEdges.left} onClick={() => toggleOutpaintEdge("left")} aria-label="向左扩展"><ArrowLeft size={16} /></button></Tooltip></div></div>
        <Input.TextArea value={message} onChange={(event) => setMessage(event.target.value)} autoSize={{ minRows: 4, maxRows: 8 }} placeholder="例如：把选中的菠萝颜色调得更金黄，保留叶片和背景光线" disabled={pending} />
        {turn?.plan?.userSummary ? <div className={styles.editPlan}><p>{turn.plan.userSummary}</p><span>{turn.plan.operation === "PRECISE_INPAINT" ? "局部精确修改" : turn.plan.operation}</span></div> : null}
        {turn?.status === "NEED_INPUT" || turn?.status === "FAILED" ? <p className={styles.editError}>{turn.error?.message ?? "需要补充编辑区域或参考素材。"}</p> : null}{turn?.status === "SUCCEEDED" ? <p className={styles.editSuccess}>新版本已生成，可关闭后继续在结果区编辑。</p> : null}
        <div className={styles.editCommands}>{turn?.status === "AWAITING_CONFIRMATION" || turn?.status === "PLAN_READY" ? <Button type="primary" onClick={() => void approve()}>确认修改</Button> : <Button type="primary" icon={<Send size={15} />} disabled={!message.trim() || pending} loading={pending} onClick={() => void submit()}>生成计划</Button>}</div>
      </aside>
    </div> : null}
  </Modal>;
}

function drawArrow(context: CanvasRenderingContext2D, from: Point, to: Point, color: string, width: number): void {
  context.save(); context.strokeStyle = color; context.fillStyle = color; context.lineWidth = Math.max(3, width / 450); context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke(); const angle = Math.atan2(to.y - from.y, to.x - from.x); const head = Math.max(12, width / 40); context.beginPath(); context.moveTo(to.x, to.y); context.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6)); context.moveTo(to.x, to.y); context.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6)); context.stroke(); context.restore();
}
