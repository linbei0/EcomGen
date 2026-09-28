import { App, Button, DatePicker, Empty, Image, Input, Segmented, Select, Skeleton, Tag } from "antd";
import { Check, Download, LibraryBig, RefreshCw, Search } from "lucide-react";
import { motion } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  LIBRARY_KIND_OPTIONS,
  hasActiveLibraryFilters,
  libraryFilterScope,
  type LibraryItem,
  type LibraryKindFilter,
} from "../../api/adapters/library";
import { useCopyLibraryAssetToProject, useLibraryItems } from "../../api/hooks/useLibrary";
import { useProjects } from "../../api/hooks/useProjects";
import { AppTopbar } from "../../components/AppTopbar";
import { fadeUp, staggerContainer } from "../../design/motion";
import { errorText } from "../../lib/errorText";
import { dayRangeBounds, formatShortDate } from "../../lib/format";
import { MODEL_IDENTITY_FILTERS, type ModelIdentityFilters, type ModelIdentityKey } from "../../lib/modelIdentityFilters";
import styles from "./LibraryPage.module.css";

const { RangePicker } = DatePicker;

/** 日期范围控件的受控值类型：antd 内部用 dayjs，应用不直接依赖它，因此从属性类型反推。 */
type LibraryDateRange = Parameters<NonNullable<React.ComponentProps<typeof RangePicker>["onChange"]>>[0];

function badgeLabel(source: string, kind: string): string {
  if (kind === "LAYER") return "分层";
  if (kind === "MODEL") return "模特";
  if (source === "GENERATED") return "生成";
  return kind === "PRODUCT" ? "商品" : "参考";
}

interface LibraryCardProps {
  item: LibraryItem;
  selected: boolean;
  onToggle: (itemId: string) => void;
}

// 卡片独立 memo：分页追加与选中变化只重渲染受影响的卡片，长列表滚动更稳。
const LibraryCard = memo(function LibraryCard({ item, selected, onToggle }: LibraryCardProps) {
  return (
    <article className={styles.card} data-selected={selected}>
      <div className={styles.thumbWrap}>
        <Image
          src={item.thumbnailUrl}
          alt={item.name}
          preview={{ src: item.url, mask: "查看" }}
          className={styles.thumb}
          loading="lazy"
        />
        <button
          type="button"
          className={styles.check}
          aria-pressed={selected}
          aria-label={selected ? `取消选择 ${item.name}` : `选择 ${item.name}`}
          onClick={() => onToggle(item.id)}
        >
          <Check size={14} strokeWidth={2.5} />
        </button>
        <a className={styles.download} href={item.url} download aria-label={`下载 ${item.name}`}>
          <Download size={14} strokeWidth={1.75} />
        </a>
      </div>
      <div className={styles.meta}>
        <p className={styles.name} title={item.name}>
          {item.name}
        </p>
        <div className={styles.metaBottom}>
          <span className={styles.badge}>{badgeLabel(item.source, item.kind)}</span>
          <span className={styles.sub} title={item.projectName}>
            {item.projectName} · {formatShortDate(item.createdAt)}
          </span>
        </div>
      </div>
    </article>
  );
});

export function LibraryPage() {
  const { notification } = App.useApp();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [kind, setKind] = useState<LibraryKindFilter>("ALL");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<LibraryDateRange>(null);
  const [modelIdentity, setModelIdentity] = useState<ModelIdentityFilters>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetProjectId, setTargetProjectId] = useState<string>();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const copy = useCopyLibraryAssetToProject();
  const projects = useProjects();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const scope = libraryFilterScope(kind);
  const timeBounds = useMemo(() => dayRangeBounds(dateRange?.[0]?.valueOf(), dateRange?.[1]?.valueOf()), [dateRange]);
  const filters = useMemo(
    () => ({ kind, q: query, projectId, createdFrom: timeBounds.createdFrom, createdTo: timeBounds.createdTo, modelIdentity }),
    [kind, query, projectId, timeBounds, modelIdentity],
  );
  const library = useLibraryItems(filters);
  const items = useMemo(() => library.data?.pages.flatMap((page) => page.items) ?? [], [library.data]);
  // 总数取服务端首个分页的筛选后总数，不随已加载页增长，避免“40 张跳 100 张”。
  const total = library.data?.pages[0]?.total ?? 0;
  const projectItems = projects.data?.items ?? [];
  const filterActive = hasActiveLibraryFilters(filters);

  // 筛选变化后旧的选中项可能已不在列表里，清空避免误加。
  useEffect(() => {
    setSelected(new Set());
  }, [filters]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && library.hasNextPage && !library.isFetchingNextPage) {
          void library.fetchNextPage();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [library.hasNextPage, library.isFetchingNextPage, library.fetchNextPage]);

  const toggle = useCallback((itemId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  // 与当前类型无关的维度直接清空：保留取值只会让用户以为筛选仍然生效。
  const changeKind = (value: LibraryKindFilter) => {
    const next = libraryFilterScope(value);
    setKind(value);
    if (!next.project) setProjectId(null);
    if (!next.identity) setModelIdentity({});
  };

  const setIdentityFilter = (key: ModelIdentityKey, value: string | null) => {
    setModelIdentity((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  };

  const clearFilters = () => {
    setKind("ALL");
    setSearch("");
    setQuery("");
    setProjectId(null);
    setDateRange(null);
    setModelIdentity({});
  };

  const addSelected = async () => {
    if (!targetProjectId || selected.size === 0) return;
    const byId = new Map(items.map((item) => [item.id, item]));
    let succeeded = 0;
    let failed = 0;
    let firstError = "";
    for (const itemId of selected) {
      const item = byId.get(itemId);
      if (!item) continue;
      try {
        await copy.mutateAsync({
          projectId: targetProjectId,
          itemId,
          kind: item.kind === "GENERATED" || item.kind === "LAYER" || item.kind === "MODEL" ? "REFERENCE" : item.kind,
        });
        succeeded += 1;
      } catch (error: unknown) {
        failed += 1;
        if (!firstError) firstError = errorText(error);
      }
    }
    const targetName = projectItems.find((project) => project.id === targetProjectId)?.name ?? "项目";
    if (succeeded > 0) {
      notification.success({ title: `已添加 ${succeeded} 张到「${targetName}」` });
      setSelected(new Set());
    }
    if (failed > 0) {
      notification.error({ title: `${failed} 张添加失败`, description: firstError });
    }
  };

  const showInitialLoading = library.isLoading;
  const showError = library.isError;
  const sourceProjectName = projectItems.find((project) => project.id === projectId)?.name ?? "已选项目";
  // 日期范围允许只选一端，回显标签要能表达「区间」「起」「止」三种状态。
  const rangeStart = dateRange?.[0] ?? null;
  const rangeEnd = dateRange?.[1] ?? null;
  const timeLabel = rangeStart && rangeEnd
    ? `${rangeStart.format("YYYY-MM-DD")} ~ ${rangeEnd.format("YYYY-MM-DD")}`
    : rangeStart
      ? `${rangeStart.format("YYYY-MM-DD")} 起`
      : rangeEnd
        ? `${rangeEnd.format("YYYY-MM-DD")} 止`
        : "";

  return (
    <div className={styles.page}>
      <AppTopbar current="library" settingsOpen={settingsOpen} onSettingsOpenChange={setSettingsOpen} />

      <motion.main className={styles.main} variants={staggerContainer} initial="hidden" animate="visible">
        <motion.div className={styles.head} variants={fadeUp}>
          <div>
            <h1 className={styles.title}>资产库</h1>
            <p className={styles.subtitle}>
              {library.isPending
                ? "正在读取素材…"
                : filterActive
                  ? `筛选后 ${total} 张`
                  : `共 ${total} 张 · 覆盖上传素材、生成结果与模特定妆照`}
            </p>
          </div>
          <Button
            icon={<RefreshCw size={15} strokeWidth={1.75} />}
            onClick={() => void library.refetch()}
            loading={library.isRefetching}
          >
            刷新
          </Button>
        </motion.div>

        <motion.div className={styles.toolbar} variants={fadeUp}>
          <div className={styles.typeRow}>
            <Segmented
              options={LIBRARY_KIND_OPTIONS}
              value={kind}
              onChange={(value) => changeKind(value as LibraryKindFilter)}
            />
          </div>
          <div className={styles.filterRow}>
            <Input
              allowClear
              className={styles.search}
              prefix={<Search size={15} strokeWidth={1.75} aria-hidden />}
              placeholder="搜索名称或项目"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="搜索资产库"
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              className={styles.projectSelect}
              placeholder={scope.project ? "全部项目" : "定妆照不属于项目"}
              aria-label="按来源项目筛选"
              value={projectId ?? undefined}
              onChange={(value) => setProjectId(value ?? null)}
              options={projectItems.map((project) => ({ label: project.name, value: project.id }))}
              loading={projects.isPending}
              disabled={!scope.project}
            />
            <RangePicker
              allowClear
              className={styles.dateSelect}
              value={dateRange}
              onChange={setDateRange}
              placeholder={["开始日期", "结束日期"]}
              aria-label="按创建时间筛选"
            />
          </div>
        </motion.div>

        {/* 身份维度查的是模特实体的规格，只对定妆照成立：切到其他类型时隐藏并清空。 */}
        {scope.identity ? (
          <motion.div className={styles.identityRow} variants={fadeUp}>
            {MODEL_IDENTITY_FILTERS.map((filter) => (
              <Select
                key={filter.key}
                allowClear
                className={styles.filterSelect}
                placeholder={filter.label}
                aria-label={filter.label}
                value={modelIdentity[filter.key]}
                onChange={(value) => setIdentityFilter(filter.key, value ?? null)}
                options={filter.options}
                popupMatchSelectWidth={false}
              />
            ))}
          </motion.div>
        ) : null}

        {filterActive ? (
          <div className={styles.chips}>
            {kind !== "ALL" ? (
              <Tag closable onClose={() => changeKind("ALL")}>
                类型：{LIBRARY_KIND_OPTIONS.find((option) => option.value === kind)?.label}
              </Tag>
            ) : null}
            {query.trim() ? <Tag closable onClose={() => { setSearch(""); setQuery(""); }}>关键词：{query.trim()}</Tag> : null}
            {projectId ? <Tag closable onClose={() => setProjectId(null)}>项目：{sourceProjectName}</Tag> : null}
            {rangeStart || rangeEnd ? <Tag closable onClose={() => setDateRange(null)}>时间：{timeLabel}</Tag> : null}
            {MODEL_IDENTITY_FILTERS.filter((filter) => modelIdentity[filter.key]).map((filter) => (
              <Tag key={filter.key} closable onClose={() => setIdentityFilter(filter.key, null)}>
                {filter.label}：{filter.options.find((option) => option.value === modelIdentity[filter.key])?.label}
              </Tag>
            ))}
            <Button type="link" size="small" onClick={clearFilters}>
              清空筛选
            </Button>
          </div>
        ) : null}

        {showError ? (
          <div className={styles.state}>
            <p>资产库加载失败</p>
            <p className={styles.subtitle}>{errorText(library.error)}</p>
            <Button onClick={() => void library.refetch()}>重试</Button>
          </div>
        ) : showInitialLoading ? (
          <div className={styles.grid}>
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton.Node key={index} active style={{ width: "100%", height: 200 }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className={styles.state}>
            <Empty
              image={<LibraryBig size={36} strokeWidth={1.25} aria-hidden />}
              description={filterActive ? "没有匹配的素材" : "资产库还是空的"}
            />
            <p className={styles.subtitle}>
              {filterActive ? "换个关键词或放宽筛选条件再试。" : "在任意项目里上传图片或生成结果，就会自动出现在这里。"}
            </p>
            {filterActive ? <Button onClick={clearFilters}>清空筛选</Button> : null}
          </div>
        ) : (
          <>
            <div className={styles.grid}>
              {items.map((item) => (
                <LibraryCard key={item.id} item={item} selected={selected.has(item.id)} onToggle={toggle} />
              ))}
            </div>
            <div ref={sentinelRef} className={styles.sentinel} />
            <div className={styles.moreState}>
              {library.isFetchingNextPage ? "正在加载更多…" : library.hasNextPage ? "向下滚动加载更多" : "已经到底了"}
            </div>
          </>
        )}
      </motion.main>

      {selected.size > 0 ? (
        <div className={styles.actionBar}>
          <span className={styles.actionCount}>已选 {selected.size} 张</span>
          <Select
            className={styles.actionSelect}
            placeholder="选择目标项目"
            value={targetProjectId}
            onChange={setTargetProjectId}
            options={projectItems.map((project) => ({ label: project.name, value: project.id }))}
            loading={projects.isPending}
            popupMatchSelectWidth={false}
          />
          <Button type="primary" loading={copy.isPending} disabled={!targetProjectId} onClick={() => void addSelected()}>
            添加到项目
          </Button>
          <Button type="text" onClick={() => setSelected(new Set())}>
            清空
          </Button>
        </div>
      ) : null}
    </div>
  );
}
