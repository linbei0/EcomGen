import { App, Button, Checkbox, Modal, Radio, Select, Tooltip } from "antd";
import { ChevronDown, ChevronUp, Download, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { exportDownloadUrl, type Output, type ProjectDetail } from "../../api/adapters/projectDetail";
import { useCreateExportJob, useExport } from "../../api/hooks/useExport";
import { useCreateGenerationJobs } from "../../api/hooks/useGeneration";
import { useCancelJob, useRetryJob } from "../../api/hooks/useJobs";
import { outputPreviewUrl, outputThumbnailUrl } from "../../lib/assetUrl";
import { errorText } from "../../lib/errorText";
import { JOB_STATUS_LABEL } from "../../lib/factClaims";
import { activeGenerateJobs } from "../../lib/generateSelection";
import { jobErrorText } from "../../lib/jobError";
import { itemDisplayName } from "../../lib/itemName";
import { useTemplateNames } from "../../api/hooks/useTemplates";
import { ReviewStage } from "./ReviewStage";
import styles from "./workbench.module.css";

/** 长图宽度档位：值即 LongImageExportConfig.targetWidth。 */
const LONG_IMAGE_WIDTH_OPTIONS = [
  { value: 750, label: "手机端详情页 · 750px" },
  { value: 790, label: "PC 端详情页 · 790px" },
  { value: 1200, label: "高清 · 1200px" },
];

export function ResultsWorkspace({
  detail,
}: {
  detail: ProjectDetail;
}) {
  const { notification } = App.useApp();
  const generate = useCreateGenerationJobs(detail.id);
  const retryJob = useRetryJob(detail.id);
  const cancelJob = useCancelJob(detail.id);
  const createExport = useCreateExportJob(detail.id);
  const [activeExportId, setActiveExportId] = useState<string | undefined>(undefined);
  const [selectedOutputIds, setSelectedOutputIds] = useState<string[]>([]);
  // 导出方式与长图选项在弹窗内选择，确认后随请求一次性提交
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"zip" | "longImage">("zip");
  const [longImageWidth, setLongImageWidth] = useState<750 | 790 | 1200>(750);
  const [longImageSlices, setLongImageSlices] = useState(false);
  // 拼接顺序状态：默认按分镜序，用户在导出弹窗调整后保留。
  const [stitchOrder, setStitchOrder] = useState<string[]>([]);
  // 拖拽排序用 pointer 事件自管：原生 DnD 做不了插入占位与容器边缘自动滚动。
  // 指针捕获挂在滚动容器上，被拖项 display:none 也不会丢失捕获。
  const screensRef = useRef<HTMLDivElement | null>(null);
  const screenRefs = useRef(new Map<string, HTMLElement>());
  const dragRef = useRef<{ id: string; fromIndex: number; pointerId: number; startY: number; started: boolean; edgeDelta: number; clientY: number } | null>(null);
  const autoscrollRef = useRef<number | null>(null);
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [dragHeight, setDragHeight] = useState(0);
  const liveExport = useExport(activeExportId);
  const templateNames = useTemplateNames();
  const active = activeGenerateJobs(detail.jobs);
  const failed = detail.jobs.filter((job) => job.type === "GENERATE" && job.status === "FAILED");
  const record = liveExport.data;
  const packing = createExport.isPending || record?.status === "QUEUED" || record?.status === "RUNNING";
  const readyUrl = record?.status === "SUCCEEDED" ? exportDownloadUrl(record) : null;
  // 默认拼接顺序与 Worker 回退规则一致：分镜顺序（items 即 sort_order）优先，再按候选序。
  const defaultStitchOrder = useMemo(() => {
    const itemRank = new Map(detail.items.map((item, index) => [item.id, index] as const));
    return detail.outputs
      .filter((output) => selectedOutputIds.includes(output.id))
      .slice()
      .sort((a, b) => (itemRank.get(a.storyboardItemId) ?? Number.MAX_SAFE_INTEGER) - (itemRank.get(b.storyboardItemId) ?? Number.MAX_SAFE_INTEGER) || (a.candidateIndex ?? 0) - (b.candidateIndex ?? 0))
      .map((output) => output.id);
  }, [detail.items, detail.outputs, selectedOutputIds]);
  const outputById = useMemo(() => new Map(detail.outputs.map((output) => [output.id, output] as const)), [detail.outputs]);
  const longImagePreviewOutputs = stitchOrder
    .map((id) => outputById.get(id))
    .filter((output): output is Output => Boolean(output));

  // 选择变化时保留用户已调整的顺序，新增/删除的屏按默认序增减。
  useEffect(() => {
    setStitchOrder((current) => {
      const selected = new Set(selectedOutputIds);
      const kept = current.filter((id) => selected.has(id));
      const keptSet = new Set(kept);
      const additions = defaultStitchOrder.filter((id) => selected.has(id) && !keptSet.has(id));
      return [...kept, ...additions];
    });
  }, [selectedOutputIds, defaultStitchOrder]);

  useEffect(() => {
    const available = new Set(detail.outputs.map((output) => output.id));
    setSelectedOutputIds((current) => current.filter((id) => available.has(id)));
  }, [detail.outputs]);

  useEffect(() => {
    if (record?.status === "FAILED") notification.error({ title: "打包失败，请重新下载" });
  }, [record?.status, notification]);

  const moveScreen = (from: number, to: number) => {
    setStitchOrder((current) => {
      if (to < 0 || to >= current.length) return current;
      const next = current.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  };

  const computeInsertIndex = (id: string, clientY: number) => {
    // 全程用视口坐标比较各屏中点：offsetTop 依赖 offsetParent（容器未定位时会混入弹窗到
    // 页面顶部的偏移，导致下移阈值虚高、不跟手），而 rect 随内容滚动移动，逐帧重算天然正确。
    // index 是完整列表里"该项之后"的槽位（渲染侧直接比对完整列表下标）；提交时再换算回
    // 去除被拖项的下标，两套坐标系不混用——混用会让下方所有落点显示偏高一格且到不了末尾。
    let index = 0;
    longImagePreviewOutputs.forEach((output, itemIndex) => {
      if (output.id === id) return;
      const element = screenRefs.current.get(output.id);
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) index = itemIndex + 1;
    });
    setInsertIndex(index);
  };

  // 指针停在边缘不动时也要持续滚动，所以用 rAF 循环驱动并在每帧重算插入位。
  const driveAutoscroll = () => {
    if (autoscrollRef.current != null) return;
    const step = () => {
      autoscrollRef.current = null;
      const drag = dragRef.current;
      const container = screensRef.current;
      if (!drag || !drag.started || drag.edgeDelta === 0 || !container) return;
      container.scrollTop += drag.edgeDelta;
      computeInsertIndex(drag.id, drag.clientY);
      autoscrollRef.current = requestAnimationFrame(step);
    };
    autoscrollRef.current = requestAnimationFrame(step);
  };

  const beginScreenDrag = (event: React.PointerEvent<HTMLElement>, index: number, id: string) => {
    if (event.button !== 0) return;
    dragRef.current = { id, fromIndex: index, pointerId: event.pointerId, startY: event.clientY, started: false, edgeDelta: 0, clientY: event.clientY };
    setDragHeight(event.currentTarget.offsetHeight);
  };

  const moveScreenDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.clientY = event.clientY;
    const container = screensRef.current;
    if (!container) return;
    if (!drag.started) {
      if (Math.abs(event.clientY - drag.startY) < 4) return;
      drag.started = true;
      setDragSourceId(drag.id);
      setInsertIndex(drag.fromIndex);
      // 捕获只在真正开始拖动后建立：pointerdown 就捕获会让箭头按钮收不到 click（pointerup 被重定向到容器）。
      try { container.setPointerCapture(drag.pointerId); } catch { /* 捕获失败时仍可用箭头按钮排序 */ }
    }
    computeInsertIndex(drag.id, event.clientY);
    // 贴近容器上下缘按距离加速滚动，解决长列表拖拽够不到远处目标的问题
    const rect = container.getBoundingClientRect();
    const edge = 44;
    if (event.clientY < rect.top + edge) drag.edgeDelta = -Math.min(16, (rect.top + edge - event.clientY) / 2.5);
    else if (event.clientY > rect.bottom - edge) drag.edgeDelta = Math.min(16, (event.clientY - (rect.bottom - edge)) / 2.5);
    else drag.edgeDelta = 0;
    if (drag.edgeDelta !== 0) driveAutoscroll();
  };

  const endScreenDrag = (commit: boolean) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (autoscrollRef.current != null) { cancelAnimationFrame(autoscrollRef.current); autoscrollRef.current = null; }
    if (drag?.started && commit && insertIndex != null && insertIndex !== drag.fromIndex) {
      // insertIndex 是完整列表槽位；moveScreen 的目标下标在去除被拖项后的数组上取值
      moveScreen(drag.fromIndex, insertIndex > drag.fromIndex ? insertIndex - 1 : insertIndex);
    }
    setDragSourceId(null);
    setInsertIndex(null);
  };

  useEffect(() => () => {
    if (autoscrollRef.current != null) cancelAnimationFrame(autoscrollRef.current);
  }, []);

  const download = async (ids: string[]) => {
    if (ids.length === 0) {
      notification.error({ title: "没有可下载的成图" });
      return;
    }
    try {
      const bundle = await createExport.mutateAsync({
        // 长图模式提交用户调整后的拼接顺序；顺序参与指纹，调整后再导出会生成新任务。
        outputIds: exportMode === "longImage" ? stitchOrder : ids,
        platformTargets: detail.platformTargets,
        ...(exportMode === "longImage"
          ? { longImage: { targetWidth: longImageWidth, ...(longImageSlices ? { sliceHeight: 960 } : {}) } }
          : {}),
      });
      if (bundle.export) setActiveExportId(bundle.export.id);
    } catch (error) {
      notification.error({ title: "导出失败", description: errorText(error) });
    }
  };

  return (
    <div className={styles.results}>
      {active.length > 0 ? (
        <aside className={styles.jobCard} aria-live="polite">
          <p className={styles.jobStatus}>{JOB_STATUS_LABEL[active[0]!.status]}</p>
          <h2>{active.length} 张正在出图</h2>
          <Button
            disabled={active[0]!.cancelRequested || cancelJob.isPending}
            onClick={() => void cancelJob.mutateAsync(active[0]!.id)}
          >
            {active[0]!.cancelRequested ? "取消中" : "取消"}
          </Button>
        </aside>
      ) : null}

      {failed.map((job) => {
        // GENERATE 任务与分镜一一对应，展示分镜名以区分是哪张图失败
        const item = detail.items.find((candidate) => candidate.id === job.storyboardItemId);
        const label = item ? itemDisplayName(item, templateNames) : null;
        return (
          <aside key={job.id} className={styles.jobCard} data-status="FAILED">
            <p className={styles.jobStatus}>{JOB_STATUS_LABEL.FAILED}</p>
            <h2>{label ? label : null}</h2>
            {jobErrorText(job) ? <p className={styles.jobError}>{jobErrorText(job)}</p> : null}
            <div className={styles.jobActions}>
              {job.retryable ? (
                <Button loading={retryJob.isPending} onClick={() => void retryJob.mutateAsync(job.id)}>
                  重试生成
                </Button>
              ) : null}
            </div>
            <Tooltip title="关闭失败提示">
              <Button
                className={styles.jobDismiss}
                type="text"
                size="small"
                icon={<X size={16} strokeWidth={1.75} />}
                loading={cancelJob.isPending}
                aria-label="关闭失败提示"
                onClick={() => void cancelJob.mutateAsync(job.id)}
              />
            </Tooltip>
          </aside>
        );
      })}

      <div className={styles.resultsToolbar}>
        <Button size="small" onClick={() => setSelectedOutputIds(detail.outputs.map((output) => output.id))} disabled={detail.outputs.length === 0}>全选图片</Button>
        <Button size="small" onClick={() => setSelectedOutputIds([])} disabled={selectedOutputIds.length === 0}>清空选择</Button>
        {packing ? <span className={styles.hint}>打包中…</span> : null}
        {readyUrl ? (
          <a className={styles.downloadLink} href={readyUrl}>
            打开 ZIP
          </a>
        ) : null}
        <Button
          type="primary"
          icon={<Download size={14} strokeWidth={1.75} />}
          loading={packing}
          disabled={selectedOutputIds.length === 0}
          onClick={() => setExportOpen(true)}
        >
          打包下载 {selectedOutputIds.length > 0 ? selectedOutputIds.length : ""}
        </Button>
      </div>

      <ReviewStage
        detail={detail}
        selectedOutputIds={selectedOutputIds}
        onSelectionChange={setSelectedOutputIds}
        onRetryItem={(itemId, generationConfig, generationBatchId) => {
          void generate.mutateAsync({ storyboardItemIds: [itemId], revision: "retry", generationBatchId, generationConfig }).catch((error: unknown) => {
            notification.error({ title: "重新生成失败", description: errorText(error) });
          });
        }}
      />

      <Modal
        title="打包下载"
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        onOk={() => {
          setExportOpen(false);
          void download(selectedOutputIds);
        }}
        okText="开始导出"
        cancelText="取消"
        okButtonProps={{ loading: packing }}
        width={680}
        destroyOnHidden
      >
        <div className={styles.exportDialog}>
          <div className={styles.exportDialogForm}>
            <Radio.Group
              value={exportMode}
              onChange={(event) => setExportMode(event.target.value as "zip" | "longImage")}
              className={styles.exportDialogModes}
            >
              <Radio value="zip">
                <span className={styles.exportModeTitle}>逐张打包</span>
                <span className={styles.exportModeDesc}>每张成图单独成文件（ZIP），适合平台逐图上传</span>
              </Radio>
              <Radio value="longImage">
                <span className={styles.exportModeTitle}>合成长图</span>
                <span className={styles.exportModeDesc}>按分镜顺序纵向拼接为一张详情页长图，随 ZIP 一并交付</span>
              </Radio>
            </Radio.Group>
            {exportMode === "longImage" ? (
              <div className={styles.exportDialogFields}>
                <div className={styles.exportDialogField}>
                  <span className={styles.exportDialogLabel}>图片宽度</span>
                  <Select
                    value={longImageWidth}
                    onChange={(value) => setLongImageWidth(value as 750 | 790 | 1200)}
                    options={LONG_IMAGE_WIDTH_OPTIONS}
                  />
                </div>
                <Checkbox
                  checked={longImageSlices}
                  onChange={(event) => setLongImageSlices(event.target.checked)}
                >
                  同时导出切片（按屏边界切，不裁穿画面）
                </Checkbox>
              </div>
            ) : null}
            <p className={styles.exportDialogHint}>
              已选 {selectedOutputIds.length} 张成图{exportMode === "longImage" ? `，将按分镜顺序合成为 ${longImagePreviewOutputs.length} 屏长图` : ""}。
            </p>
          </div>
          {exportMode === "longImage" && longImagePreviewOutputs.length > 0 ? (
            <div className={styles.exportDialogPreview} aria-label="长图预览">
              <p className={styles.exportDialogLabel}>拼接顺序预览</p>
              <div
                ref={screensRef}
                className={styles.exportDialogScreens}
                role="list"
                aria-label="长图各屏，可拖拽或用按钮调整顺序"
                data-sorting={dragSourceId != null ? "true" : undefined}
                onPointerMove={moveScreenDrag}
                onPointerUp={() => endScreenDrag(true)}
                onPointerCancel={() => endScreenDrag(false)}
                onLostPointerCapture={() => endScreenDrag(true)}
              >
                {longImagePreviewOutputs.map((output, index) => (
                  <Fragment key={output.id}>
                    {dragSourceId != null && insertIndex === index ? (
                      <div className={styles.exportDialogScreenPlaceholder} style={dragHeight > 0 ? { height: dragHeight } : undefined} />
                    ) : null}
                    <figure
                      role="listitem"
                      ref={(element) => {
                        if (element) screenRefs.current.set(output.id, element);
                        else screenRefs.current.delete(output.id);
                      }}
                      className={styles.exportDialogScreen}
                      data-hidden={dragSourceId === output.id ? "true" : undefined}
                      onPointerDown={(event) => beginScreenDrag(event, index, output.id)}
                    >
                      <span className={styles.exportDialogScreenIndex}>{index + 1}</span>
                      {/* 预览用 512px 缩略图；编辑产物等缺缩略图时回退原图。 */}
                      <img
                        src={outputThumbnailUrl(output) ?? outputPreviewUrl(output)}
                        alt={`第 ${index + 1} 屏`}
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                        onError={(event) => {
                          const image = event.currentTarget;
                          if (image.dataset.fallback) return;
                          image.dataset.fallback = "1";
                          image.src = outputPreviewUrl(output);
                        }}
                      />
                      <div className={styles.exportDialogScreenTools}>
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveScreen(index, index - 1)}
                          aria-label={`上移第 ${index + 1} 屏`}
                        >
                          <ChevronUp size={13} strokeWidth={2.5} />
                        </button>
                        <button
                          type="button"
                          disabled={index === longImagePreviewOutputs.length - 1}
                          onClick={() => moveScreen(index, index + 1)}
                          aria-label={`下移第 ${index + 1} 屏`}
                        >
                          <ChevronDown size={13} strokeWidth={2.5} />
                        </button>
                      </div>
                    </figure>
                  </Fragment>
                ))}
                {dragSourceId != null && insertIndex === longImagePreviewOutputs.length ? (
                  <div className={styles.exportDialogScreenPlaceholder} style={dragHeight > 0 ? { height: dragHeight } : undefined} />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
