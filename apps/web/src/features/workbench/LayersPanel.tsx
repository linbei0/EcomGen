import { ArrowLeft, Download, Layers3, RefreshCw, Sparkles, X } from "lucide-react";
import { Button, Image, Input, Select, Tooltip } from "antd";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { API_BASE_URL } from "../../config/env";
import { errorText } from "../../lib/errorText";
import type { SegmentationModelOption } from "../../lib/modelOptions";
import { LayerStackDialog } from "./LayerStackDialog";
import styles from "./workbench.module.css";

export interface LayerBbox { x: number; y: number; width: number; height: number; }
export interface LayerManualElement { id: string; name: string; bbox: LayerBbox; }
/** 用户输入提示词拆出的元素：只有语义名称，无画框，不需要视觉识别。 */
export interface LayerPromptElement { id: string; name: string; }

type LayerTaskStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
interface LayerPlanView { id: string; status: LayerTaskStatus; outputHash: string; elements: Array<{ id: string; name: string; source: "auto" | "manual"; bbox: LayerBbox | null }>; error: { message?: string } | null; }
export interface LayerExportView { id: string; status: LayerTaskStatus; includeBackground: boolean; psdDownloadUrl: string | null; layerFiles: Array<{ name: string; kind: "element" | "background" | "composite"; downloadUrl: string }> | null; error: { message?: string } | null; createdAt: string; }

interface LayersPanelProps { outputId: string; outputUrl: string | undefined; manualElements: LayerManualElement[]; boxError: string | null; maxElements: number; segmentationKey: string; segmentationOptions: SegmentationModelOption[]; onSegmentationKeyChange: (value: string) => void; onRenameManual: (id: string, name: string) => void; onRemoveManual: (id: string) => void; onHover: (bbox: LayerBbox | null) => void; onExit: () => void; }

const POLL_INTERVAL_MS = 1500;

function apiErrorMessage(raw: string): string {
  try { const parsed = JSON.parse(raw) as { error?: { message?: string } }; return parsed.error?.message ?? raw; } catch { return raw; }
}

/** 手动元素的 24px 缩略图：用 background-size/position 在小方块内按归一化 bbox 裁切原图。 */
function cropStyle(bbox: LayerBbox): CSSProperties {
  const safeWidth = Math.min(bbox.width, 0.999);
  const safeHeight = Math.min(bbox.height, 0.999);
  return {
    backgroundSize: `${100 / safeWidth}% ${100 / safeHeight}%`,
    backgroundPosition: `${(bbox.x / (1 - safeWidth)) * 100}% ${(bbox.y / (1 - safeHeight)) * 100}%`,
  };
}

/** 历史导出下拉里的紧凑时间戳：本机时区的 MM-DD HH:mm。 */
function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** AI 分层导出面板：选择分割模型 → 手动识别 → 勾选元素 → 生成图层文件 → 预览与下载。 */
export function LayersPanel({ outputId, outputUrl, manualElements, boxError, maxElements, segmentationKey, segmentationOptions, onSegmentationKeyChange, onRenameManual, onRemoveManual, onHover, onExit }: LayersPanelProps) {
  const [plan, setPlan] = useState<LayerPlanView | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [exportRecord, setExportRecord] = useState<LayerExportView | null>(null);
  // 历史导出全集（新→旧）：重新分层/重新导出后，旧结果仍可通过下拉切回预览与下载
  const [history, setHistory] = useState<LayerExportView[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [includeBackground, setIncludeBackground] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stackOpen, setStackOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [promptElements, setPromptElements] = useState<LayerPromptElement[]>([]);
  const generationRef = useRef(0);
  // 已同步过勾选状态的元素 id 全集：勾选同步 effect 用它区分新增/消失元素
  const elementIdsRef = useRef<Set<string>>(new Set());

  const resolveUrl = useCallback((url: string) => (/^https?:\/\//.test(url) ? url : `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`), []);
  // outputUrl 已是可直接访问的地址（adapter 层已拼好 /api/v1 前缀），再过 resolveUrl 会重复前缀导致 404
  const thumbUrl = outputUrl ?? "";

  const refreshHistory = useCallback(async () => {
    // 以调用时刻的代为准：切换成图后旧请求作废；同一输出内重复刷新幂等，最后返回者胜
    const generation = generationRef.current;
    try {
      const response = await fetch(`${API_BASE_URL}/outputs/${outputId}/layer-exports/history`);
      if (!response.ok) return;
      const value = await response.json() as { exports: LayerExportView[] };
      if (generationRef.current !== generation) return;
      setHistory(value.exports);
    } catch { /* 历史列表加载失败不阻塞主流程，下个关键节点会重试 */ }
  }, [outputId]);

  const startRecognition = useCallback(async (generation: number, regenerate: boolean) => {
    setPlanLoading(true); setError(null);
    try {
      // regenerate 必须带新的 regenerationKey，否则 API 会复用已成功的旧方案，用户点“重新识别”却不重跑
      const body = regenerate ? JSON.stringify({ regenerationKey: crypto.randomUUID() }) : "{}";
      const response = await fetch(`${API_BASE_URL}/outputs/${outputId}/layer-plan`, { method: "POST", headers: { "content-type": "application/json" }, body });
      if (!response.ok) throw new Error(await response.text());
      const value = await response.json() as LayerPlanView;
      if (generationRef.current !== generation) return;
      setPlan(value);
    } catch (cause) { if (generationRef.current === generation) setError(errorText(cause)); } finally { if (generationRef.current === generation) setPlanLoading(false); }
    // 重新识别是用户感知的「重新分层」时刻：此刻刷新历史，加载失败的旧会话也能自愈
    void refreshHistory();
  }, [outputId, refreshHistory]);

  useEffect(() => {
    // 切换成图后重置面板并加载最新方案与最近一次导出：导出/下载入口在关闭分层再打开后仍能恢复
    generationRef.current += 1;
    const generation = generationRef.current;
    setPlan(null); setPlanLoading(false); setExportRecord(null); setHistory([]); setSelectedIds(new Set()); elementIdsRef.current = new Set(); setError(null); setPromptElements([]); setPromptDraft("");
    let cancelled = false;
    void (async () => {
      try {
        const [planResponse, exportResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/outputs/${outputId}/layer-plan`),
          fetch(`${API_BASE_URL}/outputs/${outputId}/layer-exports`),
        ]);
        if (cancelled || generationRef.current !== generation) return;
        if (planResponse.ok) {
          const value = await planResponse.json() as LayerPlanView;
          if (generationRef.current !== generation) return;
          setPlan(value);
        } else if (planResponse.status !== 404) {
          throw new Error(await planResponse.text());
        }
        if (exportResponse.ok) {
          const value = await exportResponse.json() as LayerExportView;
          if (generationRef.current !== generation) return;
          setExportRecord(value);
          setIncludeBackground(value.includeBackground);
        }
      } catch (cause) { if (!cancelled && generationRef.current === generation) setError(errorText(cause)); }
    })();
    // 历史导出单独容错加载：失败只影响回看入口，不阻塞最新方案与导出的展示
    void refreshHistory();
    return () => { cancelled = true; };
  }, [outputId, outputUrl, resolveUrl, refreshHistory]);

  useEffect(() => {
    // 识别任务轮询：终态停止；新识别元素由勾选同步 effect 统一勾选。inFlight 防止上一轮未返回时并发发起
    if (!plan || (plan.status !== "QUEUED" && plan.status !== "RUNNING")) return;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void (async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/outputs/${outputId}/layer-plan`);
          if (!response.ok) return;
          const value = await response.json() as LayerPlanView;
          setPlan((current) => current?.id === value.id ? value : current);
        } catch { /* 轮询失败等待下一轮 */ } finally { inFlight = false; }
      })();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [plan?.id, plan?.status, outputId]);

  useEffect(() => {
    // 导出任务轮询：REST 为状态真相，SSE 事件只用于其它视图失效。按 id 过滤过期响应
    if (!exportRecord || (exportRecord.status !== "QUEUED" && exportRecord.status !== "RUNNING")) return;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void (async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/outputs/${outputId}/layer-exports`);
          if (!response.ok) return;
          const value = await response.json() as LayerExportView;
          setExportRecord((current) => current?.id === value.id ? value : current);
        } catch { /* 轮询失败等待下一轮 */ } finally { inFlight = false; }
      })();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [exportRecord?.id, exportRecord?.status, outputId]);

  useEffect(() => {
    // 导出成功后 Worker 会把实测包围盒回写识别方案，刷新后 chips 悬停高亮才与真实分割区域一致；
    // 同时刷新历史导出，新结果进入列表并成为「当前」
    if (exportRecord?.status !== "SUCCEEDED") return;
    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/outputs/${outputId}/layer-plan`);
        if (!response.ok) return;
        const value = await response.json() as LayerPlanView;
        setPlan((current) => current?.id === value.id ? value : current);
      } catch { /* 刷新失败不阻塞导出结果展示 */ }
    })();
    void refreshHistory();
  }, [exportRecord?.id, exportRecord?.status, outputId, refreshHistory]);

  useEffect(() => {
    // 识别到达终态也刷新历史：页面挂着跨过历史功能上线/接口抖动的会话，在识别结束时自愈
    if (!plan || (plan.status !== "SUCCEEDED" && plan.status !== "FAILED" && plan.status !== "CANCELLED")) return;
    void refreshHistory();
  }, [plan?.id, plan?.status, refreshHistory]);

  // 勾选状态与元素集合同步的唯一入口：新元素（识别/提示词/画框）默认勾选，
  // 被删除或因方案更新而失效的元素自动移出勾选，避免残留 id 参与计数、上限与提交。
  useEffect(() => {
    const currentIds = new Set(allElements.map((element) => element.id));
    const previous = elementIdsRef.current;
    const sameSize = previous.size === currentIds.size;
    if (sameSize && [...currentIds].every((id) => previous.has(id))) return;
    elementIdsRef.current = currentIds;
    setSelectedIds((current) => {
      const added = [...currentIds].filter((id) => !previous.has(id));
      const next = new Set([...current, ...added].filter((id) => currentIds.has(id)));
      return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next;
    });
  });

  // 识别元素（需成功方案）+ 提示词元素 + 手动画框元素；统一形状后勾选、hover 与提交共用一套逻辑
  const planSucceeded = plan?.status === "SUCCEEDED";
  const allElements: Array<{ id: string; name: string; source: "auto" | "manual" | "prompt"; bbox: LayerBbox | null }> = [
    ...(planSucceeded ? plan.elements : []),
    ...promptElements.map((element) => ({ ...element, source: "prompt" as const, bbox: null })),
    ...manualElements.map((element) => ({ ...element, source: "manual" as const, bbox: element.bbox })),
  ];
  const toggle = (id: string) => setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allSelected = allElements.length > 0 && allElements.every((element) => selectedIds.has(element.id));
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(allElements.map((element) => element.id)));
  // 勾选同步 effect 保证 selectedIds 只包含实际存在的元素：计数、上限与提交都基于这份交集
  const selectedElements = allElements.filter((element) => selectedIds.has(element.id));
  const selectedCount = selectedElements.length;
  const overLimit = selectedCount > maxElements;

  // 提示词按顿号/逗号/分号/换行拆成元素名称，加入后默认勾选，可直接生成分层；不静默丢弃用户输入
  const addPromptElements = () => {
    const names = promptDraft.split(/[,，、;；\n]+/).map((name) => name.trim()).filter((name) => name.length > 0);
    if (names.length === 0) return;
    const elements = names.map((name) => ({ id: `p-${crypto.randomUUID()}`, name }));
    setPromptElements((current) => [...current, ...elements]);
    setPromptDraft("");
  };
  const renamePrompt = (id: string, name: string) => setPromptElements((current) => current.map((element) => (element.id === id ? { ...element, name } : element)));
  const removePrompt = (id: string) => setPromptElements((current) => current.filter((element) => element.id !== id));

  const submitExport = async () => {
    if (selectedCount === 0 || overLimit) return;
    const elements = selectedElements.map((element) => {
      if (element.source === "manual" && element.bbox) return { id: element.id, name: element.name, source: "manual" as const, bbox: element.bbox };
      if (element.source === "prompt") return { id: element.id, name: element.name, source: "prompt" as const };
      return { id: element.id, name: element.name, source: "auto" as const };
    });
    setSubmitting(true); setError(null);
    try {
      // 带上 planId：勾选 auto 元素时绑定具体识别方案，方案更新后 API 会拒绝错配的旧引用
      const response = await fetch(`${API_BASE_URL}/outputs/${outputId}/layer-exports`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ elements, includeBackground, planId: planSucceeded ? plan.id : undefined }) });
      if (!response.ok) throw new Error(apiErrorMessage(await response.text()));
      const bundle = await response.json() as { layerExport: LayerExportView };
      setExportRecord(bundle.layerExport);
    } catch (cause) { setError(errorText(cause)); } finally { setSubmitting(false); }
  };

  const retryExport = () => { setExportRecord(null); setError(null); };
  const planFailed = plan?.status === "FAILED" || plan?.status === "CANCELLED";
  const exportFailed = exportRecord?.status === "FAILED" || exportRecord?.status === "CANCELLED";
  const exportDone = exportRecord?.status === "SUCCEEDED";
  const recognitionBusy = planLoading || plan?.status === "QUEUED" || plan?.status === "RUNNING";
  const exportBusy = Boolean(exportRecord && (exportRecord.status === "QUEUED" || exportRecord.status === "RUNNING"));
  // 只有产出过资产（图层文件或 PSD）的记录才值得回看；进行中/失败的记录由主流程状态展示
  const viewableHistory = history.filter((item) => (item.layerFiles?.length ?? 0) > 0 || item.psdDownloadUrl);

  return <>
    <div className={styles.editLayersHeader}>
      <Tooltip title="返回编辑"><button type="button" className={styles.editLayersBack} onClick={onExit} aria-label="返回编辑"><ArrowLeft size={15} /></button></Tooltip>
      <span className={styles.editLayersBadge}><Layers3 size={14} strokeWidth={1.75} /></span>
      <h2 className={styles.editLayersTitle}>AI 分层导出</h2>
    </div>
    <div className={styles.editLayersBody}>
      {recognitionBusy ? <div className={styles.editLayersSkeleton}>{[0, 1, 2, 3].map((index) => <span key={index} className={styles.editLayersSkeletonRow} />)}<p className={styles.editLayersStatus}>正在识别画面元素…</p></div> : null}
      {!recognitionBusy ? (
        <div className={styles.editLayersRecognize}>
          {/* 识别走项目的推理模型，分割模型只决定导出协议；选择器始终可见，识别成功或失败后都能切换模型 */}
          <Select
            aria-label="分割模型"
            value={segmentationOptions.some((item) => item.value === segmentationKey) ? segmentationKey : undefined}
            options={segmentationOptions}
            placeholder={segmentationOptions.length === 0 ? "先在设置中添加分割 API" : "选择分割模型"}
            onChange={onSegmentationKeyChange}
            popupMatchSelectWidth={false}
            style={{ width: "100%" }}
            labelRender={() => {
              // 面板只有 320px：选中值分两行展示（Provider 名 + 模型 ID），完整 label 悬停提示、下拉里保留
              const option = segmentationOptions.find((item) => item.value === segmentationKey);
              if (!option) return null;
              return <span className={styles.editLayersModelValue} title={option.label}><span className={styles.editLayersModelProvider}>{option.providerName}</span><span className={styles.editLayersModelId}>{option.modelId}</span></span>;
            }}
          />
          <Button type="primary" block icon={planSucceeded ? <RefreshCw size={13} /> : <Sparkles size={13} strokeWidth={1.75} />} onClick={() => void startRecognition(generationRef.current, planSucceeded || planFailed)}>{planSucceeded ? "重新识别" : "智能识别"}</Button>
        </div>
      ) : null}
      {/* 重新分层/重新导出后旧结果不丢：切到历史记录即复用下方结果视图的预览与 PSD 下载 */}
      {!recognitionBusy && !exportBusy && viewableHistory.length > 0 ? (
        <Select
          aria-label="历史导出"
          value={viewableHistory.some((item) => item.id === exportRecord?.id) ? exportRecord?.id : undefined}
          options={viewableHistory.map((item, index) => ({ value: item.id, label: `${stamp(item.createdAt)} · ${item.layerFiles?.filter((file) => file.kind !== "composite").length ?? 0} 层${index === 0 ? " · 当前" : ""}` }))}
          placeholder="查看历史导出"
          popupMatchSelectWidth={false}
          style={{ width: "100%" }}
          onChange={(id) => setExportRecord(viewableHistory.find((item) => item.id === id) ?? null)}
        />
      ) : null}
      {planFailed ? <p className={styles.editError}>{plan.error?.message ?? "图层识别失败"}</p> : null}
      {!recognitionBusy && !exportDone ? (
        <div className={styles.editLayersPrompt}>
          <Input.TextArea
            aria-label="分层提示词"
            value={promptDraft}
            onChange={(event) => setPromptDraft(event.target.value)}
            placeholder="添加元素，如：标题、手机、电池图标"
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={300}
          />
          <div className={styles.editLayersPromptAction}>
            <Button size="small" disabled={promptDraft.trim().length === 0} onClick={addPromptElements}>添加</Button>
          </div>
        </div>
      ) : null}
      {error ? <p className={styles.editError}>{error}</p> : null}
      {boxError ? <p className={styles.editError}>{boxError}</p> : null}
      {selectedCount > 0 && overLimit ? <p className={styles.editError}>{`已选 ${selectedCount} 个元素，超过当前分割模型上限（${maxElements} 个），请减少元素后再生成。`}</p> : null}
      {/* 元素列表常驻（结果视图除外）：识别元素、提示词元素与画框元素统一勾选，可随时改名、移除或直接导出 */}
      {!recognitionBusy && !planFailed && !exportDone && allElements.length === 0 ? <p className={styles.editLayersEmpty}>在画布拖拽画框添加元素</p> : null}
      {!exportDone && allElements.length > 0 ? <div className={styles.editLayersChips}>
        <p className={styles.editLayersMeta}>
          <span>{`已选 ${selectedCount}/${allElements.length}`}</span>
          <button type="button" className={styles.editLayersMetaAction} onClick={toggleAll}>{allSelected ? "全不选" : "全选"}</button>
        </p>
        {allElements.map((element) => {
          const manual = element.source === "manual";
          const editable = element.source !== "auto";
          const selected = selectedIds.has(element.id);
          return <div key={element.id} className={styles.editLayersChip} data-selectable="true" data-selected={selected} onMouseEnter={() => onHover(element.bbox)} onMouseLeave={() => onHover(null)}>
            <input type="checkbox" aria-label={`选择元素 ${element.name}`} checked={selected} onChange={() => toggle(element.id)} style={{ accentColor: "var(--accent)" }} />
            {manual && element.bbox ? <span className={styles.editLayersThumb} style={{ backgroundImage: `url("${thumbUrl}")`, ...cropStyle(element.bbox) }} /> : <span className={styles.editLayersDot}><Layers3 size={12} /></span>}
            {editable ? <input className={styles.editLayersChipName} value={element.name} aria-label="元素名称" onChange={(event) => (manual ? onRenameManual(element.id, event.target.value) : renamePrompt(element.id, event.target.value))} maxLength={60} /> : <span className={styles.editLayersChipName}>{element.name}</span>}
            {editable ? <button type="button" className={styles.editLayersChipRemove} onClick={() => { onHover(null); if (manual) onRemoveManual(element.id); else removePrompt(element.id); }} aria-label={`移除元素 ${element.name}`}><X size={13} /></button> : null}
          </div>;
        })}
      </div> : null}
      {exportBusy ? <p className={styles.editLayersStatus}>正在生成图层文件…</p> : null}
      {exportFailed && exportRecord ? <div className={styles.editLayersBlock}><p className={styles.editError}>{exportRecord.error?.message ?? "图层导出失败"}</p><Button icon={<RefreshCw size={13} />} onClick={retryExport}>重试</Button></div> : null}
      {exportDone && exportRecord ? <div className={styles.editLayersPreview}>
        {(exportRecord.layerFiles ?? []).filter((file) => file.kind !== "composite").map((file) => <figure key={file.downloadUrl} className={styles.editLayersPreviewItem}>
          <div className={styles.editLayersChecker}>
            <Image src={resolveUrl(file.downloadUrl)} alt={file.name} preview={{ mask: "查看" }} style={{ width: "100%" }} wrapperStyle={{ width: "100%" }} />
          </div>
          <figcaption className={styles.editLayersPreviewCaption}>
            <span className={styles.editLayersPreviewName} title={file.name}>{file.name.replace(/\.png$/i, "")}</span>
            <a className={styles.editLayersPreviewDownload} href={resolveUrl(file.downloadUrl)} download={file.name} aria-label={`下载 ${file.name}`}><Download size={13} /></a>
          </figcaption>
        </figure>)}
      </div> : null}
    </div>
    {/* 底栏只在实际有内容时渲染，避免空闲时残留一条空分隔线 */}
    {!exportBusy && (exportDone || planSucceeded || manualElements.length > 0 || promptElements.length > 0) ? <div className={styles.editLayersFoot}>
      {exportDone ? <>
        <Button block icon={<Layers3 size={14} />} onClick={() => setStackOpen(true)}>图层编排</Button>
        {exportRecord?.psdDownloadUrl ? <a className={styles.editLayersDownload} href={resolveUrl(exportRecord.psdDownloadUrl)} download={`layers-${outputId.slice(0, 8)}.psd`}><Button type="primary" block icon={<Download size={14} />}>下载 PSD</Button></a> : null}
        <Button block onClick={() => { setStackOpen(false); setExportRecord(null); setSelectedIds(new Set(allElements.map((element) => element.id))); }}>重新选择元素</Button>
      </> : <>
        <label className={styles.editLayersSwitch}><span>包含背景层</span><input type="checkbox" checked={includeBackground} onChange={(event) => setIncludeBackground(event.target.checked)} style={{ accentColor: "var(--accent)" }} /></label>
        <Button type="primary" block disabled={selectedCount === 0 || overLimit} loading={submitting} onClick={() => void submitExport()}>生成图层文件</Button>
      </>}
    </div> : null}
    {stackOpen && exportRecord ? <LayerStackDialog record={exportRecord} outputId={outputId} onClose={() => setStackOpen(false)} /> : null}
  </>;
}
