import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Modal, Progress, Segmented, Select, Skeleton, Tooltip, Upload } from "antd";
import {
  Check,
  FileUp,
  Grid2x2,
  Layers,
  ListFilter,
  Package,
  PackageCheck,
  PenLine,
  RefreshCw,
  Search,
  Shapes,
  Sparkles,
  Trash2,
  Upload as UploadIcon,
  Wand2,
  X,
} from "lucide-react";

import {
  useCreatePatternExtractJob,
  useCreatePatternListingJob,
  useCreatePrintPackJob,
  useDeletePattern,
  usePatterns,
  usePodPrintSpecs,
  useUploadPattern,
  type ListingPlatform,
  type Pattern,
  type PodPrintLayout,
  type PodRepeatLayout,
} from "../../api/hooks/usePatterns";
import { usePatternDrafts } from "../../api/hooks/usePatternDrafts";
import { StartDraftDialog } from "../pattern-drafts/StartDraftDialog";
import { useJobStatus } from "../../api/hooks/useJobs";
import { useProviders } from "../../api/hooks/useProviders";
import { qk } from "../../api/queryKeys";
import { AppTopbar } from "../../components/AppTopbar";
import { errorText } from "../../lib/errorText";
import { jobErrorText } from "../../lib/jobError";
import { PATTERN_EXTRACT_BACKGROUNDS, imageParamSupportFor, type ImageResolution } from "@ecomgen/contracts";
import { parseModelKey, modelOptions, segmentationModelOptions } from "../../lib/modelOptions";
import { relativeTime } from "../../lib/format";
import { panelBackdrop, placeholderBackdrop } from "./heroPatterns";
import { BackgroundModeSelect, EMPTY_PIPELINE_ANSWERS, ImageModelSelect, LayoutChipRow, LISTING_PLATFORM_OPTIONS, ListingModelSelect, PipelineAnswersBlock, missingPipelineAnswer, podSpecOptionLabel, RepeatLayoutChipRow, SOURCE_FILTERS, SOURCE_LABELS, stageText, StatusPill, statusLabel, statusTone, tileableBadge, toPipelineAnswers, type PipelineAnswerDraft } from "./shared";
import styles from "./PatternsPage.module.css";

type ActiveJobKind = "EXTRACT" | "FORGE";

/** 墙内占位卡对应的在途任务；刷新页面经 sessionStorage 恢复，终态后撤卡。 */
interface ActiveJob {
  jobId: string;
  kind: ActiveJobKind;
  title: string;
}

const ACTIVE_JOBS_KEY = "ecomgen.patterns.activeJobs";
const FILTERS_KEY = "ecomgen.patterns.filters";

function loadActiveJobs(): ActiveJob[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(ACTIVE_JOBS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ActiveJob =>
        Boolean(item) &&
        typeof (item as ActiveJob).jobId === "string" &&
        ((item as ActiveJob).kind === "EXTRACT" || (item as ActiveJob).kind === "FORGE") &&
        typeof (item as ActiveJob).title === "string",
    );
  } catch {
    return [];
  }
}

/** 筛选状态的 sessionStorage 恢复；字段缺失或类型不符时回到默认值，不做部分合并。 */
function loadFilters(): { search: string; sourceFilter: "ALL" | Pattern["source"]; tagFilter: string[] } {
  const fallback = { search: "", sourceFilter: "ALL" as const, tagFilter: [] as string[] };
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(FILTERS_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return fallback;
    const record = parsed as { search?: unknown; sourceFilter?: unknown; tagFilter?: unknown };
    const source = typeof record.sourceFilter === "string" && SOURCE_FILTERS.some((option) => option.value === record.sourceFilter)
      ? (record.sourceFilter as "ALL" | Pattern["source"])
      : fallback.sourceFilter;
    const tags = Array.isArray(record.tagFilter) ? record.tagFilter.filter((tag): tag is string => typeof tag === "string") : fallback.tagFilter;
    return { search: typeof record.search === "string" ? record.search : fallback.search, sourceFilter: source, tagFilter: tags };
  } catch {
    return fallback;
  }
}

/**
 * 花型工坊：三个入花动作（提取/起稿/上传）+ 花型墙；点击卡片进入 /patterns/:patternId 全屏工作区。
 * 全局页没有项目 SSE 通道，在途任务由占位卡各自 1.5s 轮询驱动；
 * 提交即插占位卡、完成原位结算，顶部不再有全局进度横幅。
 */
export function PatternsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const patternsQuery = usePatterns();

  const [extractOpen, setExtractOpen] = useState(false);
  const [extractPresetFile, setExtractPresetFile] = useState<File | null>(null);
  const [startDraftOpen, setStartDraftOpen] = useState(false);
  const draftsQuery = usePatternDrafts();
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>(loadActiveJobs);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // 筛选与批量：纯前端状态；筛选持久化到 sessionStorage，从工作区返回花型墙时上下文不丢。
  const savedFilters = useMemo(() => loadFilters(), []);
  const [search, setSearch] = useState(savedFilters.search);
  const [sourceFilter, setSourceFilter] = useState<"ALL" | Pattern["source"]>(savedFilters.sourceFilter);
  const [tagFilter, setTagFilter] = useState<string[]>(savedFilters.tagFilter);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchPackOpen, setBatchPackOpen] = useState(false);
  const [batchListingOpen, setBatchListingOpen] = useState(false);

  const patterns = useMemo(() => patternsQuery.data?.items ?? [], [patternsQuery.data]);
  const drafts = useMemo(() => draftsQuery.data?.items ?? [], [draftsQuery.data]);
  // 页头草稿入口的悬停详情：只报最近一份，完整列表在草稿页。
  const latestDraft = useMemo(() => [...drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null, [drafts]);
  const allTags = useMemo(() => Array.from(new Set(patterns.flatMap((pattern) => pattern.tags))).sort(), [patterns]);
  const visiblePatterns = useMemo(
    () =>
      patterns.filter(
        (pattern) =>
          (sourceFilter === "ALL" || pattern.source === sourceFilter) &&
          (search.trim() === "" || pattern.name.toLowerCase().includes(search.trim().toLowerCase())) &&
          tagFilter.every((tag) => pattern.tags.includes(tag)),
      ),
    [patterns, sourceFilter, search, tagFilter],
  );

  useEffect(() => {
    window.sessionStorage.setItem(ACTIVE_JOBS_KEY, JSON.stringify(activeJobs));
  }, [activeJobs]);

  useEffect(() => {
    window.sessionStorage.setItem(FILTERS_KEY, JSON.stringify({ search, sourceFilter, tagFilter }));
  }, [search, sourceFilter, tagFilter]);

  /** 进入花型工作区；section 直达动作栏对应节（成包流水线/信息/衍生/规格包/交付）。 */
  const openPattern = useCallback(
    (patternId: string, section: "pipeline" | "info" | "derive" | "pack" | "listing" | null = null) => {
      navigate(section ? `/patterns/${patternId}?section=${section}` : `/patterns/${patternId}`);
    },
    [navigate],
  );

  const confirmDelete = (pattern: Pattern) => {
    modal.confirm({
      title: "删除花型",
      content: `「${pattern.name}」的图稿与源图留痕将被永久删除，相关规格包记录也会一并清理。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await deletePattern.mutateAsync(pattern.id);
        } catch (error) {
          message.error(errorText(error));
        }
      },
    });
  };

  const deletePattern = useDeletePattern();
  const upload = useUploadPattern();

  /** 任务起点：复用（200）则直接进入既有花型的工作区，新任务（202）插占位卡。 */
  const trackJob = useCallback(
    (info: { job: { id: string }; kind: ActiveJobKind; title: string; reused: boolean }) => {
      if (info.reused) {
        const existing = patterns.find((pattern) => pattern.sourceJobId === info.job.id);
        if (existing) {
          openPattern(existing.id);
          message.info("相同输入的任务已存在，已定位到它的花型");
        } else {
          void queryClient.invalidateQueries({ queryKey: qk.patterns });
          message.info("相同输入的任务已存在");
        }
        return;
      }
      setActiveJobs((prev) =>
        prev.some((job) => job.jobId === info.job.id) ? prev : [...prev, { jobId: info.job.id, kind: info.kind, title: info.title }],
      );
    },
    [patterns, queryClient, openPattern, message],
  );

  /** 占位卡结算：产物已可见，撤卡 + 提示 + 进入首张新花型的工作区。 */
  const settleJob = useCallback(
    (activeJob: ActiveJob, products: Pattern[]) => {
      setActiveJobs((prev) => prev.filter((job) => job.jobId !== activeJob.jobId));
      message.success(`「${activeJob.title}」完成，新增 ${products.length} 个花型`);
      openPattern(products[0]!.id);
    },
    [message, openPattern],
  );

  const dropActiveJob = useCallback((jobId: string) => {
    setActiveJobs((prev) => prev.filter((job) => job.jobId !== jobId));
  }, []);

  const openExtract = useCallback((presetFile: File | null) => {
    setExtractPresetFile(presetFile);
    setExtractOpen(true);
  }, []);

  /** 拖落入页：单张图预填提取弹窗（主流程是"从商品图提取"），多张图直接批量入库。 */
  const handleDroppedFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 1) {
        openExtract(files[0]!);
        return;
      }
      const results = await Promise.allSettled(files.map((file) => upload.mutateAsync({ file })));
      const uploaded = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      if (uploaded.length > 0) {
        message.success(`已入库 ${uploaded.length} 个花型`);
        openPattern(uploaded[0]!.id);
      }
      results.forEach((result, index) => {
        if (result.status === "rejected") message.error(`「${files[index]!.name}」上传失败：${errorText(result.reason)}`);
      });
    },
    [openExtract, upload, message, openPattern],
  );

  const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const onDragEnter = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragOver = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
  };

  const onDragLeave = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const onDrop = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      message.warning("只支持图片文件");
      return;
    }
    void handleDroppedFiles(files);
  };

  /** 方向键在花型墙内移动焦点；列数从实际网格解析，容器缩放后依然正确。 */
  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const grid = gridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>("[data-pattern-id]"));
    const current = cards.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length || 1;
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? columns : -columns;
    const next = cards[current + step];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <div className={styles.page} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <AppTopbar current="patterns" settingsOpen={settingsOpen} onSettingsOpenChange={setSettingsOpen} />
      <div className={styles.content}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>花型工坊</h1>
            <p className={styles.subtitle}>从一张商品图到可投产的花型资产：提取、起稿、成规格包、写跨境文案。</p>
          </div>
          <div className={styles.actions}>
            {activeJobs.length > 0 ? (
              <span className={styles.runningChip} role="status">
                <span className={styles.runningDot} />
                {activeJobs.length} 个任务进行中
              </span>
            ) : null}
            {latestDraft ? (
              <Tooltip
                title={`最近：${latestDraft.name}${latestDraft.candidateCount > 0 ? ` · ${latestDraft.candidateCount} 张候选` : ""} · ${relativeTime(latestDraft.updatedAt)}`}
              >
                <Button icon={<Layers size={15} strokeWidth={2} />} onClick={() => navigate("/pattern-drafts")}>
                  草稿 · {drafts.length}
                </Button>
              </Tooltip>
            ) : null}
            <Button type="primary" icon={<Search size={15} strokeWidth={2} />} onClick={() => openExtract(null)}>
              从商品图提取
            </Button>
            <Button icon={<Sparkles size={15} strokeWidth={2} />} onClick={() => setStartDraftOpen(true)}>
              AI 起稿
            </Button>
            <UploadButton />
          </div>
        </div>

        {patterns.length > 0 ? (
          <div className={styles.filterBar}>
            <Input
              size="small"
              className={styles.filterSearch}
              placeholder="搜索花型名称"
              aria-label="搜索花型名称"
              allowClear
              prefix={<Search size={13} strokeWidth={2} />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className={styles.chipRow} role="group" aria-label="按来源筛选">
              {SOURCE_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={sourceFilter === option.value ? `${styles.chip} ${styles.chipActive}` : styles.chip}
                  onClick={() => setSourceFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Select
              size="small"
              style={{ minWidth: 150 }}
              mode="multiple"
              placeholder="按标签筛选"
              aria-label="按标签筛选"
              value={tagFilter}
              onChange={setTagFilter}
              options={allTags.map((tag) => ({ value: tag, label: tag }))}
              allowClear
            />
            <Button
              size="small"
              type={batchMode ? "primary" : "default"}
              icon={<ListFilter size={13} strokeWidth={2} />}
              onClick={() => {
                setBatchMode((value) => !value);
                setSelectedIds([]);
              }}
            >
              批量
            </Button>
          </div>
        ) : null}

        <div className={styles.grid} ref={gridRef} role="list" aria-label="花型墙" onKeyDown={handleGridKeyDown}>
          {patternsQuery.isPending ? (
            <div className={styles.skeletonGrid}>
              {Array.from({ length: 12 }, (_, index) => (
                <Skeleton.Node key={index} active style={{ width: "100%", height: 220, borderRadius: 12 }} />
              ))}
            </div>
          ) : patternsQuery.isError ? (
            <div className={styles.state}>
              <span>花型墙加载失败：{errorText(patternsQuery.error)}</span>
              <Button icon={<RefreshCw size={14} strokeWidth={2} />} onClick={() => void patternsQuery.refetch()}>
                重试
              </Button>
            </div>
          ) : patterns.length === 0 && activeJobs.length === 0 ? (
            <div className={styles.empty} style={{ backgroundImage: panelBackdrop }}>
              <Shapes size={30} strokeWidth={1.5} className={styles.emptyGlyph} />
              <h2 className={styles.emptyTitle}>从一张商品图，铺满整个品类矩阵</h2>
              <p className={styles.emptyDesc}>
                提取实拍图里的图案，或用一句话起稿；每个花型都能直接产出 300DPI 规格包与跨境 Listing 文案。
              </p>
              <div className={styles.emptyActions}>
                <Button type="primary" icon={<Search size={15} strokeWidth={2} />} onClick={() => openExtract(null)}>
                  从商品图提取
                </Button>
                <Button icon={<Sparkles size={15} strokeWidth={2} />} onClick={() => setStartDraftOpen(true)}>
                  AI 起稿
                </Button>
              </div>
              <span className={styles.emptyHint}>也可以把商品图直接拖进页面</span>
            </div>
          ) : visiblePatterns.length === 0 ? (
            <div className={styles.state}>
              <span>没有符合筛选条件的花型</span>
              <Button
                onClick={() => {
                  setSearch("");
                  setSourceFilter("ALL");
                  setTagFilter([]);
                }}
              >
                清除筛选
              </Button>
            </div>
          ) : (
            <>
              {activeJobs.map((job) => (
                <PlaceholderCard key={job.jobId} activeJob={job} onSettle={settleJob} onDrop={dropActiveJob} />
              ))}
              {visiblePatterns.map((pattern) => (
                <PatternCard
                  key={pattern.id}
                  pattern={pattern}
                  batchChecked={batchMode && selectedIds.includes(pattern.id)}
                  onOpen={() => {
                    if (batchMode) {
                      setSelectedIds((prev) => (prev.includes(pattern.id) ? prev.filter((id) => id !== pattern.id) : [...prev, pattern.id]));
                      return;
                    }
                    openPattern(pattern.id);
                  }}
                  onQuickAction={(section) => openPattern(pattern.id, section)}
                  onDelete={() => confirmDelete(pattern)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {batchMode ? (
        <div className={styles.batchBar} role="toolbar" aria-label="批量操作">
          <span className={styles.batchCount}>已选 {selectedIds.length}</span>
          <Button
            size="small"
            type="primary"
            disabled={selectedIds.length === 0}
            icon={<Package size={13} strokeWidth={2} />}
            onClick={() => setBatchPackOpen(true)}
          >
            批量成规格包
          </Button>
          <Button
            size="small"
            disabled={selectedIds.length === 0}
            icon={<PenLine size={13} strokeWidth={2} />}
            onClick={() => setBatchListingOpen(true)}
          >
            批量写文案
          </Button>
          <Button
            size="small"
            type="text"
            icon={<X size={13} strokeWidth={2} />}
            onClick={() => {
              setBatchMode(false);
              setSelectedIds([]);
            }}
          >
            退出批量
          </Button>
        </div>
      ) : null}

      {dragging ? (
        <div className={styles.dropOverlay}>
          <div className={styles.dropFrame}>松开鼠标，提取为花型</div>
        </div>
      ) : null}

      <ExtractDialog
        open={extractOpen}
        initialFile={extractPresetFile}
        onClose={() => {
          setExtractOpen(false);
          setExtractPresetFile(null);
        }}
        onStarted={(job, reused, title) => trackJob({ job, reused, kind: "EXTRACT", title })}
      />
      <StartDraftDialog
        open={startDraftOpen}
        onClose={() => setStartDraftOpen(false)}
        onCreated={(draft) => {
          setStartDraftOpen(false);
          queryClient.invalidateQueries({ queryKey: qk.patternDrafts });
          navigate(`/pattern-drafts/${draft.id}`);
        }}
      />

      <BatchPackDialog
        open={batchPackOpen}
        patterns={patterns.filter((pattern) => selectedIds.includes(pattern.id))}
        onClose={() => {
          setBatchPackOpen(false);
          setBatchMode(false);
          setSelectedIds([]);
        }}
      />
      <BatchListingDialog
        open={batchListingOpen}
        patterns={patterns.filter((pattern) => selectedIds.includes(pattern.id))}
        onClose={() => {
          setBatchListingOpen(false);
          setBatchMode(false);
          setSelectedIds([]);
        }}
      />
    </div>
  );
}

/** 顶部「上传花型文件」：跳过提取直接入库；勾选「接着成包」时同一次请求就把流水线答案带上去。 */
function UploadButton() {
  const { message } = App.useApp();
  const upload = useUploadPattern();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pipeline, setPipeline] = useState<PipelineAnswerDraft>(EMPTY_PIPELINE_ANSWERS);

  const submit = () => {
    if (!file) {
      message.warning("请选择花型文件");
      return;
    }
    const missing = missingPipelineAnswer(pipeline);
    if (missing) {
      message.warning(missing);
      return;
    }
    const answers = toPipelineAnswers(pipeline);
    upload.mutate(
      { file, ...(answers ? { pipeline: answers } : {}) },
      {
        onSuccess: () => {
          message.success(answers ? "花型已入库，流水线已开始" : "花型已入库");
          setOpen(false);
          setFile(null);
          setPipeline(EMPTY_PIPELINE_ANSWERS);
        },
        onError: (error) => message.error(errorText(error)),
      },
    );
  };

  return (
    <>
      <Button icon={<UploadIcon size={15} strokeWidth={2} />} onClick={() => setOpen(true)}>
        上传花型文件
      </Button>
      <Modal title="上传花型文件" open={open} onCancel={() => setOpen(false)} onOk={submit} okText="入库" confirmLoading={upload.isPending} okButtonProps={{ disabled: !file }} destroyOnHidden>
        {file ? <div style={{ marginBottom: 12, fontSize: 12, color: "var(--text-3)" }}>已选择：{file.name}</div> : null}
        <Upload accept="image/*" showUploadList={false} maxCount={1} beforeUpload={(picked) => { setFile(picked); return false; }}>
          <Button icon={<FileUp size={15} strokeWidth={2} />}>{file ? "重新选择花型文件" : "选择花型文件（建议透明底 PNG）"}</Button>
        </Upload>
        <PipelineAnswersBlock draft={pipeline} onChange={setPipeline} />
      </Modal>
    </>
  );
}

/** 花型卡：缩略图 + 来源徽标 + hover 快捷操作（一键成包/平铺/规格包/文案/衍生）；点击进入工作区，批量模式下点选勾选。 */
function PatternCard({
  pattern,
  batchChecked,
  onOpen,
  onQuickAction,
  onDelete,
}: {
  pattern: Pattern;
  batchChecked: boolean;
  onOpen: () => void;
  onQuickAction: (section: "derive" | "pack" | "listing" | "pipeline") => void;
  onDelete: () => void;
}) {
  const [tiled, setTiled] = useState(false);
  const previewUrl = pattern.thumbUrl ?? pattern.imageUrl;
  const tileBadge = tileableBadge(pattern.tileable);
  const cardClass = batchChecked ? `${styles.card} ${styles.cardBatchChecked}` : styles.card;
  return (
    <div
      data-pattern-id={pattern.id}
      role="listitem"
      aria-selected={batchChecked}
      className={cardClass}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
    >
      <div className={styles.thumb}>
        {previewUrl ? (
          tiled ? (
            <div className={styles.tileBg} style={{ backgroundImage: `url("${previewUrl}")` }} />
          ) : (
            <img src={previewUrl} alt={pattern.name} loading="lazy" />
          )
        ) : null}
        {batchChecked ? (
          <span className={styles.batchCheck} aria-hidden>
            <Check size={13} strokeWidth={3} />
          </span>
        ) : null}
        <div className={styles.badges}>
          <span className={styles.badge}>{SOURCE_LABELS[pattern.source]}</span>
          {tileBadge ? <span className={tileBadge.className}>{tileBadge.label}</span> : null}
        </div>
        <div className={styles.cardActions}>
          <button
            type="button"
            className={styles.cardActionBtn}
            title="成一键包（验缝 → 规格包 → 文案）"
            aria-label="成一键包"
            onClick={(event) => {
              event.stopPropagation();
              onQuickAction("pipeline");
            }}
          >
            <PackageCheck size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={tiled ? `${styles.cardActionBtn} ${styles.cardActionBtnActive}` : styles.cardActionBtn}
            title={tiled ? "切回单张视图" : "平铺预览"}
            aria-label={tiled ? "切回单张视图" : "平铺预览"}
            aria-pressed={tiled}
            onClick={(event) => {
              event.stopPropagation();
              setTiled((value) => !value);
            }}
          >
            <Grid2x2 size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.cardActionBtn}
            title="成规格包"
            aria-label="成规格包"
            onClick={(event) => {
              event.stopPropagation();
              onQuickAction("pack");
            }}
          >
            <Package size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.cardActionBtn}
            title="写 Listing 文案"
            aria-label="写 Listing 文案"
            onClick={(event) => {
              event.stopPropagation();
              onQuickAction("listing");
            }}
          >
            <PenLine size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            className={styles.cardActionBtn}
            title="衍生（改色 / 画风 / 构图）"
            aria-label="衍生"
            onClick={(event) => {
              event.stopPropagation();
              onQuickAction("derive");
            }}
          >
            <Wand2 size={13} strokeWidth={2} />
          </button>
        </div>
        <button
          type="button"
          className={styles.cardDelete}
          aria-label={`删除花型 ${pattern.name}`}
          title="删除花型"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={13} strokeWidth={2} />
        </button>
      </div>
      <div className={styles.cardBody}>
        <span className={styles.cardName}>{pattern.name}</span>
        {pattern.tags.length > 0 ? <span className={styles.cardTags}>{pattern.tags.join(" · ")}</span> : null}
      </div>
    </div>
  );
}

/**
 * 生成占位卡：与花型卡同构的骨架，轮询自己的任务直到终态。
 * SUCCEEDED 只代表任务完成——产物行落库并出现在列表后（sourceJobId 关联）才算结算，
 * 避免"任务成功但墙上找不到新花型"的断层。
 */
function PlaceholderCard({
  activeJob,
  onSettle,
  onDrop,
}: {
  activeJob: ActiveJob;
  onSettle: (activeJob: ActiveJob, products: Pattern[]) => void;
  onDrop: (jobId: string) => void;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const jobQuery = useJobStatus(activeJob.jobId);
  const patternsQuery = usePatterns();

  const status = jobQuery.data?.status ?? "QUEUED";
  const progress = jobQuery.data?.progress ?? 0;
  const kindLabel = activeJob.kind === "EXTRACT" ? "提取中" : "起稿中";

  const products = useMemo(
    () => (patternsQuery.data?.items ?? []).filter((pattern) => pattern.sourceJobId === activeJob.jobId),
    [patternsQuery.data, activeJob.jobId],
  );

  useEffect(() => {
    if (status === "SUCCEEDED") void queryClient.invalidateQueries({ queryKey: qk.patterns });
  }, [status, queryClient]);

  useEffect(() => {
    if (status === "SUCCEEDED" && products.length > 0) onSettle(activeJob, products);
  }, [status, products, activeJob, onSettle]);

  useEffect(() => {
    if (status !== "FAILED" && status !== "CANCELLED") return;
    message.error(jobErrorText(jobQuery.data) ?? "任务失败");
    onDrop(activeJob.jobId);
  }, [status, jobQuery.data, message, onDrop, activeJob.jobId]);

  // 刷新后恢复的占位卡可能指向已不存在的任务：查询失败就静默撤卡。
  useEffect(() => {
    if (jobQuery.isError) onDrop(activeJob.jobId);
  }, [jobQuery.isError, onDrop, activeJob.jobId]);

  return (
    <div role="listitem" aria-label={`${kindLabel}：${activeJob.title}`} className={styles.card}>
      <div className={styles.placeholderThumb} style={{ backgroundImage: placeholderBackdrop }}>
        <div className={styles.thumbShimmer} />
        <div className={styles.badges}>
          <span className={styles.badge}>{kindLabel}</span>
        </div>
      </div>
      <div className={styles.placeholderBody}>
        <span className={styles.cardName}>{activeJob.title}</span>
        <Progress size="small" percent={progress} status="active" />
        <span className={styles.placeholderStage}>{stageText(activeJob.kind, status, progress)}</span>
      </div>
    </div>
  );
}

/**
 * 提取入花：源图 + 提取模型 + 可选名称/补充描述；模型记忆最近一次选择。整页拖入的单张图经 initialFile 预填。
 *
 * 两条提取路共用这一个弹窗，方式由用户显式选择：分割抠图的像素取自商品图（产物与实物逐像素一致），
 * 生成重绘由生图模型摊平重绘（适合透视/褶皱/光影重的实拍，色彩细节可能与实物有差）。
 * 模型下拉与底版随方式切换——底版只在生成路出现，且透明档跟随模型能力禁用（复用衍生那套联动）。
 */
function ExtractDialog({
  open,
  initialFile,
  onClose,
  onStarted,
}: {
  open: boolean;
  initialFile: File | null;
  onClose: () => void;
  onStarted: (job: { id: string }, reused: boolean, title: string) => void;
}) {
  const { message } = App.useApp();
  const providersQuery = useProviders();
  const segmentationOptions = useMemo(() => segmentationModelOptions(providersQuery.data?.items ?? []), [providersQuery.data]);
  const imageOptions = useMemo(() => modelOptions(providersQuery.data?.items ?? [], "image"), [providersQuery.data]);
  const extract = useCreatePatternExtractJob();

  const [file, setFile] = useState<File | null>(initialFile);
  const [mode, setMode] = useState<"SEGMENT" | "GENERATE">("SEGMENT");
  const [modelKey, setModelKey] = useState<string | null>(null);
  const [imageModelKey, setImageModelKey] = useState<string | null>(null);
  const [imageResolution, setImageResolution] = useState<ImageResolution | null>(null);
  const [background, setBackground] = useState<"TRANSPARENT" | "WHITE">("TRANSPARENT");
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [pipeline, setPipeline] = useState<PipelineAnswerDraft>(EMPTY_PIPELINE_ANSWERS);

  // destroyOnHidden 让弹窗每次打开都重挂载；这里同步"拖拽预填"的文件。
  useEffect(() => {
    if (open) setFile(initialFile);
  }, [open, initialFile]);

  // 花型工坊是全局页，没有项目级分割配置可继承；localStorage 的最近选择就是默认值。
  useEffect(() => {
    if (modelKey || segmentationOptions.length === 0) return;
    setModelKey(window.localStorage.getItem("ecomgen.patterns.segmentation") ?? segmentationOptions[0]!.value);
  }, [modelKey, segmentationOptions]);

  // Provider 列表加载完成前按"支持透明底"处理：加载窗口里的"不知道"不等于"不支持"，
  // 否则刚打开弹窗就会把默认的透明底改写成白底。
  const transparentAvailable = imageOptions.find((option) => option.value === imageModelKey)?.transparentBackground ?? true;
  // 生成重绘的模型支持哪些出图档位：判定与 worker 同源（contracts 的 imageParamSupportFor）。
  const extractModelSupport = useMemo(() => {
    if (mode !== "GENERATE" || !imageModelKey) return null;
    const { providerId, modelId } = parseModelKey(imageModelKey);
    const kind = providersQuery.data?.items.find((provider) => provider.id === providerId)?.models.find((model) => model.id === modelId)?.imageApiKind ?? null;
    return imageParamSupportFor(modelId, kind as "openai_images" | "gemini" | "custom" | null);
  }, [mode, imageModelKey, providersQuery.data]);

  const submit = () => {
    if (!file) {
      message.warning("请选择一张带图案的商品图");
      return;
    }
    if (mode === "SEGMENT" && !modelKey) {
      message.warning("请选择分割模型");
      return;
    }
    if (mode === "GENERATE" && !imageModelKey) {
      message.warning("请选择生图模型");
      return;
    }
    const missing = missingPipelineAnswer(pipeline);
    if (missing) {
      message.warning(missing);
      return;
    }
    const { providerId, modelId } = parseModelKey(mode === "SEGMENT" ? modelKey! : imageModelKey!);
    const title = name.trim() || file.name;
    const answers = toPipelineAnswers(pipeline);
    extract.mutate(
      {
        file,
        body: {
          providerId,
          modelId,
          mode,
          ...(mode === "GENERATE" ? { background } : {}),
          ...(mode === "GENERATE" && extractModelSupport && extractModelSupport.resolutionTiers.length > 1 && imageResolution ? { imageResolution: imageResolution } : {}),
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(brief.trim() ? { brief: brief.trim() } : {}),
          ...(answers ? { pipeline: answers } : {}),
        },
      },
      {
        onSuccess: ({ job, reused }) => {
          onStarted(job, reused, title);
          onClose();
          setFile(null);
          setName("");
          setBrief("");
          setPipeline(EMPTY_PIPELINE_ANSWERS);
        },
        onError: (error) => message.error(errorText(error)),
      },
    );
  };

  return (
    <Modal
      title="从商品图提取花型"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="开始提取"
      confirmLoading={extract.isPending}
      okButtonProps={{ disabled: !file || (mode === "SEGMENT" ? !modelKey : !imageModelKey) }}
      destroyOnHidden
    >
      {file ? (
        <div style={{ marginBottom: 12, fontSize: 12, color: "var(--text-3)" }}>已选择：{file.name}</div>
      ) : null}
      <Upload accept="image/*" showUploadList={false} maxCount={1} beforeUpload={(picked) => { setFile(picked); return false; }}>
        <Button icon={<FileUp size={15} strokeWidth={2} />}>{file ? "重新选择商品图" : "选择商品图（含清晰图案）"}</Button>
      </Upload>
      <Segmented
        block
        style={{ marginTop: 12 }}
        value={mode}
        onChange={(value) => setMode(value as "SEGMENT" | "GENERATE")}
        options={[{ value: "SEGMENT", label: "分割抠图" }, { value: "GENERATE", label: "生成重绘" }]}
      />
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-3)" }}>
        {mode === "SEGMENT"
          ? "像素取自商品图本身，产物与实物逐像素一致。"
          : "由生图模型把图案摊平重绘成图稿，适合透视、褶皱、光影重的实拍；色彩与细节可能与实物有差。"}
      </div>
      {mode === "SEGMENT" ? (
        <Select
          style={{ width: "100%", marginTop: 12 }}
          placeholder="分割模型"
          aria-label="分割模型"
          value={modelKey}
          onChange={(key) => {
            setModelKey(key);
            window.localStorage.setItem("ecomgen.patterns.segmentation", key);
          }}
          options={segmentationOptions.map((option) => ({ value: option.value, label: option.label }))}
        />
      ) : (
        <>
          <div style={{ marginTop: 12 }}>
            <ImageModelSelect value={imageModelKey} onChange={setImageModelKey} storageKey="ecomgen.patterns.extractImage" label="生图模型" />
          </div>
          <div style={{ marginTop: 12 }}>
            <BackgroundModeSelect
              value={background}
              onChange={setBackground}
              modes={PATTERN_EXTRACT_BACKGROUNDS}
              fallback="WHITE"
              transparentAvailable={transparentAvailable}
            />
          </div>
          {extractModelSupport && extractModelSupport.resolutionTiers.length > 1 ? (
            <Select
              style={{ width: "100%", marginTop: 12 }}
              aria-label="输出分辨率"
              value={imageResolution ?? extractModelSupport.resolutionTiers[0]}
              onChange={(value) => setImageResolution(value)}
              options={extractModelSupport.resolutionTiers.map((value) => ({ value, label: `分辨率 ${value}` }))}
            />
          ) : null}
        </>
      )}
      <Input
        style={{ marginTop: 12 }}
        placeholder="花型名称（可选）"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Input.TextArea
        style={{ marginTop: 12 }}
        rows={2}
        placeholder="补充描述（可选），例如：只留杯壁图案、去掉杯把和底座"
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
      />
      <PipelineAnswersBlock draft={pipeline} onChange={setPipeline} />
    </Modal>
  );
}

/** 批量任务的行内状态：复用全局任务轮询，终态后给出结果标记。 */
function BatchJobRow({ name, jobId }: { name: string; jobId: string }) {
  const job = useJobStatus(jobId);
  const status = job.data?.status ?? "QUEUED";
  // 措辞与色调都走共享映射：这一行曾是第四份本地状态表，同一个 RUNNING 在墙和工作区被写成两种说法。
  const tone = statusTone(status);
  return (
    <div className={styles.batchRow}>
      <span className={styles.batchRowName}>{name}</span>
      <StatusPill tone={tone} title={status === "FAILED" ? jobErrorText(job.data) ?? undefined : undefined}>
        {status === "RUNNING" || status === "QUEUED" ? "进行中…" : statusLabel(status)}
      </StatusPill>
    </div>
  );
}

/** 批量成规格包：选规格与版式，逐个复用既有端点入队；对话框内逐行展示任务状态。 */
function BatchPackDialog({ open, patterns, onClose }: { open: boolean; patterns: Pattern[]; onClose: () => void }) {
  const { message } = App.useApp();
  const specsQuery = usePodPrintSpecs();
  const createPack = useCreatePrintPackJob();
  const [specId, setSpecId] = useState<string | null>(null);
  const [layout, setLayout] = useState<PodPrintLayout>("CENTERED");
  const [repeatLayout, setRepeatLayout] = useState<PodRepeatLayout>("STRAIGHT");
  const [jobs, setJobs] = useState<Array<{ patternId: string; name: string; jobId: string }>>([]);
  const [running, setRunning] = useState(false);

  const specs = specsQuery.data?.items ?? [];

  const run = async () => {
    if (!specId || patterns.length === 0) return;
    setRunning(true);
    setJobs([]);
    const collected: Array<{ patternId: string; name: string; jobId: string }> = [];
    for (const pattern of patterns) {
      try {
        const { job } = await createPack.mutateAsync({ patternId: pattern.id, body: { specId, layout, ...(layout === "TILE" ? { repeatLayout } : {}) } });
        collected.push({ patternId: pattern.id, name: pattern.name, jobId: job.id });
        setJobs([...collected]);
      } catch (error) {
        message.error(`「${pattern.name}」成包失败：${errorText(error)}`);
      }
    }
    setRunning(false);
  };

  return (
    <Modal
      title={`批量成规格包（${patterns.length} 个花型）`}
      open={open}
      onCancel={onClose}
      footer={
        jobs.length > 0 && !running ? (
          <Button type="primary" onClick={onClose}>
            完成
          </Button>
        ) : null
      }
      destroyOnHidden
    >
      {jobs.length === 0 ? (
        <>
          <LayoutChipRow value={layout} onChange={setLayout} />
          {layout === "TILE" ? (
            <div style={{ marginTop: 10 }}>
              <RepeatLayoutChipRow value={repeatLayout} onChange={setRepeatLayout} ariaLabel="平铺排列" />
            </div>
          ) : null}
          <Select
            style={{ width: "100%", marginTop: 10 }}
            placeholder="品类规格"
            aria-label="品类规格"
            value={specId}
            onChange={setSpecId}
            options={specs.map((spec) => ({ value: spec.id, label: podSpecOptionLabel(spec) }))}
          />
          <Button type="primary" block style={{ marginTop: 12 }} disabled={!specId} loading={running} onClick={() => void run()}>
            为 {patterns.length} 个花型成包
          </Button>
        </>
      ) : (
        <div>
          {jobs.map((job) => (
            <BatchJobRow key={job.jobId} name={job.name} jobId={job.jobId} />
          ))}
          {running ? <p className={styles.formHint}>剩余花型正在入队…</p> : null}
        </div>
      )}
    </Modal>
  );
}

/** 批量写 Listing 文案：选平台与推理模型，逐个复用既有端点入队。 */
function BatchListingDialog({ open, patterns, onClose }: { open: boolean; patterns: Pattern[]; onClose: () => void }) {
  const { message } = App.useApp();
  const createListing = useCreatePatternListingJob();
  const [platform, setPlatform] = useState<ListingPlatform>("ETSY");
  const [listingModelKey, setListingModelKey] = useState<string | null>(null);
  const [sellingPoints, setSellingPoints] = useState("");
  const [bannedWords, setBannedWords] = useState("");
  const [jobs, setJobs] = useState<Array<{ patternId: string; name: string; jobId: string }>>([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!listingModelKey || patterns.length === 0) return;
    const { providerId, modelId } = parseModelKey(listingModelKey);
    setRunning(true);
    setJobs([]);
    const collected: Array<{ patternId: string; name: string; jobId: string }> = [];
    for (const pattern of patterns) {
      try {
        const { job } = await createListing.mutateAsync({
          patternId: pattern.id,
          body: {
            providerId,
            modelId,
            platform,
            ...(sellingPoints.trim() ? { sellingPoints: sellingPoints.trim() } : {}),
            ...(bannedWords.trim() ? { bannedWords: bannedWords.trim() } : {}),
          },
        });
        collected.push({ patternId: pattern.id, name: pattern.name, jobId: job.id });
        setJobs([...collected]);
      } catch (error) {
        message.error(`「${pattern.name}」文案失败：${errorText(error)}`);
      }
    }
    setRunning(false);
  };

  return (
    <Modal
      title={`批量写 Listing 文案（${patterns.length} 个花型）`}
      open={open}
      onCancel={onClose}
      footer={
        jobs.length > 0 && !running ? (
          <Button type="primary" onClick={onClose}>
            完成
          </Button>
        ) : null
      }
      destroyOnHidden
    >
      {jobs.length === 0 ? (
        <>
          <ListingModelSelect
            value={listingModelKey}
            onChange={setListingModelKey}
          />
          <div className={styles.formRow} style={{ marginTop: 8 }}>
            <Select style={{ width: "100%" }} aria-label="目标平台" value={platform} onChange={setPlatform} options={LISTING_PLATFORM_OPTIONS} />
            <Input.TextArea rows={2} placeholder="卖点补充（可选）" value={sellingPoints} onChange={(event) => setSellingPoints(event.target.value)} />
            <Input placeholder="禁用词（可选）" value={bannedWords} onChange={(event) => setBannedWords(event.target.value)} />
            <Button type="primary" block disabled={!listingModelKey} loading={running} onClick={() => void run()}>
              为 {patterns.length} 个花型写文案
            </Button>
          </div>
        </>
      ) : (
        <div>
          {jobs.map((job) => (
            <BatchJobRow key={job.jobId} name={job.name} jobId={job.jobId} />
          ))}
          {running ? <p className={styles.formHint}>剩余花型正在入队…</p> : null}
        </div>
      )}
    </Modal>
  );
}
