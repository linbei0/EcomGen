import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Image, Input, Popconfirm, Popover, Progress, Select, Skeleton, Slider, Tooltip } from "antd";
import { ArrowLeft, ChevronRight, Download, Info, Package, Pencil, Trash2 } from "lucide-react";
import { TILEABILITY_ALGORITHM_VERSION, PATTERN_VARIANT_CANDIDATES_MAX, PATTERN_VARIANT_PRESETS } from "@ecomgen/contracts";
import { PATTERN_VARIANT_AXIS_LABELS, PATTERN_VARIANT_PRESET_LABELS } from "@ecomgen/ecom-skill";

import {
  useCreatePatternDeriveJob,
  useCreatePatternListingJob,
  useCreatePatternTileCheckJob,
  useCreatePatternVariantJob,
  useCreatePrintPackJob,
  useDeletePattern,
  usePatternListingResult,
  usePatternPrintPacks,
  usePatterns,
  usePodPrintSpecs,
  useUpdatePattern,
  type ListingPlatform,
  type Pattern,
  type PatternBackgroundMode,
  type PatternVariantAxis,
  type PatternVariantPreset,
  type PodPrintLayout,
  type PodPrintSpec,
  type PodRepeatLayout,
} from "../../api/hooks/usePatterns";
import { useJobStatus } from "../../api/hooks/useJobs";
import { useProviders } from "../../api/hooks/useProviders";
import { qk } from "../../api/queryKeys";
import { AppTopbar } from "../../components/AppTopbar";
import { errorText } from "../../lib/errorText";
import { formatShortDate } from "../../lib/format";
import { jobErrorText } from "../../lib/jobError";
import { modelOptions, parseModelKey } from "../../lib/modelOptions";
import { panelBackdrop } from "./heroPatterns";
import { PatternPipelineSection } from "./PatternPipelineSection";
import { BackgroundModeSelect, CopyRow, ImageModelSelect, LayoutChipRow, LISTING_PLATFORM_OPTIONS, ListingModelSelect, podSpecOptionLabel, RepeatLayoutChipRow, SOURCE_LABELS, SectionHead, StatusPill, TiledPatternStage, stageText, statusLabel, statusTone, tileableBadge } from "./shared";
import styles from "./PatternWorkspacePage.module.css";

/** 衍生可选底版：源图在，所以"跟随源图"也在；顺序即默认优先顺序。 */
const VARIANT_BACKGROUND_MODES = ["SOURCE", "WHITE", "TRANSPARENT"] as const;

/** 舞台视图：原图 / 平铺 / 规格包；经 URL searchParams 同步（刷新与返回保持一致）。 */
type StageView = "artwork" | "tile" | "pack";

const VIEW_LABELS: Record<StageView, string> = { artwork: "原图", tile: "平铺", pack: "规格包" };

/**
 * TILE 版式下的诚实提示：满印是否露缝取决于花型边缘能否对上，而这件事只有验缝说过话才算数，
 * 所以按判定分三种说法——不对未验缝的花型假装它没问题，也不把 FAILED 稀释成模糊警告。
 */
const TILE_LAYOUT_HINTS: Record<Pattern["tileable"], string> = {
  NONE: "平铺满印会把花型重复铺满可印区，但该花型还未验缝：四边能否对上未知，建议先切到「平铺」视图验缝。",
  VERIFIED: "平铺满印会把花型重复铺满可印区；该花型已验缝通过，四边衔接可用。",
  FAILED: "该花型验缝未通过：满印会在成品上露出规则接缝。建议改用居中版式、换镜像排列，或换一张边缘能对上的花型。",
};

/** 镜像排列的代价提示：它是验缝失败花型的诚实出路（构造性无缝），但翻转对称是真实的视觉代价。 */
const MIRROR_REPEAT_HINT = "镜像排列按构造无缝（无需验缝通过），但图案会上下左右翻转对称：含文字、人物侧脸或明显朝向的花型慎用。错位排列（半落/三落/错砖）的接缝风险与直排相同。";

/**
 * 平铺舞台的 ⓘ 说明：解释性长文收进悬停层按需展开（对齐套图工坊 BlockHead 的做法），
 * 排列与验缝各说各的，不再合成一段挤在舞台底部常驻占位。
 */
const REPEAT_INFO = "排列决定花型的重复摆放方式，不改动图稿本身。半落、三落、错砖以错位打散重复感，接缝风险与直排相同；镜像上下左右翻转图案、按构造无缝，验缝未通过也能满印。";
const TILE_CHECK_INFO = "验缝只判定、不改动图稿：比对左右边缘列与上下边缘行的差异，给出「可平铺 / 接缝明显」。满印品类需要可平铺花型，单区域印花（如 T 恤前片）不需要。";

/** ⓘ 说明入口：与 blockInfo 同款交互——悬停展开、cursor: help、焦点可见。 */
function TileInfo({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip title={hint}>
      <button type="button" className={styles.tileInfo} aria-label={`${label}说明`}>
        <Info size={13} strokeWidth={1.75} aria-hidden />
      </button>
    </Tooltip>
  );
}

/**
 * 花型工作区：/patterns/:patternId 全屏详情视图，取代旧的 420px 详情抽屉。
 * 预览舞台占主区（原图/平铺/规格包示意图都是舞台级大图）；右侧动作栏分两层——
 * 上层是主路径「成包流水线」（整栏唯一的 primary），下层「分步操作」默认收起，
 * 放单节的衍生/规格包/Listing 入口。名称、标签、尺寸、下载原图这些花型级信息在标题行。
 * 舞台下方版本栈以 parentPatternId 在前端回溯血缘。
 */
export function PatternWorkspacePage() {
  const { patternId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const patternsQuery = usePatterns();
  const specsQuery = usePodPrintSpecs();
  const patterns = useMemo(() => patternsQuery.data?.items ?? [], [patternsQuery.data]);
  const pattern = patterns.find((entry) => entry.id === patternId) ?? null;
  const specs = useMemo(() => specsQuery.data?.items ?? [], [specsQuery.data]);

  const viewParam = searchParams.get("view");
  const view: StageView = viewParam === "tile" || viewParam === "pack" ? viewParam : "artwork";
  const sectionParam = searchParams.get("section");
  const railRef = useRef<HTMLDivElement | null>(null);
  // 单步动作默认收在「分步操作」组里；这三节的深链要先展开再滚动，否则滚不到目标。
  const stepsSection = sectionParam === "derive" || sectionParam === "pack" || sectionParam === "listing";
  const [stepsOpen, setStepsOpen] = useState(false);

  const setView = (next: StageView) => {
    const params = new URLSearchParams(searchParams);
    params.delete("section");
    if (next === "artwork") params.delete("view");
    else params.set("view", next);
    setSearchParams(params, { replace: true });
  };

  useEffect(() => {
    if (stepsSection) setStepsOpen(true);
  }, [stepsSection]);

  // 花型墙 hover 快动作经 ?section= 直达动作栏对应节；等花型数据与布局就绪再滚动
  // （冷加载直达时骨架屏阶段 rail 尚未挂载，150ms 内滚不到），随后清参避免返回时重复滚动。
  const sectionReady = Boolean(pattern) && (!stepsSection || stepsOpen);
  useEffect(() => {
    if (!sectionParam || !sectionReady) return;
    const timer = window.setTimeout(() => {
      railRef.current?.querySelector(`[data-section="${sectionParam}"]`)?.scrollIntoView({ behavior: "instant", block: "start" });
      const params = new URLSearchParams(searchParams);
      params.delete("section");
      setSearchParams(params, { replace: true });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [sectionParam, sectionReady, searchParams, setSearchParams]);

  // 版本栈血缘：沿 parentPatternId 在已加载的花型列表里回溯祖先、收集直接子代，不需要专门端点。
  const lineage = useMemo(() => {
    if (!pattern) return { ancestors: [], descendants: [] };
    const byId = new Map(patterns.map((entry) => [entry.id, entry]));
    const seen = new Set<string>([pattern.id]);
    const ancestors: Pattern[] = [];
    let cursor = pattern.parentPatternId ? byId.get(pattern.parentPatternId) ?? null : null;
    while (cursor && !seen.has(cursor.id)) {
      ancestors.push(cursor);
      seen.add(cursor.id);
      cursor = cursor.parentPatternId ? byId.get(cursor.parentPatternId) ?? null : null;
    }
    return { ancestors: ancestors.reverse(), descendants: patterns.filter((entry) => entry.parentPatternId === pattern.id) };
  }, [patterns, pattern]);

  const deletePattern = useDeletePattern();

  if (patternsQuery.isPending) {
    return (
      <div className={styles.page}>
        <AppTopbar current="patterns" settingsOpen={settingsOpen} onSettingsOpenChange={setSettingsOpen} />
        <div className={styles.content}>
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      </div>
    );
  }

  if (!pattern) {
    return (
      <div className={styles.page}>
        <AppTopbar current="patterns" settingsOpen={settingsOpen} onSettingsOpenChange={setSettingsOpen} />
        <div className={styles.content}>
          <div className={styles.state}>
            <span>花型不存在或已被删除</span>
            <Button onClick={() => navigate("/patterns")}>返回花型墙</Button>
          </div>
        </div>
      </div>
    );
  }

  const lineageNodes = [...lineage.ancestors, pattern, ...lineage.descendants];
  const headerTileBadge = tileableBadge(pattern.tileable);

  return (
    <div className={styles.page}>
      <AppTopbar current="patterns" settingsOpen={settingsOpen} onSettingsOpenChange={setSettingsOpen} />
      <div className={styles.content}>
        <header className={styles.wsHeader}>
          <button type="button" className={styles.backLink} onClick={() => navigate("/patterns")}>
            <ArrowLeft size={15} strokeWidth={2} />
            花型墙
          </button>
          <span className={styles.headerDivider} aria-hidden />
          <h1 className={styles.wsTitle}>{pattern.name}</h1>
          <span className={styles.badge}>{SOURCE_LABELS[pattern.source]}</span>
          {headerTileBadge ? <span className={headerTileBadge.className}>{headerTileBadge.label}</span> : null}
          <span className={styles.wsMeta}>
            {pattern.width && pattern.height ? `${pattern.width}×${pattern.height} · ` : ""}
            {formatShortDate(pattern.createdAt)}
          </span>
          {/* 名称与标签是花型的身份信息，跟着标题走；原先是 rail 里的一整节，常态只显示"无标签"。 */}
          {pattern.tags.length > 0 ? (
            <span className={styles.wsTags} title={pattern.tags.join(" · ")}>
              {pattern.tags.join(" · ")}
            </span>
          ) : null}
          <div className={styles.wsActions}>
            {pattern.imageUrl ? (
              <Button size="small" icon={<Download size={13} strokeWidth={2} />} href={pattern.imageUrl} target="_blank">
                下载原图
              </Button>
            ) : null}
            <PatternMetaEditor pattern={pattern} />
            <Popconfirm
              title="删除花型"
              description="图稿、源图留痕与规格包记录将一并删除。"
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() => {
                deletePattern.mutate(pattern.id, {
                  onSuccess: () => {
                    void queryClient.invalidateQueries({ queryKey: qk.patterns });
                    message.success("花型已删除");
                    void navigate("/patterns");
                  },
                  onError: (error) => message.error(errorText(error)),
                });
              }}
            >
              <Button danger size="small" icon={<Trash2 size={13} strokeWidth={2} />}>
                删除
              </Button>
            </Popconfirm>
          </div>
        </header>

        {/* key=pattern.id：版本栈切换主体时重挂载各节，编辑草稿回到当前花型的初始值。 */}
        <div className={styles.wsMain} key={pattern.id}>
          <section className={styles.stage} aria-label="预览舞台">
            <div className={styles.stageTabs} role="tablist" aria-label="预览视图">
              {(Object.keys(VIEW_LABELS) as StageView[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={view === key}
                  className={view === key ? `${styles.stageTab} ${styles.stageTabActive}` : styles.stageTab}
                  onClick={() => setView(key)}
                >
                  {VIEW_LABELS[key]}
                </button>
              ))}
            </div>
            <div className={styles.stageCanvas}>
              {view === "artwork" ? <ArtworkStage pattern={pattern} /> : view === "tile" ? <TileStage pattern={pattern} /> : <PackStage pattern={pattern} specs={specs} />}
            </div>
          </section>

          {/*
            动作栏分两层：上层是主路径（成包流水线，整栏唯一的 primary 在这里），
            下层「分步操作」默认收起——一键成包已经覆盖同样的三步，并列摊开只会把
            "我该点哪个"变成用户的问题，而两条路产生的产物又不互通。
          */}
          <aside className={styles.rail} ref={railRef} aria-label="花型操作栏">
            <PatternPipelineSection pattern={pattern} specs={specs} />
            <section className={styles.railGroup}>
              <button
                type="button"
                className={stepsOpen ? `${styles.railGroupToggle} ${styles.railGroupToggleOpen}` : styles.railGroupToggle}
                aria-expanded={stepsOpen}
                onClick={() => setStepsOpen((open) => !open)}
              >
                <ChevronRight size={14} strokeWidth={2} className={styles.railGroupChevron} />
                分步操作
                <span className={styles.railGroupSummary}>衍生 · 规格包 · Listing</span>
              </button>
              {stepsOpen ? (
                <>
                  <DeriveSection pattern={pattern} onDerived={(derivedId) => navigate(`/patterns/${derivedId}`)} />
                  <PackSection pattern={pattern} specs={specs} onQueued={() => setView("pack")} />
                  <ListingSection pattern={pattern} />
                </>
              ) : null}
            </section>
          </aside>
        </div>

        {lineageNodes.length > 1 ? (
          <footer className={styles.lineageStrip} aria-label="版本栈">
            <span className={styles.lineageLabel}>版本栈</span>
            {lineageNodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={node.id === pattern.id ? `${styles.lineageNode} ${styles.lineageNodeCurrent}` : styles.lineageNode}
                title={node.name}
                aria-label={node.id === pattern.id ? `当前：${node.name}` : `切换到 ${node.name}`}
                onClick={() => navigate(`/patterns/${node.id}${view === "artwork" ? "" : `?view=${view}`}`)}
              >
                {node.thumbUrl ?? node.imageUrl ? (
                  <img src={node.thumbUrl ?? node.imageUrl} alt="" loading="lazy" />
                ) : (
                  <span className={styles.lineageNodeEmpty} style={{ backgroundImage: panelBackdrop }} />
                )}
              </button>
            ))}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/** 原图舞台：棋盘格衬底 contain 显示，点击进 antd 灯箱看大图。 */
function ArtworkStage({ pattern }: { pattern: Pattern }) {
  if (!pattern.imageUrl) {
    return (
      <div className={styles.stageEmpty} style={{ backgroundImage: panelBackdrop }}>
        该花型暂无图稿
      </div>
    );
  }
  return (
    <div className={styles.stageChecker}>
      <Image src={pattern.imageUrl} alt={pattern.name} className={styles.stageImg} preview={{ mask: <span className={styles.stageMask}>点击放大</span> }} />
    </div>
  );
}

/**
 * 平铺舞台：按平铺排列满铺预览 + 排列切换 + 平铺尺寸滑杆，观察拼接是否连贯。
 *
 * 预览复用 `TiledPatternStage`（与起稿工作台、成包几何共用 REPEAT_UNIT_PLACEMENTS 唯一真相源），
 * 越界摆放位额外画 -1 单元偏移的副本，让裁掉的部分从对侧补回——这正是"单元无缝"的构造方式，
 * 预览与成包产物因此所见即所得。纯矢量无 canvas 库，切换零请求零费用。
 *
 * 验缝入口在这里而不是动作栏：判定只在"整块连续印花"的语境下才有意义，而这个舞台就是那个语境。
 * 判定是花型内容的确定性函数，所以当判定已按当前算法版本算出时不再提供按钮——重跑只会得到同一
 * 结果；只有未验过或算法版本已升级（旧判定过期）时才需要重算。
 */
function TileStage({ pattern }: { pattern: Pattern }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const createCheck = useCreatePatternTileCheckJob();
  const [tileSize, setTileSize] = useState(160);
  const [repeatLayout, setRepeatLayout] = useState<PodRepeatLayout>("STRAIGHT");
  const [checkJobId, setCheckJobId] = useState<string | null>(null);
  const checkJob = useJobStatus(checkJobId ?? undefined);
  const badge = tileableBadge(pattern.tileable);
  const stale = pattern.tileable !== "NONE" && pattern.tileableCheckedWith !== TILEABILITY_ALGORITHM_VERSION;

  // 验缝终态结算：失败如实报错撤卡；成功失效花型列表让徽标与分数刷新。
  useEffect(() => {
    if (!checkJobId || !checkJob.data) return;
    const status = checkJob.data.status;
    if (status === "FAILED" || status === "CANCELLED") {
      message.error(jobErrorText(checkJob.data) ?? "验缝失败");
      setCheckJobId(null);
      return;
    }
    if (status === "SUCCEEDED") {
      void queryClient.invalidateQueries({ queryKey: qk.patterns });
      setCheckJobId(null);
    }
  }, [checkJobId, checkJob.data, message, queryClient]);

  if (!pattern.imageUrl) {
    return (
      <div className={styles.stageEmpty} style={{ backgroundImage: panelBackdrop }}>
        该花型暂无图稿
      </div>
    );
  }
  const running = createCheck.isPending || (checkJob.data ? checkJob.data.status === "QUEUED" || checkJob.data.status === "RUNNING" : false);
  return (
    <div className={styles.tileStageWrap}>
      <div className={styles.tileStage}>
        <TiledPatternStage imageUrl={pattern.imageUrl} layout={repeatLayout} tileSize={tileSize} className={styles.tileStageSvg} />
      </div>
      <div className={styles.tileControls}>
        <span className={styles.tileControlsLabel}>排列</span>
        <RepeatLayoutChipRow value={repeatLayout} onChange={setRepeatLayout} variant="rail" ariaLabel="平铺排列" />
        <TileInfo label="排列" hint={REPEAT_INFO} />
      </div>
      <div className={styles.tileControls}>
        <span className={styles.tileControlsLabel}>平铺尺寸</span>
        <Slider
          min={80}
          max={480}
          value={tileSize}
          onChange={setTileSize}
          aria-label="平铺尺寸"
          style={{ width: 220 }}
          tooltip={{ formatter: (value) => `${value}px` }}
        />
      </div>
      <div className={styles.tileControls}>
        {badge ? <span className={badge.className}>{badge.label}</span> : <span className={styles.tileControlsLabel}>未验缝</span>}
        {pattern.tileableScore !== null && pattern.tileableScore !== undefined ? (
          <span className={styles.tileControlsLabel}>中缝相似度 {Math.round(pattern.tileableScore * 100)}%</span>
        ) : null}
        {pattern.tileable === "NONE" || stale ? (
          <Button
            size="small"
            loading={running}
            onClick={() =>
              createCheck.mutate(
                { patternId: pattern.id },
                {
                  onSuccess: ({ job }) => setCheckJobId(job.id),
                  onError: (error) => message.error(errorText(error)),
                },
              )
            }
          >
            {stale ? "按当前算法重算" : "验缝"}
          </Button>
        ) : null}
        <TileInfo label="验缝" hint={TILE_CHECK_INFO} />
      </div>
    </div>
  );
}

/** 规格包舞台：大幅示意图为主角，规格包以 chips 切换，下方下载三件套。 */
function PackStage({ pattern, specs }: { pattern: Pattern; specs: PodPrintSpec[] }) {
  const packsQuery = usePatternPrintPacks(pattern.id);
  const [activeId, setActiveId] = useState<string | null>(null);
  const packs = packsQuery.data?.items ?? [];
  const succeeded = packs.filter((pack) => pack.status === "SUCCEEDED");
  const running = packs.some((pack) => pack.status === "QUEUED" || pack.status === "RUNNING");
  const specLabel = useMemo(() => new Map(specs.map((spec) => [spec.id, spec.label])), [specs]);

  const active = succeeded.find((pack) => pack.id === activeId) ?? succeeded[0] ?? null;
  if (succeeded.length === 0) {
    return (
      <div className={styles.stageEmpty}>
        <Package size={28} strokeWidth={1.5} />
        <p>{running ? "规格包生成中，完成后示意图会出现在这里" : "还没有规格包"}</p>
        <p className={styles.stageEmptyHint}>在右侧「规格包」选择品类与版式，300DPI 投产图稿与示意图会出现在这里。</p>
      </div>
    );
  }
  const mockup = active?.files.find((file) => file.kind === "MOCKUP");
  const printFile = active?.files.find((file) => file.kind === "PRINT_FILE");
  const seamlessTile = active?.files.find((file) => file.kind === "SEAMLESS_TILE");
  const manifest = active?.files.find((file) => file.kind === "MANIFEST");
  const label = active ? specLabel.get(active.specId) ?? active.specId : "";
  return (
    <div className={styles.packStage}>
      <div className={styles.packChips} role="group" aria-label="规格包">
        {succeeded.map((pack) => (
          <button
            key={pack.id}
            type="button"
            className={pack.id === active?.id ? `${styles.wsChip} ${styles.wsChipActive}` : styles.wsChip}
            onClick={() => setActiveId(pack.id)}
          >
            {specLabel.get(pack.specId) ?? pack.specId}
          </button>
        ))}
        {running ? <span className={styles.packRunningChip}>生成中…</span> : null}
      </div>
      <div className={styles.packArtwork}>{mockup ? <img src={mockup.url} alt={`${label} 示意图`} /> : null}</div>
      <div className={styles.packDownloads}>
        {printFile ? (
          <Button size="small" icon={<Download size={12} strokeWidth={2} />} href={printFile.url} target="_blank">
            下载图稿（300DPI）
          </Button>
        ) : null}
        {mockup ? (
          <Button size="small" icon={<Download size={12} strokeWidth={2} />} href={mockup.url} target="_blank">
            下载示意图
          </Button>
        ) : null}
        {seamlessTile ? (
          <Button size="small" icon={<Download size={12} strokeWidth={2} />} href={seamlessTile.url} target="_blank">
            下载无缝单元
          </Button>
        ) : null}
        {manifest ? (
          <Button size="small" icon={<Download size={12} strokeWidth={2} />} href={manifest.url} target="_blank">
            manifest.json
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 名称与标签的编辑入口：挂在标题行，不再占 rail 的一节。
 * 草稿在每次打开时从当前花型重置——否则切换版本栈后弹层里还是上一个花型的名字。
 */
function PatternMetaEditor({ pattern }: { pattern: Pattern }) {
  const { message } = App.useApp();
  const updatePattern = useUpdatePattern();
  const patternsQuery = usePatterns();
  const [open, setOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(pattern.name);
  const [tagsDraft, setTagsDraft] = useState<string[]>(pattern.tags);
  const allTags = useMemo(() => Array.from(new Set((patternsQuery.data?.items ?? []).flatMap((entry) => entry.tags))).sort(), [patternsQuery.data]);

  const saveEdits = () => {
    if (!nameDraft.trim()) {
      message.warning("名称不能为空");
      return;
    }
    updatePattern.mutate(
      { patternId: pattern.id, body: { name: nameDraft.trim(), tags: tagsDraft } },
      {
        onSuccess: () => {
          message.success("已保存");
          setOpen(false);
        },
        onError: (error) => message.error(errorText(error)),
      },
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setNameDraft(pattern.name);
          setTagsDraft(pattern.tags);
        }
        setOpen(next);
      }}
      trigger="click"
      placement="bottomRight"
      title="名称与标签"
      content={
        <div className={styles.metaEditor}>
          <Input size="small" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} aria-label="花型名称" />
          <Select
            size="small"
            mode="tags"
            value={tagsDraft}
            onChange={setTagsDraft}
            aria-label="花型标签"
            placeholder="标签（回车添加）"
            style={{ width: "100%" }}
            options={allTags.map((tag) => ({ value: tag, label: tag }))}
            tokenSeparators={[","]}
          />
          <div className={styles.formRow}>
            <Button size="small" type="primary" loading={updatePattern.isPending} onClick={saveEdits}>
              保存
            </Button>
            <Button size="small" onClick={() => setOpen(false)}>
              取消
            </Button>
          </div>
        </div>
      }
    >
      <Button size="small" icon={<Pencil size={13} strokeWidth={2} />}>
        编辑
      </Button>
    </Popover>
  );
}

/** 各轴向的缺省预设；切轴向时重置，避免把上一条轴的预设提交成不匹配的组合。 */
const AXIS_DEFAULT_PRESET: Record<PatternVariantAxis, PatternVariantPreset> = { STYLE: "WATERCOLOR", COMPOSITION: "SCATTER" };

/**
 * 衍生节：两条路径的成本口径完全不同，所以分块并各自标注——
 * 「改色」是本地确定性运算（零费用），「画风 / 构图」会调用生图模型（按候选计费）。
 * 混在一起而不标注，用户就无从知道哪一次点击会产生费用。
 */
function DeriveSection({ pattern, onDerived }: { pattern: Pattern; onDerived: (derivedId: string) => void }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const createDerive = useCreatePatternDeriveJob();
  const createVariant = useCreatePatternVariantJob();
  // 两类任务共用一条"在途任务"槽位：花型工作区一次只推进一个衍生，同时开两条只会让进度文案互相覆盖。
  const [pending, setPending] = useState<{ id: string; kind: "DERIVE" | "VARIANT" } | null>(null);
  const pendingJob = useJobStatus(pending?.id);
  const patternsQuery = usePatterns();
  const derivedPattern = useMemo(
    () => (patternsQuery.data?.items ?? []).find((entry) => entry.sourceJobId === pending?.id) ?? null,
    [patternsQuery.data, pending],
  );
  const [hueShift, setHueShift] = useState(0);
  const [saturationPct, setSaturationPct] = useState(100);
  const [brightnessPct, setBrightnessPct] = useState(100);
  const [axis, setAxis] = useState<PatternVariantAxis>("STYLE");
  const [preset, setPreset] = useState<PatternVariantPreset>(AXIS_DEFAULT_PRESET.STYLE);
  const [extra, setExtra] = useState("");
  const [candidateCount, setCandidateCount] = useState(1);
  const [variantModelKey, setVariantModelKey] = useState<string | null>(null);
  const providersQuery = useProviders();
  // 底版缺省"跟随源图"：源透明就保住透明底，源有底色就保留底色。这是最不容易出错的一档——
  // 替用户改底（以前是自动的）会把源花型的透明底换成白底，那种降级在预览里几乎看不出来。
  const [background, setBackground] = useState<PatternBackgroundMode>("SOURCE");
  const variantModel = useMemo(
    () => modelOptions(providersQuery.data?.items ?? [], "image").find((option) => option.value === variantModelKey),
    [providersQuery.data, variantModelKey],
  );

  // 衍生任务终态结算：失败报错撤卡；成功失效列表让版本栈长出新节点。
  useEffect(() => {
    if (!pending || !pendingJob.data) return;
    const status = pendingJob.data.status;
    if (status === "FAILED" || status === "CANCELLED") {
      message.error(jobErrorText(pendingJob.data) ?? "衍生失败");
      setPending(null);
    }
    if (status === "SUCCEEDED") void queryClient.invalidateQueries({ queryKey: qk.patterns });
  }, [pending, pendingJob.data, message, queryClient]);

  const running = createDerive.isPending
    || createVariant.isPending
    || (pendingJob.data ? pendingJob.data.status === "QUEUED" || pendingJob.data.status === "RUNNING" : false);

  const startDerive = (body: { hueShift?: number; saturationPct?: number; brightnessPct?: number }) => {
    createDerive.mutate(
      { patternId: pattern.id, body },
      {
        onSuccess: ({ job, reused }) => {
          if (reused) message.info("相同参数的任务已存在，已为你复用");
          setPending({ id: job.id, kind: "DERIVE" });
        },
        onError: (error) => message.error(errorText(error)),
      },
    );
  };

  const startVariant = () => {
    if (!variantModelKey) {
      message.warning("请选择生图模型");
      return;
    }
    const { providerId, modelId } = parseModelKey(variantModelKey);
    createVariant.mutate(
      {
        patternId: pattern.id,
        body: {
          providerId,
          imageModelId: modelId,
          axis,
          preset,
          ...(extra.trim() ? { extra: extra.trim() } : {}),
          background,
          candidateCount,
        },
      },
      {
        onSuccess: ({ job, reused }) => {
          if (reused) message.info("相同参数的任务已存在，已为你复用");
          setPending({ id: job.id, kind: "VARIANT" });
        },
        onError: (error) => message.error(errorText(error)),
      },
    );
  };

  return (
    <section className={styles.wsSection} data-section="derive">
      <SectionHead title="衍生" status={running ? <StatusPill tone="busy">进行中</StatusPill> : null} />
      <p className={styles.wsHint}>产物都是新花型（血缘指向当前花型），当前花型不会被改动。</p>

      <div className={styles.wsSubHead}>
        <h4 className={styles.wsSubTitle}>改色</h4>
        <StatusPill tone="neutral">本地 · 0 费用</StatusPill>
      </div>
      <div className={styles.sliderBlock}>
        <span className={styles.sliderLabel}>色相 {hueShift}°</span>
        <Slider min={-180} max={180} value={hueShift} onChange={setHueShift} aria-label="色相" />
      </div>
      <div className={styles.sliderBlock}>
        <span className={styles.sliderLabel}>饱和 {saturationPct}%</span>
        <Slider min={0} max={300} value={saturationPct} onChange={setSaturationPct} aria-label="饱和度" />
      </div>
      <div className={styles.sliderBlock}>
        <span className={styles.sliderLabel}>亮度 {brightnessPct}%</span>
        <Slider min={10} max={300} value={brightnessPct} onChange={setBrightnessPct} aria-label="亮度" />
      </div>
      <div className={styles.formCol}>
        <Button block disabled={running} onClick={() => startDerive({ hueShift, saturationPct, brightnessPct })}>
          改色
        </Button>
      </div>

      <div className={styles.wsSubHead}>
        <h4 className={styles.wsSubTitle}>画风 / 构图</h4>
        {/* 成本前置：候选数 × 1 是真实可计算的调用次数，不写金额也不假装能预估单价。 */}
        <StatusPill tone="neutral" title="每个候选 1 次调用；不写金额，也不假装能预估单价">
          {candidateCount} 次生图调用
        </StatusPill>
      </div>
      <p className={styles.wsHint}>以当前花型为参考图改写；用于铺款筛选，不承诺风格一致。</p>
      <div className={styles.wsChipRow} role="group" aria-label="衍生轴向">
        {(Object.keys(AXIS_DEFAULT_PRESET) as PatternVariantAxis[]).map((option) => (
          <button
            key={option}
            type="button"
            className={axis === option ? `${styles.wsChip} ${styles.wsChipActive}` : styles.wsChip}
            onClick={() => {
              setAxis(option);
              setPreset(AXIS_DEFAULT_PRESET[option]);
            }}
          >
            {PATTERN_VARIANT_AXIS_LABELS[option]}
          </button>
        ))}
      </div>
      <div className={styles.wsChipRow} role="group" aria-label="衍生预设">
        {PATTERN_VARIANT_PRESETS[axis].map((option) => (
          <button
            key={option}
            type="button"
            className={preset === option ? `${styles.wsChip} ${styles.wsChipActive}` : styles.wsChip}
            onClick={() => setPreset(option)}
          >
            {PATTERN_VARIANT_PRESET_LABELS[option]}
          </button>
        ))}
      </div>
      <div className={styles.formCol}>
        <ImageModelSelect size="small" value={variantModelKey} onChange={setVariantModelKey} storageKey="ecomgen.patterns.variantModel" label="生图模型" />
        <BackgroundModeSelect
          size="small"
          value={background}
          onChange={setBackground}
          modes={VARIANT_BACKGROUND_MODES}
          fallback="SOURCE"
          transparentAvailable={Boolean(variantModel?.transparentBackground)}
        />
        <Input size="small" placeholder="补充描述（可选）" value={extra} maxLength={60} onChange={(event) => setExtra(event.target.value)} aria-label="衍生补充描述" />
        <Select
          size="small"
          style={{ width: "100%" }}
          aria-label="候选张数"
          value={candidateCount}
          onChange={setCandidateCount}
          options={Array.from({ length: PATTERN_VARIANT_CANDIDATES_MAX }, (_unused, index) => ({ value: index + 1, label: `${index + 1} 张候选` }))}
        />
        <Button block disabled={running} onClick={startVariant}>
          生成变体
        </Button>
      </div>

      {running && pending ? (
        <div className={styles.deriveProgress}>
          <Progress size="small" percent={pendingJob.data?.progress ?? 0} status="active" />
          <span className={styles.wsHint}>{stageText(pending.kind, pendingJob.data?.status ?? "QUEUED", pendingJob.data?.progress ?? 0)}</span>
        </div>
      ) : null}
      {derivedPattern && !running ? (
        <Button size="small" type="primary" onClick={() => onDerived(derivedPattern.id)}>
          查看新花型「{derivedPattern.name}」
        </Button>
      ) : null}
    </section>
  );
}

/** 规格包节：版式 + 规格入队；成功后舞台自动切到「规格包」视图展示大幅示意图。 */
function PackSection({ pattern, specs, onQueued }: { pattern: Pattern; specs: PodPrintSpec[]; onQueued: () => void }) {
  const { message } = App.useApp();
  const createPack = useCreatePrintPackJob();
  const packsQuery = usePatternPrintPacks(pattern.id);
  const [specId, setSpecId] = useState<string | null>(null);
  const [layout, setLayout] = useState<PodPrintLayout>("CENTERED");
  const [repeatLayout, setRepeatLayout] = useState<PodRepeatLayout>("STRAIGHT");
  const packs = packsQuery.data?.items ?? [];
  const packRunning = packs.some((pack) => pack.status === "QUEUED" || pack.status === "RUNNING");
  const packFailed = packs.some((pack) => pack.status === "FAILED");
  const packDone = packs.filter((pack) => pack.status === "SUCCEEDED").length;
  // 节标题上的状态：把"这一节跑完了没有"提到不必滚进来的位置。
  const packStatus = packRunning ? (
    <StatusPill tone="busy">进行中</StatusPill>
  ) : packFailed ? (
    <StatusPill tone="failed">有失败</StatusPill>
  ) : packDone > 0 ? (
    <StatusPill tone="ok">已完成 {packDone}</StatusPill>
  ) : null;

  return (
    <section className={styles.wsSection} data-section="pack">
      <SectionHead title="规格包" status={packStatus} />
      <p className={styles.wsHint}>300DPI 投产图稿，像素只来自你的花型。</p>
      <LayoutChipRow value={layout} onChange={setLayout} variant="rail" />
      {layout === "TILE" ? (
        <>
          <RepeatLayoutChipRow value={repeatLayout} onChange={setRepeatLayout} variant="rail" ariaLabel="平铺排列" />
          <p className={styles.wsHint}>{repeatLayout === "MIRROR" ? MIRROR_REPEAT_HINT : TILE_LAYOUT_HINTS[pattern.tileable]}</p>
        </>
      ) : null}
      <div className={styles.formCol}>
        <Select
          size="small"
          style={{ width: "100%" }}
          placeholder="品类规格"
          aria-label="品类规格"
          value={specId}
          onChange={setSpecId}
          options={specs.map((spec) => ({ value: spec.id, label: podSpecOptionLabel(spec) }))}
        />
        <Button
          block
          disabled={!specId}
          loading={createPack.isPending || packRunning}
          onClick={() => {
            if (!specId) return;
            createPack.mutate(
              { patternId: pattern.id, body: { specId, layout, ...(layout === "TILE" ? { repeatLayout } : {}) } },
              {
                onSuccess: ({ reused }) => {
                  if (reused) message.info("相同规格与版式的规格包已存在，已为你复用");
                  onQueued();
                },
                onError: (error) => message.error(errorText(error)),
              },
            );
          }}
        >
          成规格包
        </Button>
      </div>
    </section>
  );
}

/**
 * Listing 文案节：看图写跨境文案（模型/平台/卖点/禁用词 + 结果复制行）。
 * 原图下载搬到标题行——它是花型级动作，不依赖这里的任何参数，放在需要填表的节里反而像前置步骤。
 */
function ListingSection({ pattern }: { pattern: Pattern }) {
  const { message } = App.useApp();
  const createListing = useCreatePatternListingJob();
  const [platform, setPlatform] = useState<ListingPlatform>("ETSY");
  const [sellingPoints, setSellingPoints] = useState("");
  const [bannedWords, setBannedWords] = useState("");
  const [listingModelKey, setListingModelKey] = useState<string | null>(null);
  const [listingJobId, setListingJobId] = useState<string | null>(null);
  const listingJob = useJobStatus(listingJobId ?? undefined);
  const listingResult = usePatternListingResult(pattern.id, listingJobId ?? undefined, listingJob.data?.status === "SUCCEEDED");
  const listingRunning = listingJob.data ? listingJob.data.status === "QUEUED" || listingJob.data.status === "RUNNING" : false;
  // 文案没有"最近一次"可查（结果按任务 id 取），所以只在本次会话里发过任务时才显示状态。
  const listingStatus = listingJob.data ? <StatusPill tone={statusTone(listingJob.data.status)}>{statusLabel(listingJob.data.status)}</StatusPill> : null;

  const submitListing = () => {
    if (!listingModelKey) {
      message.warning("请选择推理模型（需支持视觉）");
      return;
    }
    const { providerId, modelId } = parseModelKey(listingModelKey);
    createListing.mutate(
      {
        patternId: pattern.id,
        body: {
          providerId,
          modelId,
          platform,
          ...(sellingPoints.trim() ? { sellingPoints: sellingPoints.trim() } : {}),
          ...(bannedWords.trim() ? { bannedWords: bannedWords.trim() } : {}),
        },
      },
      {
        onSuccess: ({ job, reused }) => {
          if (reused) message.info("相同输入的文案已存在；改任意一个输入即可重新生成");
          setListingJobId(job.id);
        },
        onError: (error) => message.error(errorText(error)),
      },
    );
  };

  return (
    <section className={styles.wsSection} data-section="listing">
      <SectionHead title="Listing 文案" status={listingStatus} />
      <div className={styles.formCol}>
        <p className={styles.wsHint}>平台字数是硬校验，超限自动重写一次。</p>
        <ListingModelSelect size="small" value={listingModelKey} onChange={setListingModelKey} />
        <Select size="small" style={{ width: "100%" }} aria-label="目标平台" value={platform} onChange={setPlatform} options={LISTING_PLATFORM_OPTIONS} />
        <Input.TextArea
          rows={2}
          placeholder="卖点补充（可选），例如：适合送礼、夏季穿搭"
          value={sellingPoints}
          onChange={(event) => setSellingPoints(event.target.value)}
        />
        <Input size="small" placeholder="禁用词（可选），例如品牌名、角色名" value={bannedWords} onChange={(event) => setBannedWords(event.target.value)} />
        <Button block loading={createListing.isPending || listingRunning} onClick={submitListing}>
          生成文案
        </Button>
      </div>
      {listingJob.data?.status === "FAILED" ? <p className={styles.pipelineError}>{jobErrorText(listingJob.data) ?? "文案任务失败"}</p> : null}
      {listingResult.data ? (
        <div className={styles.copyBlock}>
          <CopyRow label="标题" value={listingResult.data.copy.title} />
          {listingResult.data.copy.tags.length > 0 ? <CopyRow label="Tags" value={listingResult.data.copy.tags.join(", ")} /> : null}
          {listingResult.data.copy.bullets.length > 0 ? (
            <CopyRow
              label="要点"
              value={listingResult.data.copy.bullets.map((bullet, index) => `${index + 1}. ${bullet}`).join("\n")}
            />
          ) : null}
          <CopyRow label="描述" value={listingResult.data.copy.description} />
        </div>
      ) : null}
    </section>
  );
}
