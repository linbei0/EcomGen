import { Button, Input, InputNumber, Modal, Popover, Select, Tooltip } from "antd";
import { ArrowUpRight, Brush, Check, ChevronDown, Eraser, Hand, Redo2, RotateCcw, Scan, Send, Settings2, Shield, SquareDashedMousePointer, Type, Undo2, Upload, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import type { Asset, Output, ProjectDetail } from "../../api/adapters/projectDetail";
import { useProviders } from "../../api/hooks/useProviders";
import { API_BASE_URL } from "../../config/env";
import { errorText } from "../../lib/errorText";
import { editErrorLabel, editExecutionModeLabel, editOperationLabel } from "../../lib/userText";
import { modelOptions } from "../../lib/modelOptions";
import styles from "./workbench.module.css";

type Tool = "pan" | "rect" | "brush" | "erase" | "protect" | "arrow" | "text";
type TurnState = "PLANNING" | "PLAN_READY" | "NEED_INPUT" | "AWAITING_CONFIRMATION" | "GENERATING" | "SUCCEEDED" | "FAILED";
interface ReferenceSelection { id: string; source: "PROJECT" | "TEMPORARY"; purpose: ReferencePurpose; order: number; }
type ReferencePurpose = "PRODUCT_APPEARANCE" | "PACKAGING" | "LABEL" | "STYLE" | "LAYOUT";
interface ReferenceAssetView { id: string; source: "PROJECT" | "TEMPORARY"; purpose: ReferencePurpose; role: string | null; originalName: string; mimeType: string; url: string; hash: string; expiresAt: string | null; }
interface EditTurn { id: string; status: TurnState; plan: { userSummary?: string; operation?: string; executionMode?: string; targetDescription?: string; targetConfidence?: number; clarification?: string | null; requiresConfirmation?: boolean } | null; error: { message?: string } | null; }
interface Point { x: number; y: number; }
interface Bounds { x: number; y: number; width: number; height: number; }
interface TextDraft { point: Point; value: string; }
interface Snapshot { edit: string; protect: string; annotations: Array<Record<string, unknown>>; }
interface EditSessionState { id: string; currentOutputId: string; memorySummary: { summary?: string; constraints?: string[]; sourceOutputId?: string }; versions: Array<{ id: string; createdAt: string }>; }
type RectHandle = "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
interface Interaction { start: Point | null; last: Point | null; erased: Bounds | null; rectId: string | null; rectBounds: Bounds | null; rectHandle: RectHandle | null; }
type EditProjectDefaults = Pick<ProjectDetail, "reasoningProviderId" | "reasoningModelId" | "imageProviderId" | "imageModelId" | "imageResolution" | "candidatesPerType">;

const MARK_COLORS = ["#1888f2", "#ff5c5c", "#ffbf2f", "#25bd7b", "#9968f2"];
const EDIT_OVERLAY_COLOR = "#006dff";
const PROTECT_OVERLAY_COLOR = "#f07800";
const EDIT_OVERLAY_ALPHA = 0.72;
const PROTECT_OVERLAY_ALPHA = 0.64;
const MAX_HISTORY_ENTRIES = 20;
const MAX_HISTORY_BYTES = 32 * 1024 * 1024;
const PURPOSE_OPTIONS: Array<{ value: ReferencePurpose; label: string }> = [{ value: "PRODUCT_APPEARANCE", label: "外观" }, { value: "PACKAGING", label: "包装" }, { value: "LABEL", label: "标签" }, { value: "STYLE", label: "风格" }, { value: "LAYOUT", label: "构图" }];

/** 将 API 返回的文件路径解析为可供图片元素使用的地址，同时兼容相对 API 前缀。 */
export function resolveReferenceImageUrl(url: string, apiBaseUrl = API_BASE_URL): string {
  if (/^https?:\/\//.test(url)) return url;
  const apiOrigin = /^https?:\/\//.test(apiBaseUrl) ? new URL(apiBaseUrl).origin : "";
  if (url.startsWith("/api/v1/")) return apiOrigin ? `${apiOrigin}${url}` : url;
  return `${apiBaseUrl}/${url.replace(/^\/+/, "")}`;
}

function boundsFor(point: Point, size: number): Bounds { return { x: point.x - size / 2, y: point.y - size / 2, width: size, height: size }; }
function mergeBounds(current: Bounds | null, next: Bounds): Bounds { if (!current) return next; const x = Math.min(current.x, next.x); const y = Math.min(current.y, next.y); return { x, y, width: Math.max(current.x + current.width, next.x + next.width) - x, height: Math.max(current.y + current.height, next.y + next.height) - y }; }
function intersects(left: Bounds, right: Bounds): boolean { return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y; }
function contains(bounds: Bounds, point: Point): boolean { return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height; }
function moveBounds(bounds: Bounds, from: Point, to: Point, width: number, height: number): Bounds {
  return {
    ...bounds,
    x: Math.max(0, Math.min(width - bounds.width, bounds.x + to.x - from.x)),
    y: Math.max(0, Math.min(height - bounds.height, bounds.y + to.y - from.y)),
  };
}
function rectHandleForPoint(bounds: Bounds, point: Point, tolerance: number): RectHandle | null {
  const left = bounds.x; const right = bounds.x + bounds.width; const top = bounds.y; const bottom = bounds.y + bounds.height; const centerX = left + bounds.width / 2; const centerY = top + bounds.height / 2;
  const handles: Array<[Exclude<RectHandle, "move">, number, number]> = [["nw", left, top], ["ne", right, top], ["se", right, bottom], ["sw", left, bottom], ["n", centerX, top], ["e", right, centerY], ["s", centerX, bottom], ["w", left, centerY]];
  const hit = handles.find(([, x, y]) => Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance);
  if (hit) return hit[0];
  const inHorizontalRange = point.x >= left - tolerance && point.x <= right + tolerance;
  const inVerticalRange = point.y >= top - tolerance && point.y <= bottom + tolerance;
  if (inHorizontalRange && (Math.abs(point.y - top) <= tolerance || Math.abs(point.y - bottom) <= tolerance)) return "move";
  if (inVerticalRange && (Math.abs(point.x - left) <= tolerance || Math.abs(point.x - right) <= tolerance)) return "move";
  return null;
}
function cursorForRectHandle(handle: RectHandle): string {
  if (handle === "move") return "move";
  if (handle === "nw" || handle === "se") return "nwse-resize";
  if (handle === "ne" || handle === "sw") return "nesw-resize";
  if (handle === "n" || handle === "s") return "ns-resize";
  return "ew-resize";
}
function resizeBounds(bounds: Bounds, handle: Exclude<RectHandle, "move">, point: Point, width: number, height: number): Bounds {
  const minSize = 8;
  let left = bounds.x; let right = bounds.x + bounds.width; let top = bounds.y; let bottom = bounds.y + bounds.height;
  if (handle.includes("w")) left = Math.max(0, Math.min(right - minSize, point.x));
  if (handle.includes("e")) right = Math.min(width, Math.max(left + minSize, point.x));
  if (handle.includes("n")) top = Math.max(0, Math.min(bottom - minSize, point.y));
  if (handle.includes("s")) bottom = Math.min(height, Math.max(top + minSize, point.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
function drawSelectionHandles(context: CanvasRenderingContext2D, bounds: Bounds, canvasWidth: number): void {
  const half = Math.max(4, canvasWidth / 180);
  const positions: Array<[number, number]> = [[bounds.x, bounds.y], [bounds.x + bounds.width / 2, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x + bounds.width, bounds.y + bounds.height / 2], [bounds.x + bounds.width, bounds.y + bounds.height], [bounds.x + bounds.width / 2, bounds.y + bounds.height], [bounds.x, bounds.y + bounds.height], [bounds.x, bounds.y + bounds.height / 2]];
  context.save(); context.setLineDash([]); context.fillStyle = "#f8fbff"; context.strokeStyle = EDIT_OVERLAY_COLOR; context.lineWidth = Math.max(2, canvasWidth / 650);
  for (const [x, y] of positions) { context.fillRect(x - half, y - half, half * 2, half * 2); context.strokeRect(x - half, y - half, half * 2, half * 2); }
  context.restore();
}
function drawMaskOverlay(context: CanvasRenderingContext2D, mask: HTMLCanvasElement, tint: HTMLCanvasElement, color: string, alpha: number): void {
  const tintContext = tint.getContext("2d");
  if (!tintContext) return;
  tintContext.globalCompositeOperation = "source-over";
  tintContext.clearRect(0, 0, tint.width, tint.height);
  tintContext.fillStyle = color;
  tintContext.fillRect(0, 0, tint.width, tint.height);
  tintContext.globalCompositeOperation = "destination-in";
  tintContext.drawImage(mask, 0, 0);
  context.save();
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = alpha;
  context.drawImage(tint, 0, 0);
  context.restore();
}

export function EditImageWorkspace({ projectId, project, output, outputs, assets, onSelectOutput, onClose }: { projectId: string; project?: EditProjectDefaults; output: Output | undefined; outputs: Output[]; assets: Asset[]; onSelectOutput: (outputId: string) => void; onClose: () => void }) {
  const providers = useProviders();
  const imageRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const editMaskRef = useRef<HTMLCanvasElement | null>(null);
  const protectMaskRef = useRef<HTMLCanvasElement | null>(null);
  const editTintRef = useRef<HTMLCanvasElement | null>(null);
  const protectTintRef = useRef<HTMLCanvasElement | null>(null);
  const interactionRef = useRef<Interaction>({ start: null, last: null, erased: null, rectId: null, rectBounds: null, rectHandle: null });
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
  const [selectedRectId, setSelectedRectId] = useState<string | null>(null);
  const [referenceSelections, setReferenceSelections] = useState<ReferenceSelection[]>([]);
  const [referenceAssets, setReferenceAssets] = useState<ReferenceAssetView[]>([]);
  const [suggestedReferenceSelections, setSuggestedReferenceSelections] = useState<ReferenceSelection[]>([]);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referenceTab, setReferenceTab] = useState<"PROJECT" | "TEMPORARY">("PROJECT");
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [referenceDragActive, setReferenceDragActive] = useState(false);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const uploadCancelledRef = useRef(false);
  const referenceFileRef = useRef<HTMLInputElement>(null);
  const [outpaintEdges, setOutpaintEdges] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [session, setSession] = useState<EditSessionState | null>(null);
  const [memorySummary, setMemorySummary] = useState("");
  const [memoryConstraints, setMemoryConstraints] = useState("");
  const [memorySourceOutputId, setMemorySourceOutputId] = useState<string | undefined>();
  const [compareOutputId, setCompareOutputId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reasoningModel, setReasoningModel] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [imageResolution, setImageResolution] = useState<EditProjectDefaults["imageResolution"]>("1K");
  const [candidateCount, setCandidateCount] = useState(1);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pendingAutoSelectRef = useRef<string | null>(null);

  useEffect(() => {
    if (!project) return;
    setReasoningModel(`${project.reasoningProviderId}::${project.reasoningModelId}`);
    setImageModel(`${project.imageProviderId}::${project.imageModelId}`);
    setImageResolution(project.imageResolution);
    setCandidateCount(project.candidatesPerType);
    setSettingsOpen(false);
  }, [project?.reasoningProviderId, project?.reasoningModelId, project?.imageProviderId, project?.imageModelId, project?.imageResolution, project?.candidatesPerType]);

  const redrawOverlay = (nextAnnotations = annotations, nextSelectedRectId = selectedRectId) => {
    const overlay = overlayRef.current; const edit = editMaskRef.current; const protect = protectMaskRef.current; const editTint = editTintRef.current; const protectTint = protectTintRef.current;
    if (!overlay || !edit || !protect || !editTint || !protectTint) return;
    const context = overlay.getContext("2d"); if (!context) return;
    context.globalCompositeOperation = "source-over"; context.clearRect(0, 0, overlay.width, overlay.height);
    drawMaskOverlay(context, edit, editTint, EDIT_OVERLAY_COLOR, EDIT_OVERLAY_ALPHA);
    drawMaskOverlay(context, protect, protectTint, PROTECT_OVERLAY_COLOR, PROTECT_OVERLAY_ALPHA);
    context.save(); context.lineWidth = Math.max(3, overlay.width / 450);
    for (const annotation of nextAnnotations) {
      const color = annotation.type === "rect" ? EDIT_OVERLAY_COLOR : typeof annotation.color === "string" ? annotation.color : "#4da6ff";
      if (annotation.type === "rect" && annotation.bounds && typeof annotation.bounds === "object") {
        const bounds = annotation.bounds as Bounds; context.save(); context.strokeStyle = color; context.fillStyle = color; context.globalAlpha = 0.12; context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height); context.globalAlpha = 1; context.setLineDash([Math.max(6, overlay.width / 110), Math.max(4, overlay.width / 170)]); context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height); context.restore(); if (tool === "rect" && annotation.id === nextSelectedRectId) drawSelectionHandles(context, bounds, overlay.width);
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
    if (preview?.type === "rect") { const bounds = { x: Math.min(preview.start.x, preview.end.x), y: Math.min(preview.start.y, preview.end.y), width: Math.abs(preview.start.x - preview.end.x), height: Math.abs(preview.start.y - preview.end.y) }; context.save(); context.strokeStyle = EDIT_OVERLAY_COLOR; context.fillStyle = EDIT_OVERLAY_COLOR; context.globalAlpha = 0.16; context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height); context.globalAlpha = 1; context.setLineDash([Math.max(6, overlay.width / 110), Math.max(4, overlay.width / 170)]); context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height); context.restore(); if (interactionRef.current.rectId) drawSelectionHandles(context, bounds, overlay.width); }
    if (preview?.type === "arrow") drawArrow(context, preview.start, preview.end, preview.color, overlay.width);
    const hover = hoverRef.current;
    if (hover && ["brush", "erase", "protect"].includes(tool)) { context.save(); context.lineWidth = Math.max(2, overlay.width / 700); context.setLineDash([Math.max(5, overlay.width / 150), Math.max(4, overlay.width / 190)]); context.strokeStyle = tool === "erase" ? "#f0f3f5" : tool === "protect" ? PROTECT_OVERLAY_COLOR : EDIT_OVERLAY_COLOR; context.beginPath(); context.arc(hover.x, hover.y, brushSize / 2, 0, Math.PI * 2); context.stroke(); context.restore(); }
  };

  const scheduleRender = (nextAnnotations = annotations, nextSelectedRectId = selectedRectId) => {
    if (renderFrameRef.current !== null) return;
    renderFrameRef.current = requestAnimationFrame(() => { renderFrameRef.current = null; redrawOverlay(nextAnnotations, nextSelectedRectId); });
  };

  useEffect(() => () => { if (renderFrameRef.current !== null) cancelAnimationFrame(renderFrameRef.current); }, []);
  useEffect(() => { redrawOverlay(annotations, selectedRectId); }, [annotations, selectedRectId, tool, brushSize, markColor, textDraft]);
  useEffect(() => {
    setSessionId(null); setSession(null); setTurn(null); setMessage(""); setAnnotations([]); setSelectedRectId(null); setReferenceSelections([]); setSuggestedReferenceSelections([]); setReferenceAssets(projectReferenceAssets()); setReferencePickerOpen(false); setOutpaintEdges({ top: 0, right: 0, bottom: 0, left: 0 }); setHistory([]); setHistoryIndex(-1); setTextDraft(null); setZoom(1); setPanOffset({ x: 0, y: 0 }); setCompareOutputId(null); setMemorySourceOutputId(undefined);
    if (!output) return;
    let cancelled = false;
    void fetch(`${API_BASE_URL}/projects/${projectId}/outputs/${output.id}/edit-sessions`, { method: "POST" }).then(async (response) => { if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<EditSessionState>; }).then((value) => { if (cancelled) return; setSessionId(value.id); setSession(value); setMemorySummary(value.memorySummary?.summary ?? ""); setMemoryConstraints((value.memorySummary?.constraints ?? []).join("\n")); setMemorySourceOutputId(value.memorySummary?.sourceOutputId); void loadReferenceAssets(value.id).catch(() => undefined); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [output?.id, projectId]);
  const referenceImageUrl = (url: string) => resolveReferenceImageUrl(url);
  const projectAssetSignature = assets.map((asset) => `${asset.id}:${asset.role}`).join("|");
  const projectReferenceAssets = (): ReferenceAssetView[] => assets.map((asset) => ({ id: asset.id, source: "PROJECT", purpose: asset.role === "PRODUCT_TRUTH" ? "PRODUCT_APPEARANCE" : asset.role === "PACKAGING" ? "PACKAGING" : asset.role === "STYLE_REFERENCE" ? "STYLE" : "LAYOUT", role: asset.role, originalName: asset.originalName ?? `项目素材 ${asset.id.slice(0, 6)}`, mimeType: asset.mimeType, url: asset.url ?? `${API_BASE_URL}/files/assets/${asset.id}`, hash: asset.hash ?? "", expiresAt: null }));
  useEffect(() => { const projectItems = projectReferenceAssets(); setReferenceAssets((current) => { const temporary = current.filter((item) => item.source === "TEMPORARY"); return [...projectItems, ...temporary]; }); }, [projectAssetSignature]);
  const loadReferenceAssets = async (id: string) => { setReferenceLoading(true); try { const response = await fetch(`${API_BASE_URL}/edit-sessions/${id}/reference-assets`); if (!response.ok) throw new Error(await response.text()); const result = await response.json() as { items: ReferenceAssetView[]; suggestedSelections?: ReferenceSelection[] }; const loaded = result.items.map((item) => ({ ...item, url: referenceImageUrl(item.url) })); setReferenceAssets((current) => { const byKey = new Map(current.map((item) => [`${item.source}:${item.id}`, item])); for (const item of loaded) byKey.set(`${item.source}:${item.id}`, item); return [...byKey.values()]; }); setSuggestedReferenceSelections(result.suggestedSelections ?? []); } finally { setReferenceLoading(false); } };
  useEffect(() => {
    if (!referencePickerOpen) return;
    setReferenceAssets((current) => {
      const byKey = new Map(current.map((item) => [`${item.source}:${item.id}`, item]));
      for (const item of projectReferenceAssets()) byKey.set(`${item.source}:${item.id}`, item);
      return [...byKey.values()];
    });
    if (sessionId) void loadReferenceAssets(sessionId).catch(() => undefined);
  }, [referencePickerOpen, sessionId, projectAssetSignature]);
  const toggleReference = (asset: ReferenceAssetView) => setReferenceSelections((current) => { const found = current.find((selection) => selection.id === asset.id && selection.source === asset.source); if (found) return current.filter((selection) => selection !== found).map((selection, order) => ({ ...selection, order })); return [...current, { id: asset.id, source: asset.source, purpose: asset.purpose, order: current.length }]; });
  const updateReferencePurpose = (asset: ReferenceAssetView, purpose: ReferencePurpose) => setReferenceSelections((current) => current.map((selection) => selection.id === asset.id && selection.source === asset.source ? { ...selection, purpose } : selection));
  const removeReference = async (asset: ReferenceAssetView) => { setReferenceSelections((current) => current.filter((selection) => !(selection.id === asset.id && selection.source === asset.source)).map((selection, order) => ({ ...selection, order }))); if (asset.source === "TEMPORARY" && sessionId) { const response = await fetch(`${API_BASE_URL}/edit-sessions/${sessionId}/reference-assets/${asset.id}`, { method: "DELETE" }); if (response.ok) setReferenceAssets((current) => current.filter((item) => item.id !== asset.id)); } };
  const promoteReference = async (asset: ReferenceAssetView) => { if (!sessionId || asset.source !== "TEMPORARY") return; const response = await fetch(`${API_BASE_URL}/edit-sessions/${sessionId}/reference-assets/${asset.id}/promote`, { method: "POST" }); if (!response.ok) throw new Error(await response.text()); const item = await response.json() as ReferenceAssetView; const normalized = { ...item, url: referenceImageUrl(item.url) }; setReferenceAssets((current) => [...current.filter((candidate) => candidate.id !== asset.id), normalized]); setReferenceSelections((current) => current.map((selection) => selection.id === asset.id && selection.source === "TEMPORARY" ? { ...selection, id: normalized.id, source: "PROJECT" } : selection)); };
  const uploadReference = async (file: File, targetSessionId?: string) => { const activeSessionId = targetSessionId ?? sessionId; if (!activeSessionId) return; const controller = new AbortController(); uploadControllerRef.current = controller; setReferenceUploading(true); try { const form = new FormData(); form.set("file", file); form.set("purpose", "PRODUCT_APPEARANCE"); const response = await fetch(`${API_BASE_URL}/edit-sessions/${activeSessionId}/reference-assets`, { method: "POST", body: form, signal: controller.signal }); if (!response.ok) throw new Error(await response.text()); const item = await response.json() as ReferenceAssetView; const normalized = { ...item, url: referenceImageUrl(item.url) }; setReferenceAssets((current) => [...current, normalized]); setReferenceSelections((current) => [...current, { id: normalized.id, source: "TEMPORARY", purpose: normalized.purpose, order: current.length }]); setReferenceTab("TEMPORARY"); } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setTurn({ id: "", status: "FAILED", plan: null, error: { message: errorText(error) } }); } finally { uploadControllerRef.current = null; setReferenceUploading(false); } };
  const uploadReferenceFiles = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    uploadCancelledRef.current = false;
    const activeSessionId = sessionId ?? await ensureSession();
    for (const file of images) {
      if (uploadCancelledRef.current) break;
      await uploadReference(file, activeSessionId);
    }
  };
  useEffect(() => { if (!turn || ["SUCCEEDED", "FAILED", "NEED_INPUT"].includes(turn.status)) return; const timer = window.setInterval(() => { void refreshTurn(turn.id); }, 1500); return () => window.clearInterval(timer); }, [turn?.id, turn?.status]);
  useEffect(() => {
    if (!session || !output || session.currentOutputId === output.id) return;
    if (pendingAutoSelectRef.current !== session.currentOutputId) return;
    if (outputs.some((item) => item.id === session.currentOutputId)) {
      pendingAutoSelectRef.current = null;
      onSelectOutput(session.currentOutputId);
    }
  }, [session?.currentOutputId, output?.id, outputs, onSelectOutput]);
  useEffect(() => { if (textDraft) window.requestAnimationFrame(() => textInputRef.current?.focus()); }, [textDraft]);

  const snapshot = (records = annotations): Snapshot => ({ edit: editMaskRef.current?.toDataURL() ?? "", protect: protectMaskRef.current?.toDataURL() ?? "", annotations: records.map((annotation) => structuredClone(annotation)) });
  const pushHistory = (records = annotations) => {
    const next = [...historyRef.current.slice(0, historyIndexRef.current + 1), snapshot(records)].slice(-MAX_HISTORY_ENTRIES);
    let bytes = 0;
    while (next.length > 1) {
      bytes = next.reduce((total, value) => total + value.edit.length + value.protect.length + JSON.stringify(value.annotations).length, 0);
      if (bytes <= MAX_HISTORY_BYTES) break;
      next.shift();
    }
    historyRef.current = next;
    historyIndexRef.current = next.length - 1;
    setHistory(next);
    setHistoryIndex(next.length - 1);
  };
  const restoreHistory = (index: number) => {
    const value = historyRef.current[index]; if (!value || !editMaskRef.current || !protectMaskRef.current) return;
    const load = (canvas: HTMLCanvasElement, url: string) => new Promise<void>((resolve) => { const image = new Image(); image.onload = () => { canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); canvas.getContext("2d")?.drawImage(image, 0, 0); resolve(); }; image.src = url; });
    void Promise.all([load(editMaskRef.current, value.edit), load(protectMaskRef.current, value.protect)]).then(() => { historyIndexRef.current = index; setHistoryIndex(index); setSelectedRectId(null); setAnnotations(value.annotations); redrawOverlay(value.annotations, null); });
  };

  const initializeCanvas = () => {
    const image = imageRef.current; const overlay = overlayRef.current; if (!image || !overlay || !image.naturalWidth || !image.naturalHeight) return;
    const edit = document.createElement("canvas"); const protect = document.createElement("canvas"); const editTint = document.createElement("canvas"); const protectTint = document.createElement("canvas"); for (const canvas of [overlay, edit, protect, editTint, protectTint]) { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; }
    editMaskRef.current = edit; protectMaskRef.current = protect; editTintRef.current = editTint; protectTintRef.current = protectTint; interactionRef.current = { start: null, last: null, erased: null, rectId: null, rectBounds: null, rectHandle: null }; const initial = snapshot([]); historyRef.current = [initial]; historyIndexRef.current = 0; setHistory([initial]); setHistoryIndex(0); redrawOverlay([], null);
  };
  const pointFor = (event: ReactPointerEvent<HTMLCanvasElement>): Point | null => { const canvas = overlayRef.current; if (!canvas) return null; const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) }; };
  const stroke = (from: Point, to: Point) => {
    const targets = tool === "erase" ? [editMaskRef.current, protectMaskRef.current] : [tool === "protect" ? protectMaskRef.current : editMaskRef.current];
    for (const target of targets) { const context = target?.getContext("2d"); if (!context) continue; context.save(); context.lineWidth = brushSize; context.lineCap = "round"; context.lineJoin = "round"; context.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over"; context.strokeStyle = "white"; context.fillStyle = "white"; context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke(); context.beginPath(); context.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2); context.fill(); context.restore(); }
    scheduleRender();
  };
  const editMaskForSubmit = () => {
    const edit = editMaskRef.current;
    if (!edit) return null;
    const rectangles = annotations.filter((annotation) => annotation.type === "rect" && annotation.bounds && typeof annotation.bounds === "object");
    if (rectangles.length === 0) return edit;
    const combined = document.createElement("canvas");
    combined.width = edit.width; combined.height = edit.height;
    const context = combined.getContext("2d");
    if (!context) return edit;
    context.drawImage(edit, 0, 0);
    context.fillStyle = "white";
    for (const annotation of rectangles) {
      const bounds = annotation.bounds as Bounds;
      context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
    return combined;
  };
  const commitText = () => {
    if (!textDraft) return; const value = textDraft.value.trim(); if (!value) { setTextDraft(null); return; }
    const next = [...annotations, { id: crypto.randomUUID(), type: "text", point: textDraft.point, text: value, color: markColor, fontSize: textSize, semanticRole: "instruction" }]; setAnnotations(next); setTextDraft(null); pushHistory(next);
  };
  const rectHitAt = (point: Point) => {
    const overlay = overlayRef.current; if (!overlay) return null;
    const displayWidth = overlay.getBoundingClientRect().width || overlay.width;
    const tolerance = Math.max(6, 8 * (overlay.width / displayWidth));
    for (const annotation of [...annotations].reverse()) {
      if (annotation.type !== "rect" || !annotation.bounds || typeof annotation.bounds !== "object" || typeof annotation.id !== "string") continue;
      const bounds = annotation.bounds as Bounds; const handle = rectHandleForPoint(bounds, point, tolerance);
      if (handle) return { id: annotation.id, bounds, handle };
    }
    return null;
  };
  const updateRectCursor = (canvas: HTMLCanvasElement, point: Point, handle?: RectHandle | null) => {
    if (tool !== "rect") return;
    const hit = handle ? null : rectHitAt(point);
    canvas.style.cursor = handle ? cursorForRectHandle(handle) : hit ? cursorForRectHandle(hit.handle) : "crosshair";
  };
  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointFor(event); if (!point) return; hoverRef.current = point;
    if (tool === "pan") { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); panRef.current = { startX: event.clientX, startY: event.clientY, originX: panOffset.x, originY: panOffset.y }; return; }
    if (tool === "text") return;
    if (tool === "rect") {
      const hit = rectHitAt(point);
      if (hit) {
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setSelectedRectId(hit.id); updateRectCursor(event.currentTarget, point, hit.handle);
        interactionRef.current = { start: point, last: point, erased: null, rectId: hit.id, rectBounds: hit.bounds, rectHandle: hit.handle };
        return;
      }
      const contained = [...annotations].reverse().find((annotation) => annotation.type === "rect" && annotation.bounds && typeof annotation.bounds === "object" && contains(annotation.bounds as Bounds, point));
      if (contained && typeof contained.id === "string") { setSelectedRectId(contained.id); updateRectCursor(event.currentTarget, point); return; }
      setSelectedRectId(null);
    }
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = {
      start: point,
      last: point,
      erased: tool === "erase" ? boundsFor(point, brushSize) : null,
      rectId: null,
      rectBounds: null,
      rectHandle: null,
    };
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
    const current = interactionRef.current; if (!current.last) { updateRectCursor(event.currentTarget, point); scheduleRender(); return; }
    if (tool === "rect" && current.rectBounds && current.rectHandle && current.start) {
      const width = overlayRef.current?.width ?? 0; const height = overlayRef.current?.height ?? 0;
      const bounds = current.rectHandle === "move" ? moveBounds(current.rectBounds, current.start, point, width, height) : resizeBounds(current.rectBounds, current.rectHandle, point, width, height);
      previewRef.current = { type: "rect", start: { x: bounds.x, y: bounds.y }, end: { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, color: EDIT_OVERLAY_COLOR };
      updateRectCursor(event.currentTarget, point, current.rectHandle); scheduleRender();
      return;
    }
    if (tool === "rect" || tool === "arrow") { previewRef.current = { type: tool, start: current.start!, end: point, color: tool === "rect" ? EDIT_OVERLAY_COLOR : markColor }; scheduleRender(); return; }
    stroke(current.last, point); current.last = point; if (tool === "erase") current.erased = mergeBounds(current.erased, boundsFor(point, brushSize));
  };
  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool === "pan") { panRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
    const current = interactionRef.current; if (!current.start) return; const point = pointFor(event); interactionRef.current = { start: null, last: null, erased: null, rectId: null, rectBounds: null, rectHandle: null }; previewRef.current = null; let next = annotations; let nextSelectedRectId = selectedRectId;
    if (tool === "rect" && point) {
      if (current.rectId && current.rectBounds && current.rectHandle) {
        const width = overlayRef.current?.width ?? 0; const height = overlayRef.current?.height ?? 0;
        const bounds = current.rectHandle === "move" ? moveBounds(current.rectBounds, current.start, point, width, height) : resizeBounds(current.rectBounds, current.rectHandle, point, width, height);
        next = annotations.map((annotation) => annotation.id === current.rectId ? { ...annotation, bounds } : annotation);
        nextSelectedRectId = current.rectId;
        setAnnotations(next);
      } else {
        const bounds = { x: Math.min(current.start.x, point.x), y: Math.min(current.start.y, point.y), width: Math.abs(current.start.x - point.x), height: Math.abs(current.start.y - point.y) };
        if (bounds.width > 2 && bounds.height > 2) { const id = crypto.randomUUID(); next = [...annotations, { id, type: "rect", bounds, color: EDIT_OVERLAY_COLOR, semanticRole: "target" }]; nextSelectedRectId = id; setSelectedRectId(id); setAnnotations(next); }
      }
    }
    if (tool === "arrow" && point) { next = [...annotations, { id: crypto.randomUUID(), type: "arrow", points: [current.start, point], color: markColor, semanticRole: "instruction" }]; setAnnotations(next); }
    if (tool === "erase" && current.erased) { next = annotations.filter((annotation) => annotation.type !== "rect" || !annotation.bounds || !intersects(annotation.bounds as Bounds, current.erased!)); if (!next.some((annotation) => annotation.id === nextSelectedRectId)) nextSelectedRectId = null; setSelectedRectId(nextSelectedRectId); setAnnotations(next); }
    redrawOverlay(next, nextSelectedRectId); pushHistory(next); if (point) updateRectCursor(event.currentTarget, point); event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const pointerLeave = (event: ReactPointerEvent<HTMLCanvasElement>) => { hoverRef.current = null; if (!interactionRef.current.last) { event.currentTarget.style.cursor = ""; scheduleRender(); } };

  const ensureSession = async () => { if (sessionId) return sessionId; if (!output) throw new Error("未选择成图"); const response = await fetch(`${API_BASE_URL}/projects/${projectId}/outputs/${output.id}/edit-sessions`, { method: "POST" }); if (!response.ok) throw new Error(await response.text()); const data = await response.json() as EditSessionState; setSessionId(data.id); setSession(data); return data.id; };
  const selectVersion = async (versionId: string) => {
    if (!session || !output || versionId === output.id) return;
    const response = await fetch(`${API_BASE_URL}/edit-sessions/${session.id}/select-output`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outputId: versionId }) });
    if (!response.ok) return;
    pendingAutoSelectRef.current = null;
    setSession(await response.json() as EditSessionState);
    onSelectOutput(versionId);
  };
  const saveMemory = async () => { if (!session || !output) return; const constraints = memoryConstraints.split(/\r?\n/).map((value) => value.trim()).filter(Boolean); const response = await fetch(`${API_BASE_URL}/edit-sessions/${session.id}/memory`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ outputId: output.id, summary: memorySummary.trim(), constraints }) }); if (!response.ok) throw new Error(await response.text()); const updated = await response.json() as EditSessionState; setSession((current) => current ? { ...current, ...updated } : updated); setMemorySourceOutputId(updated.memorySummary?.sourceOutputId); };
  const canvasBlob = (canvas: HTMLCanvasElement | null) => new Promise<Blob | null>((resolve) => canvas?.toBlob(resolve, "image/png"));
  const hasInk = (canvas: HTMLCanvasElement | null) => { if (!canvas) return false; const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data; return Boolean(pixels?.some((_, index) => index % 4 === 3 && pixels[index] !== 0)); };
  const submit = async () => {
    if (!output || !message.trim()) return; commitText();
    try { const currentEditMask = editMaskForSubmit(); const [editMask, protectMask, id] = await Promise.all([hasInk(currentEditMask) ? canvasBlob(currentEditMask) : null, hasInk(protectMaskRef.current) ? canvasBlob(protectMaskRef.current) : null, ensureSession()]); const sourceWidth = editMaskRef.current?.width ?? 0; const sourceHeight = editMaskRef.current?.height ?? 0; const canvasExpansion = Object.values(outpaintEdges).some((value) => value > 0) ? outpaintEdges : undefined; const generationConfig = project && reasoningModel && imageModel ? { reasoningProviderId: reasoningModel.split("::")[0], reasoningModelId: reasoningModel.split("::")[1], imageProviderId: imageModel.split("::")[0], imageModelId: imageModel.split("::")[1], imageResolution, candidateCount } : undefined; const form = new FormData(); form.set("baseOutputId", output.id); form.set("message", message.trim()); form.set("annotations", JSON.stringify({ sourceWidth, sourceHeight, annotations, canvasExpansion, ...(generationConfig ? { generationConfig } : {}) })); form.set("referenceSelections", JSON.stringify(referenceSelections)); if (editMask) form.set("editMask", editMask, "edit-mask.png"); if (protectMask) form.set("protectMask", protectMask, "protect-mask.png"); const response = await fetch(`${API_BASE_URL}/edit-sessions/${id}/turns`, { method: "POST", body: form }); if (!response.ok) throw new Error(await response.text()); const result = await response.json() as { turnId: string }; setTurn({ id: result.turnId, status: "PLANNING", plan: null, error: null }); } catch (error) { setTurn({ id: "", status: "FAILED", plan: null, error: { message: errorText(error) } }); }
  };
  const refreshSession = async (id: string, autoSelect = false) => { const response = await fetch(`${API_BASE_URL}/edit-sessions/${id}`); if (!response.ok) return; const value = await response.json() as EditSessionState; if (autoSelect) pendingAutoSelectRef.current = value.currentOutputId; setSession(value); setMemorySummary(value.memorySummary?.summary ?? ""); setMemoryConstraints((value.memorySummary?.constraints ?? []).join("\n")); setMemorySourceOutputId(value.memorySummary?.sourceOutputId); };
  const refreshTurn = async (id: string) => { const response = await fetch(`${API_BASE_URL}/edit-turns/${id}`); if (!response.ok) return; const value = await response.json() as EditTurn; setTurn(value); if (value.status === "NEED_INPUT" && value.error?.message === "REFERENCE_ASSET_REQUIRED") setReferencePickerOpen(true); if (value.status === "SUCCEEDED" && sessionId) void refreshSession(sessionId, true); };
  const approve = async () => { if (!turn?.id) return; const response = await fetch(`${API_BASE_URL}/edit-turns/${turn.id}/approve`, { method: "POST" }); if (response.ok) setTurn((current) => current ? { ...current, status: "GENERATING" } : current); };
  const clearMarks = () => { const edit = editMaskRef.current; const protect = protectMaskRef.current; if (!edit || !protect) return; edit.getContext("2d")?.clearRect(0, 0, edit.width, edit.height); protect.getContext("2d")?.clearRect(0, 0, protect.width, protect.height); setSelectedRectId(null); setAnnotations([]); redrawOverlay([], null); pushHistory([]); };
  const pending = turn?.status === "PLANNING" || turn?.status === "GENERATING";
  const setOutpaintEdge = (edge: keyof typeof outpaintEdges, value: number | null) => setOutpaintEdges((current) => ({ ...current, [edge]: Math.max(0, Math.round(value ?? 0)) }));
  const changeZoom = (delta: number) => setZoom((current) => Math.min(4, Math.max(0.25, Math.round((current + delta) * 20) / 20)));
  const handleCanvasWheel = (event: React.WheelEvent<HTMLDivElement>) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); changeZoom(event.deltaY > 0 ? -0.1 : 0.1); };
  const tools: Array<{ id: Tool; label: string; icon: ReactNode }> = [{ id: "pan", label: "移动画布", icon: <Hand size={18} /> }, { id: "rect", label: "框选可编辑区域", icon: <SquareDashedMousePointer size={18} /> }, { id: "brush", label: "涂抹可编辑区域", icon: <Brush size={18} /> }, { id: "erase", label: "擦除标记", icon: <Eraser size={18} /> }, { id: "protect", label: "保护区域", icon: <Shield size={18} /> }, { id: "arrow", label: "箭头标注", icon: <ArrowUpRight size={18} /> }, { id: "text", label: "文字标注", icon: <Type size={18} /> }];
  const sessionOutputs = (session?.versions ?? []).map((version) => outputs.find((item) => item.id === version.id)).filter((item): item is Output => Boolean(item));
  const versionLabel = (version: Output) => {
    const byId = new Map(outputs.map((item) => [item.id, item]));
    let depth = 0;
    let parentId = version.parentOutputId;
    while (parentId && byId.has(parentId)) { depth += 1; parentId = byId.get(parentId)?.parentOutputId ?? null; }
    if (depth === 0) return "原图";
    const siblings = outputs.filter((candidate) => candidate.parentOutputId === version.parentOutputId).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const ordinal = siblings.findIndex((candidate) => candidate.id === version.id) + 1;
    return `V${depth + 1}${siblings.length > 1 ? ` · ${ordinal}` : ""}`;
  };
  const compareOutput = compareOutputId ? outputs.find((item) => item.id === compareOutputId) : undefined;
  const providerItems = (providers.data?.items ?? []) as Array<{ id: string; name: string; models: Array<{ id: string; supportsVision: boolean; imageApiKind?: string | null }> }>;
  const reasoningOptions = modelOptions(providerItems, "reasoning");
  const imageOptions = modelOptions(providerItems, "image");

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
        {project ? <div className={styles.editGenerationSettings}>
          <button type="button" className={styles.editSettingsToggle} aria-expanded={settingsOpen} onClick={() => setSettingsOpen((current) => !current)}><Settings2 size={15} /><span>本次生成设置</span><small>项目默认</small><ChevronDown size={15} /></button>
          {settingsOpen ? <div className={styles.editSettingsBody}>
            <label>推理模型<select aria-label="推理模型" value={reasoningModel} onChange={(event) => setReasoningModel(event.target.value)}><option value="">项目默认</option>{reasoningOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label>生图模型<select aria-label="生图模型" value={imageModel} onChange={(event) => setImageModel(event.target.value)}><option value="">项目默认</option>{imageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <div className={styles.editSettingsGrid}>
              <label>分辨率<select aria-label="分辨率" value={imageResolution} onChange={(event) => setImageResolution(event.target.value as EditProjectDefaults["imageResolution"])}><option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option></select></label>
              <label>出图数<input aria-label="出图数" type="number" min={1} max={4} value={candidateCount} onChange={(event) => setCandidateCount(Math.min(4, Math.max(1, Number(event.target.value) || 1)))} /></label>
            </div>
          </div> : null}
        </div> : null}
        <div className={styles.editOutpaint}><p>扩展画布 <span>输入新增像素</span></p><div className={styles.editOutpaintInputs}><label>上<InputNumber min={0} max={4096} value={outpaintEdges.top} onChange={(value) => setOutpaintEdge("top", value)} /></label><label>右<InputNumber min={0} max={4096} value={outpaintEdges.right} onChange={(value) => setOutpaintEdge("right", value)} /></label><label>下<InputNumber min={0} max={4096} value={outpaintEdges.bottom} onChange={(value) => setOutpaintEdge("bottom", value)} /></label><label>左<InputNumber min={0} max={4096} value={outpaintEdges.left} onChange={(value) => setOutpaintEdge("left", value)} /></label></div>{Object.values(outpaintEdges).some((value) => value > 0) ? <small>生成后画布约为 {((editMaskRef.current?.width ?? 0) + outpaintEdges.left + outpaintEdges.right)} × {((editMaskRef.current?.height ?? 0) + outpaintEdges.top + outpaintEdges.bottom)} px</small> : null}</div>
        {["arrow", "text"].includes(tool) ? <label className={styles.editColorPicker}><span>{tool === "text" ? "文字颜色" : "标注颜色"}</span><div>{MARK_COLORS.map((color) => <button key={color} type="button" aria-label={`使用 ${color} 标注`} data-active={markColor === color} style={{ backgroundColor: color }} onClick={() => setMarkColor(color)} />)}</div></label> : null}
        {(tool === "brush" || tool === "erase" || tool === "protect") ? <label className={styles.editBrushSize}>笔刷大小<input type="range" min="12" max="160" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label> : null}
        {tool === "text" ? <><label className={styles.editTextSize}>字号<InputNumber min={16} max={96} value={textSize} onChange={(value) => setTextSize(typeof value === "number" ? value : 32)} /></label><p className={styles.editTextHint}>{textDraft ? "正在编辑画布上的文字，Enter 确认" : "点击图片放置文字"}</p></> : null}
        {sessionOutputs.length > 0 ? <div className={styles.editVersions}><p>连续版本</p><div>{sessionOutputs.map((version, index) => { const baseLabel = versionLabel(version); const duplicateCount = sessionOutputs.filter((candidate) => versionLabel(candidate) === baseLabel).length; const ordinal = sessionOutputs.slice(0, index).filter((candidate) => versionLabel(candidate) === baseLabel).length + 1; return <div key={version.id} className={styles.editVersionRow}><button type="button" data-current={output.id === version.id} onClick={() => void selectVersion(version.id)}><span>{baseLabel}{duplicateCount > 1 ? ` · ${ordinal}` : ""}</span><small>{output.id === version.id ? "当前" : "历史"}</small></button>{index < sessionOutputs.length - 1 && output.id !== version.id ? <button type="button" onClick={() => setCompareOutputId(compareOutputId === version.id ? null : version.id)}>{compareOutputId === version.id ? "取消对比" : "对比当前"}</button> : null}</div>; })}</div></div> : null}
        {compareOutput && compareOutput.id !== output.id ? <div className={styles.editCompare}><div><img src={output.url} alt="当前版本" /><span>当前</span></div><div><img src={compareOutput.url} alt="对比版本" /><span>对比</span></div></div> : null}
        <div className={styles.editReferences}>
          <div className={styles.editReferencesHeader}><span>参考素材</span><button type="button" onClick={() => setReferencePickerOpen(true)}>{referenceSelections.length ? `已选 ${referenceSelections.length}` : "选择"}</button></div>
          <div className={styles.editReferenceStrip}>{referenceSelections.slice(0, 3).map((selection) => { const asset = referenceAssets.find((item) => item.id === selection.id && item.source === selection.source); return asset ? <Tooltip key={`${selection.source}:${selection.id}`} title={asset.originalName}><div className={styles.editReferenceChip}><img src={asset.url} alt="" /><span>{PURPOSE_OPTIONS.find((item) => item.value === selection.purpose)?.label}</span><button type="button" aria-label="移除参考素材" onClick={() => void removeReference(asset)}><X size={11} /></button></div></Tooltip> : null; })}{referenceSelections.length > 3 ? <span className={styles.editReferenceMore}>+{referenceSelections.length - 3}</span> : null}{referenceSelections.length === 0 ? <small>未选择</small> : null}</div>
          {suggestedReferenceSelections.length > 0 && referenceSelections.length === 0 ? <button type="button" className={styles.editReferenceReuse} onClick={() => { setReferenceSelections(suggestedReferenceSelections); setReferencePickerOpen(true); }}>沿用上次</button> : null}
          <Popover open={referencePickerOpen} onOpenChange={setReferencePickerOpen} trigger="click" placement="leftTop" content={<div data-testid="reference-drop-zone" aria-label="拖入参考图片" className={`${styles.referencePopover} ${referenceDragActive ? styles.referencePopoverDragActive : ""}`} onDragEnter={(event) => { event.preventDefault(); setReferenceDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setReferenceDragActive(false); }} onDrop={(event) => { event.preventDefault(); setReferenceDragActive(false); void uploadReferenceFiles([...event.dataTransfer.files]); }}>
            <div className={styles.referencePopoverHeading}><strong>参考素材</strong><span>已选 {referenceSelections.length} 张</span></div>
            <div className={styles.referenceTabs}><button type="button" data-active={referenceTab === "PROJECT"} onClick={() => setReferenceTab("PROJECT")}>项目素材</button><button type="button" data-active={referenceTab === "TEMPORARY"} onClick={() => setReferenceTab("TEMPORARY")}>本次上传</button></div>
            <div className={styles.referenceList}>{referenceLoading ? <div className={styles.referenceLoading}>加载中</div> : referenceAssets.filter((asset) => asset.source === referenceTab).map((asset) => { const selection = referenceSelections.find((item) => item.id === asset.id && item.source === asset.source); return <div key={`${asset.source}:${asset.id}`} className={styles.referenceRow}><button type="button" className={styles.referencePick} data-selected={Boolean(selection)} onClick={() => toggleReference(asset)}><img src={asset.url} alt="" /><span title={asset.originalName}>{asset.originalName}</span>{selection ? <Check size={14} /> : null}</button>{selection ? <Select size="small" value={selection.purpose} options={PURPOSE_OPTIONS} onChange={(value) => updateReferencePurpose(asset, value)} /> : null}{asset.source === "TEMPORARY" ? <div className={styles.referenceRowActions}><button type="button" onClick={() => void promoteReference(asset)} title="存入项目">存</button><button type="button" onClick={() => void removeReference(asset)} aria-label="删除临时素材"><X size={14} /></button></div> : null}</div>; })}</div>
            <div className={styles.referencePopoverActions}><input ref={referenceFileRef} type="file" accept="image/*" multiple hidden onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; void uploadReferenceFiles(files); }} />{referenceUploading ? <Button size="small" danger icon={<X size={13} />} onClick={() => { uploadCancelledRef.current = true; uploadControllerRef.current?.abort(); }}>取消上传</Button> : <Button size="small" icon={<Upload size={13} />} onClick={() => referenceFileRef.current?.click()}>上传图片</Button>}<Button size="small" type="primary" onClick={() => setReferencePickerOpen(false)}>完成</Button></div>
          </div>}><span className={styles.referencePopoverAnchor} aria-hidden="true" /></Popover>
        </div>
        {session ? <div className={styles.editMemory}><div className={styles.editMemoryHeading}><p>当前分支记忆</p><small>{memorySourceOutputId && memorySourceOutputId !== output?.id ? `继承自 ${versionLabel(outputs.find((item) => item.id === memorySourceOutputId) ?? output)}` : memorySourceOutputId ? "本节点记忆" : "未设置"}</small></div><Input.TextArea value={memorySummary} onChange={(event) => setMemorySummary(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="例如：保持晨光方向和木质台面" /><Input.TextArea value={memoryConstraints} onChange={(event) => setMemoryConstraints(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="每行一条约束，例如：不要改变叶片形状" /><Button size="small" onClick={() => void saveMemory()}>保存记忆</Button></div> : null}
        <Input.TextArea value={message} onChange={(event) => setMessage(event.target.value)} autoSize={{ minRows: 4, maxRows: 8 }} placeholder="例如：把选中的菠萝颜色调得更金黄，保留叶片和背景光线" disabled={pending} />
        {turn?.plan?.userSummary ? <div className={styles.editPlan}><p>{turn.plan.userSummary}</p><span>{editOperationLabel(turn.plan.operation)}</span>{turn.plan.executionMode ? <small>执行方式：{editExecutionModeLabel(turn.plan.executionMode)}</small> : null}{turn.plan.targetDescription ? <small>目标：{turn.plan.targetDescription}{typeof turn.plan.targetConfidence === "number" ? ` · 置信度 ${Math.round(turn.plan.targetConfidence * 100)}%` : ""}</small> : null}{turn.plan.operation === "SCENE_ADJUST" || turn.plan.operation === "NATURAL_FUSION" ? <small>影响范围：{turn.plan.operation === "SCENE_ADJUST" ? "整张场景，主体尽量保持" : "选中区域及其边缘，保护标记优先"}</small> : null}{turn.plan.operation === "OUTPAINT" ? <small>影响范围：新增画布区域，原图区域锁定</small> : null}</div> : null}
        {turn?.status === "NEED_INPUT" || turn?.status === "FAILED" ? <p className={styles.editError}>{editErrorLabel(turn.error?.message)}</p> : null}{turn?.status === "SUCCEEDED" ? <p className={styles.editSuccess}>新版本已生成，可关闭后继续在结果区编辑。</p> : null}
        <div className={styles.editCommands}>{turn?.status === "AWAITING_CONFIRMATION" || turn?.status === "PLAN_READY" ? <Button type="primary" onClick={() => void approve()}>确认修改</Button> : <Button type="primary" icon={<Send size={15} />} disabled={!message.trim() || pending} loading={pending} onClick={() => void submit()}>生成计划</Button>}</div>
      </aside>
    </div> : null}
  </Modal>;
}

function drawArrow(context: CanvasRenderingContext2D, from: Point, to: Point, color: string, width: number): void {
  context.save(); context.strokeStyle = color; context.fillStyle = color; context.lineWidth = Math.max(3, width / 450); context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke(); const angle = Math.atan2(to.y - from.y, to.x - from.x); const head = Math.max(12, width / 40); context.beginPath(); context.moveTo(to.x, to.y); context.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6)); context.moveTo(to.x, to.y); context.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6)); context.stroke(); context.restore();
}
