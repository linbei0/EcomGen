import { App, Button, Image, InputNumber, Modal, Select } from "antd";
import { ChevronLeft, ChevronRight, Download, Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";

import type { Output, ProjectDetail, StoryboardItem } from "../../api/adapters/projectDetail";
import { useProviders } from "../../api/hooks/useProviders";
import { useStoryboard } from "../../api/hooks/useStoryboard";
import { useTemplateNames } from "../../api/hooks/useTemplates";
import { ModeBadge } from "../../components/ModeBadge";
import { downloadOriginal, outputFileName } from "../../lib/downloadImage";
import { errorText } from "../../lib/errorText";
import { outputPreviewUrl } from "../../lib/assetUrl";
import { itemDisplayName } from "../../lib/itemName";
import { groupOutputsByGenerationBatch } from "../../lib/review";
import { formatDateTime } from "../../lib/format";
import styles from "./workbench.module.css";
import type { GenerationJobInput } from "../../api/serializeGenerationBody";
import { RESOLUTION_LABEL } from "../../lib/roles";
import { ASPECT_SELECT_OPTIONS, renderAspectOption } from "./aspectOptions";
import { modelOptions } from "../../lib/modelOptions";
import { EditImageWorkspace } from "./EditImageWorkspace";

/** 在看图序列里前后移动一格；首尾相接，序列不足两张或当前不在序列里时保持原地。 */
function stepThrough(sequence: readonly string[], currentId: string | null, delta: number): string | null {
  const index = currentId ? sequence.indexOf(currentId) : -1;
  if (index < 0 || sequence.length < 2) return currentId;
  return sequence[(index + delta + sequence.length) % sequence.length] ?? currentId;
}

/** 预览层图片的半宽，由 usePreviewNavOffset 写入；样式靠它把 antd 的翻页按钮贴到图片两侧。 */
const PREVIEW_IMAGE_HALF = "--ecomgen-preview-image-half";

/**
 * antd 预览的翻页按钮固定在视口两缘（各 8px），窄图两侧会空出几百像素。
 * 预览打开后量图片的布局宽度（offsetWidth 不含 transform，缩放时按钮不会跟着跑到视口外），
 * 写进 CSS 变量收拢按钮；量不到时保持未设置，样式按视口比例估算。
 */
function usePreviewNavOffset(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    let observer: ResizeObserver | undefined;
    let cancelled = false;
    const measure = () => {
      const image = document.querySelector<HTMLImageElement>(".ant-image-preview-img");
      const root = document.querySelector<HTMLElement>(".ant-image-preview");
      if (!image || !root || image.offsetWidth === 0) return;
      root.style.setProperty(PREVIEW_IMAGE_HALF, `${image.offsetWidth / 2}px`);
    };
    // 预览层是独立 portal：打开当帧还没排版，等两帧再量。切换图片与图片解码完成都会改变布局宽度。
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cancelled) return;
      measure();
      const image = document.querySelector<HTMLImageElement>(".ant-image-preview-img");
      if (!image || typeof ResizeObserver === "undefined") return;
      observer = new ResizeObserver(measure);
      observer.observe(image);
    }));
    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);
}

/** 左右方向键翻图；输入控件里不拦截，避免抢走 Select 与输入框的按键。 */
function useArrowNavigation(enabled: boolean, onPrev: () => void, onNext: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onPrev, onNext]);
}

export function ReviewStage({
  detail,
  selectedOutputIds,
  onSelectionChange,
  onRetryItem,
}: {
  detail: ProjectDetail;
  selectedOutputIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onRetryItem: (itemId: string, generationConfig: NonNullable<GenerationJobInput["generationConfig"]>, generationBatchId?: string) => void;
}) {
  const { notification } = App.useApp();
  const board = useStoryboard(detail.id);
  const templateNames = useTemplateNames();
  const items = board.data?.items ?? detail.items;
  const originalOutputs = useMemo(() => detail.outputs.filter((output) => !output.editSessionId), [detail.outputs]);
  const editedOutputs = useMemo(() => detail.outputs.filter((output) => Boolean(output.editSessionId)), [detail.outputs]);
  const batches = useMemo(() => groupOutputsByGenerationBatch(items, originalOutputs, detail.jobs), [originalOutputs, items, detail.jobs]);
  const editedByRoot = useMemo(() => {
    const grouped = new Map<string, Output[]>();
    for (const output of editedOutputs) {
      const rootId = output.rootOutputId ?? output.parentOutputId;
      if (!rootId) continue;
      const bucket = grouped.get(rootId) ?? [];
      bucket.push(output);
      grouped.set(rootId, bucket.sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
    }
    return grouped;
  }, [editedOutputs]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [versionRootId, setVersionRootId] = useState<string | null>(null);
  // 超过 4 张的分镜默认折叠，展开状态按"批次:分镜"记录，避免跨批次串扰
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());

  const toggleExpanded = (key: string) => {
    setExpandedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSelection = (outputId: string) => {
    onSelectionChange(selectedOutputIds.includes(outputId)
      ? selectedOutputIds.filter((id) => id !== outputId)
      : [...selectedOutputIds, outputId]);
  };

  const download = async (output: Output, label: string) => {
    setDownloadingId(output.id);
    try {
      await downloadOriginal(outputPreviewUrl(output), outputFileName(output, label));
    } catch (error: unknown) {
      notification.error({ title: "下载原图失败", description: errorText(error) });
    } finally {
      setDownloadingId(null);
    }
  };

  const lightbox = detail.outputs.find((output) => output.id === lightboxId);
  const lightboxItem = items.find((item) => item.id === lightbox?.storyboardItemId);

  // 灯箱的切换序列与结果页展示顺序一致（批次 → 分镜 → 成图），并且包含被折叠隐藏的成图：
  // 翻到尽头才发现漏图，比翻出一张当前折叠的图更糟。
  const outputSequence = useMemo(
    () => batches.flatMap((batch) => batch.groups.flatMap((group) => group.outputs.map((output) => output.id))),
    [batches],
  );
  const stepLightbox = useCallback((delta: number) => setLightboxId((current) => stepThrough(outputSequence, current, delta)), [outputSequence]);
  const positionOf = (outputId: string | null) => {
    const index = outputId ? outputSequence.indexOf(outputId) : -1;
    return index >= 0 && outputSequence.length > 1 ? { index: index + 1, total: outputSequence.length } : undefined;
  };

  usePreviewNavOffset(previewOpen);

  if (detail.outputs.length === 0) {
    return (
      <div className={styles.placeholder}>
        <h2>还没有成图</h2>
        <p>确认分镜并生成后再查看结果。</p>
      </div>
    );
  }

  return (
    <div className={styles.lightboxStage}>
      {/* 整页成图登记进同一个预览序列：点任意一张即可用 antd 预览层左右翻完全部成图 */}
      <Image.PreviewGroup preview={{ onOpenChange: setPreviewOpen }}>
        {batches.map((batch) => (
          <section key={batch.id} className={styles.generationBatch}>
            <aside className={styles.generationBatchMeta}>
              <strong>{formatDateTime(batch.createdAt)}</strong>
              <span>{batch.groups.reduce((count, group) => count + group.outputs.length, 0)} 张{batch.retryCount ? ` · 重新生成 ${batch.retryCount} 张` : ""}</span>
              <i className={styles.timelineDot} aria-hidden="true" />
            </aside>
            <div className={styles.generationBatchBody}>
              {batch.groups.map((group) => {
                const label = itemDisplayName(group.item, templateNames);
                const groupKey = `${batch.id}:${group.item.id}`;
                const expanded = expandedGroups.has(groupKey);
                // 折叠时优先展示最新 4 张（重试图生成时间靠后、最值得关注），按时间正序排列
                const visibleOutputs = expanded ? group.outputs : group.outputs.slice(-4);
                const overflowCount = group.outputs.length - visibleOutputs.length;
                return (
                  <div key={group.item.id} className={styles.reviewGroup}>
                    <h2 className={styles.reviewGroupTitle}>
                      {label}
                      <span>{group.outputs.length} 张</span>
                      {expanded ? (
                        <button type="button" className={styles.reviewCollapse} onClick={() => toggleExpanded(groupKey)}>收起</button>
                      ) : null}
                    </h2>
                    <div className={styles.reviewGrid}>
                      {visibleOutputs.map((output, index) => {
                        return (
                          <ReviewCard
                            key={output.id}
                            output={output}
                            label={label}
                            downloading={downloadingId === output.id}
                            onDownload={() => void download(output, label)}
                            onOpen={() => setLightboxId(output.id)}
                            editedOutputs={editedByRoot.get(output.id) ?? []}
                            onOpenVersions={() => setVersionRootId(output.id)}
                            selected={selectedOutputIds.includes(output.id)}
                            onToggleSelection={() => toggleSelection(output.id)}
                            overflowCount={index === visibleOutputs.length - 1 ? overflowCount : 0}
                            onExpand={() => toggleExpanded(groupKey)}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </Image.PreviewGroup>

      <VersionTreeModal
        root={versionRootId ? detail.outputs.find((output) => output.id === versionRootId) : undefined}
        outputs={versionRootId ? [detail.outputs.find((output) => output.id === versionRootId), ...(editedByRoot.get(versionRootId) ?? [])].filter((output): output is Output => Boolean(output)) : []}
        onClose={() => setVersionRootId(null)}
        onOpenOutput={setEditingId}
        selectedOutputIds={selectedOutputIds}
        onToggleSelection={toggleSelection}
        onDownload={(output, label) => void download(output, label)}
      />

      <LightboxModal
        output={lightbox}
        item={lightboxItem}
        label={lightboxItem ? itemDisplayName(lightboxItem, templateNames) : ""}
        position={positionOf(lightboxId)}
        onPrev={() => stepLightbox(-1)}
        onNext={() => stepLightbox(1)}
        onClose={() => setLightboxId(null)}
        downloading={lightbox ? downloadingId === lightbox.id : false}
        onDownload={() => {
          if (lightbox) void download(lightbox, lightboxItem ? itemDisplayName(lightboxItem, templateNames) : "");
        }}
        onRetry={(generationConfig) => {
          if (lightboxItem) onRetryItem(lightboxItem.id, generationConfig, lightbox?.generationBatchId ?? undefined);
        }}
        onEdit={() => { if (lightbox) setEditingId(lightbox.id); }}
      />
      <EditImageWorkspace projectId={detail.id} project={detail} output={detail.outputs.find((output) => output.id === editingId)} outputs={detail.outputs} assets={detail.assets} onSelectOutput={setEditingId} onClose={() => setEditingId(null)} />
    </div>
  );
}

function ReviewCard({
  output,
  label,
  downloading,
  onDownload,
  onOpen,
  editedOutputs = [],
  onOpenVersions,
  selected,
  onToggleSelection,
  overflowCount = 0,
  onExpand,
}: {
  output: Output;
  label: string;
  downloading: boolean;
  onDownload: () => void;
  /** 悬停操作条的灯箱入口：带 Prompt、重试与编辑；点图本身走 antd 预览看图 */
  onOpen: () => void;
  editedOutputs?: Output[];
  onOpenVersions?: () => void;
  selected: boolean;
  onToggleSelection: () => void;
  /** 折叠时最后一张图上叠加的隐藏数量；为 0 时不渲染遮罩 */
  overflowCount?: number;
  onExpand?: () => void;
}) {
  return (
    <article className={styles.reviewCard} title={label}>
      <div className={styles.reviewThumb}>
        {/* 缩略图用 antd Image 是为了拿到它自带的预览层（点击看图 + 左右翻页）。
            +N 遮罩卡例外：它整面点击是展开，不进预览序列。 */}
        {overflowCount > 0 ? (
          <img src={output.url} alt={label} className={styles.outputImage} loading="lazy" decoding="async" />
        ) : (
          <Image
            rootClassName={styles.reviewImage}
            className={styles.outputImage}
            src={output.url}
            alt={label}
            loading="lazy"
            decoding="async"
            preview={{ cover: false }}
          />
        )}
        {/* +N 遮罩卡的唯一交互是展开：不渲染选择框和操作条，避免透过半透明遮罩露出来 */}
        {overflowCount > 0 ? null : (
          <label className={styles.outputSelect}>
            <input type="checkbox" checked={selected} onChange={onToggleSelection} aria-label={`选择下载 ${label}`} />
          </label>
        )}
        {editedOutputs.length > 0 ? <button type="button" className={styles.editVersionPeek} onClick={onOpenVersions} aria-label={`查看 ${editedOutputs.length} 个编辑版本`}><span className={styles.editVersionPeekImages}>{editedOutputs.slice(-3).map((version) => <img key={version.id} src={version.url} alt="" />)}</span><span>编辑 {editedOutputs.length} 版</span></button> : null}
        {output.generationSnapshot?.revision === "retry" ? <span className={styles.retryMark}>重新生成 · {formatDateTime(output.createdAt)}</span> : null}
        {overflowCount > 0 ? (
          <button type="button" className={styles.reviewOverflow} onClick={onExpand} aria-label={`展开其余 ${overflowCount} 张`}>
            +{overflowCount}
          </button>
        ) : null}
        {overflowCount > 0 ? null : (
          <div className={styles.reviewActions}>
            <button type="button" onClick={onDownload} disabled={downloading} aria-label="下载原图">
              <Download size={16} strokeWidth={1.75} />
              下载
            </button>
            <button type="button" onClick={onOpen} aria-label="灯箱">
              <Maximize2 size={16} strokeWidth={1.75} />
              灯箱
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function LightboxModal({
  output,
  item,
  label,
  position,
  onClose,
  onPrev,
  onNext,
  downloading,
  onDownload,
  onRetry,
  onEdit,
}: {
  output: Output | undefined;
  item: StoryboardItem | undefined;
  label: string;
  /** 当前图在灯箱序列中的位置；序列只有一张时为 undefined，此时不渲染翻页 */
  position: { index: number; total: number } | undefined;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  downloading: boolean;
  onDownload: () => void;
  onRetry: (generationConfig: NonNullable<GenerationJobInput["generationConfig"]>) => void;
  onEdit: () => void;
}) {
  const providers = useProviders();
  const [retryOpen, setRetryOpen] = useState(false);
  const [resolution, setResolution] = useState<NonNullable<GenerationJobInput["generationConfig"]>["imageResolution"]>(item?.imageResolution ?? "1K");
  const [aspectRatio, setAspectRatio] = useState<NonNullable<GenerationJobInput["generationConfig"]>["imageAspectRatio"]>(item?.imageAspectRatio ?? "AUTO");
  const [candidateCount, setCandidateCount] = useState(item?.candidateCount ?? 1);
  const [modelKey, setModelKey] = useState(item?.imageProviderId && item.imageModelId ? `${item.imageProviderId}::${item.imageModelId}` : undefined);
  const imageOptions = modelOptions(providers.data?.items ?? [], "image");
  const defaultModelKey = item?.imageProviderId && item.imageModelId ? `${item.imageProviderId}::${item.imageModelId}` : undefined;
  const positionLabel = position ? `${position.index} / ${position.total}` : undefined;
  // 重试配置弹层压在上面时不抢方向键
  useArrowNavigation(Boolean(output && position && !retryOpen), onPrev, onNext);

  // 历史分镜可能仍引用已删除的 Provider；Select 找不到对应 option 时会直接显示原始 UUID。
  // Provider 列表加载完成后自动切换到第一个可用生图模型，避免提交失效引用。
  useEffect(() => {
    if (!retryOpen || imageOptions.length === 0) return;
    setModelKey((current) => current && imageOptions.some((option) => option.value === current) ? current : imageOptions[0]!.value);
  }, [retryOpen, imageOptions]);

  const openRetry = () => {
    setResolution(item?.imageResolution ?? "1K");
    setAspectRatio(item?.imageAspectRatio ?? "AUTO");
    setCandidateCount(item?.candidateCount ?? 1);
    setModelKey(defaultModelKey && imageOptions.some((option) => option.value === defaultModelKey) ? defaultModelKey : imageOptions[0]?.value);
    setRetryOpen(true);
  };
  const submitRetry = () => {
    if (!modelKey) return;
    const [providerId, modelId] = modelKey.split("::");
    if (!providerId || !modelId) return;
    onRetry({ imageResolution: resolution, imageAspectRatio: aspectRatio, candidateCount, imageModel: { providerId, modelId } });
    setRetryOpen(false);
  };
  return (
    <>
      <Modal
        open={Boolean(output)}
        onCancel={onClose}
        footer={null}
        width={920}
        title={positionLabel ? <span className={styles.lightboxTitle}>灯箱<em>{positionLabel}</em></span> : "灯箱"}
      >
        {output && item ? (
          <div className={styles.lightboxBody}>
            <Image rootClassName={styles.lightboxImage} src={output.url} alt={label} />
            {position ? (
              <>
                <button type="button" className={`${styles.overlayNav} ${styles.lightboxNavPrev}`} onClick={onPrev} aria-label="上一张">
                  <ChevronLeft size={22} strokeWidth={1.75} aria-hidden />
                </button>
                <button type="button" className={`${styles.overlayNav} ${styles.lightboxNavNext}`} onClick={onNext} aria-label="下一张">
                  <ChevronRight size={22} strokeWidth={1.75} aria-hidden />
                </button>
              </>
            ) : null}
            <div className={styles.lightboxMeta}>
              <p className={styles.shotType}>{label}</p>
              <ModeBadge mode={item.mode} />
              <p className={styles.promptPreview}>{item.promptInstruction}</p>
              <Button
                icon={<Download size={14} strokeWidth={1.75} />}
                loading={downloading}
                onClick={onDownload}
              >
                下载原图
              </Button>
              <Button onClick={openRetry}>用此分镜重新生成</Button>
              <Button type="primary" onClick={onEdit}>编辑图片</Button>
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal open={retryOpen} title="重新生成配置" okText="开始生成" cancelText="取消" onOk={submitRetry} onCancel={() => setRetryOpen(false)} okButtonProps={{ disabled: !modelKey }}>
        <div className={styles.inspectorSettingGrid}>
          <label className={styles.fieldLabel}>图片比例<Select value={aspectRatio} options={ASPECT_SELECT_OPTIONS} optionRender={renderAspectOption} onChange={setAspectRatio} /></label>
          <label className={styles.fieldLabel}>分辨率<Select value={resolution} options={Object.entries(RESOLUTION_LABEL).map(([value, label]) => ({ value, label }))} onChange={setResolution} /></label>
          <label className={styles.fieldLabel}>候选数<InputNumber min={1} max={4} value={candidateCount} onChange={(value) => setCandidateCount(value ?? 1)} /></label>
          <label className={styles.fieldLabel}>生图模型<Select value={modelKey} options={imageOptions} placeholder="选择生图模型" onChange={setModelKey} /></label>
        </div>
      </Modal>
    </>
  );
}

function VersionTreeModal({ root, outputs, onClose, onOpenOutput, selectedOutputIds, onToggleSelection, onDownload }: { root: Output | undefined; outputs: Output[]; onClose: () => void; onOpenOutput: (outputId: string) => void; selectedOutputIds: string[]; onToggleSelection: (outputId: string) => void; onDownload: (output: Output, label: string) => void }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const nodes = useMemo(() => {
    const byId = new Map(outputs.map((output) => [output.id, output]));
    const children = new Map<string, Output[]>();
    for (const output of outputs) { if (!output.parentOutputId) continue; const bucket = children.get(output.parentOutputId) ?? []; bucket.push(output); children.set(output.parentOutputId, bucket); }
    const level = new Map<string, number>(root ? [[root.id, 0]] : []);
    const visit = (output: Output) => {
      for (const child of children.get(output.id) ?? []) {
        level.set(child.id, (level.get(output.id) ?? 0) + 1);
        visit(child);
      }
    };
    if (root) visit(root);
    const rows = new Map<number, Output[]>();
    for (const output of outputs) { const bucket = rows.get(level.get(output.id) ?? 0) ?? []; bucket.push(output); rows.set(level.get(output.id) ?? 0, bucket); }
    return [...rows.entries()].flatMap(([depth, row]) => row.map((output, index) => {
      const parent = output.parentOutputId ? byId.get(output.parentOutputId) : undefined;
      const siblings = parent ? (children.get(parent.id) ?? []) : [];
      return {
        output,
        depth,
        index,
        x: 72 + index * 250,
        y: 72 + depth * 190,
        parent,
        siblingCount: siblings.length,
        siblingOrdinal: siblings.findIndex((candidate) => candidate.id === output.id) + 1,
      };
    }));
  }, [outputs, root]);
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.output.id, node])), [nodes]);
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }; };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => { if (!dragRef.current) return; setOffset({ x: dragRef.current.ox + event.clientX - dragRef.current.x, y: dragRef.current.oy + event.clientY - dragRef.current.y }); };
  const pointerUp = () => { dragRef.current = null; };
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const next = Math.min(1.5, Math.max(0.65, zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
    if (next === zoom) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    setZoom(next);
    setOffset({
      x: pointerX - ((pointerX - offset.x) * next) / zoom,
      y: pointerY - ((pointerY - offset.y) * next) / zoom,
    });
  };
  return <Modal open={Boolean(root)} onCancel={onClose} footer={null} width="min(1100px, calc(100vw - 32px))" title="编辑版本关系">
    <div className={styles.versionTreeHeader}><div><strong>{root ? "这张图的编辑版本" : ""}</strong><span>点击图片进入编辑，拖动画布查看关系，滚轮缩放</span></div><div><button type="button" onClick={() => setZoom((value) => Math.max(0.65, value - 0.1))} aria-label="缩小"><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))} aria-label="放大"><Plus size={16} /></button></div></div>
    <div className={styles.versionTreeCanvas}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onWheel={handleWheel}
    >
      <div className={styles.versionTreeWorld} style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}>
        <svg className={styles.versionTreeLinks} width="1000" height="650" aria-hidden>{nodes.filter((node) => node.parent).map((node) => { const parent = node.parent ? nodesById.get(node.parent.id) : undefined; return parent ? <path key={node.output.id} d={`M ${parent.x + 96} ${parent.y + 126} C ${parent.x + 96} ${parent.y + 155}, ${node.x + 96} ${node.y - 25}, ${node.x + 96} ${node.y}`} /> : null; })}</svg>
        {nodes.map((node) => { const label = node.depth === 0 ? "原图" : `V${node.depth + 1}${node.siblingCount > 1 ? ` · ${node.siblingOrdinal}` : ""}`; return <div key={node.output.id} className={styles.versionTreeNode} style={{ left: node.x, top: node.y }} onPointerDown={(event) => event.stopPropagation()}><button type="button" className={styles.versionTreeOpen} onClick={() => onOpenOutput(node.output.id)}><img src={node.output.url} alt="" /><span>{label}</span></button><label className={styles.versionTreeSelect}><input type="checkbox" checked={selectedOutputIds.includes(node.output.id)} onChange={() => onToggleSelection(node.output.id)} aria-label={`选择下载 ${label}`} /></label><button type="button" className={styles.versionTreeDownload} onClick={() => onDownload(node.output, label)} aria-label={`下载 ${label}`}><Download size={14} /></button></div>; })}
      </div>
    </div>
  </Modal>;
}
