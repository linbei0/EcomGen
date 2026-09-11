import { App, Button, Empty, Image, Input, Segmented, Select, Skeleton } from "antd";
import { Aperture, Check, Download, LibraryBig, RefreshCw, Search, Settings2 } from "lucide-react";
import { motion } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { LIBRARY_KIND_OPTIONS, type LibraryItem, type LibraryKindFilter } from "../../api/adapters/library";
import { useCopyLibraryAssetToProject, useLibraryItems } from "../../api/hooks/useLibrary";
import { useProjects } from "../../api/hooks/useProjects";
import { HealthBadge } from "../../components/HealthBadge";
import { fadeUp, staggerContainer } from "../../design/motion";
import { errorText } from "../../lib/errorText";
import { formatShortDate } from "../../lib/format";
import { SettingsDrawer } from "../providers/SettingsDrawer";
import styles from "./LibraryPage.module.css";

function badgeLabel(source: string, kind: string): string {
  if (kind === "LAYER") return "分层";
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
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : "1 / 1";
  return (
    <article className={styles.card} data-selected={selected}>
      <div className={styles.thumbWrap} style={{ aspectRatio: ratio }}>
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
        <span className={styles.badge}>{badgeLabel(item.source, item.kind)}</span>
        <a className={styles.download} href={item.url} download aria-label={`下载 ${item.name}`}>
          <Download size={14} strokeWidth={1.75} />
        </a>
      </div>
      <div className={styles.meta}>
        <p className={styles.name} title={item.name}>
          {item.name}
        </p>
        <p className={styles.sub}>
          {item.projectName} · {formatShortDate(item.createdAt)}
        </p>
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetProjectId, setTargetProjectId] = useState<string>();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const copy = useCopyLibraryAssetToProject();
  const projects = useProjects();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = useMemo(() => ({ kind, q: query }), [kind, query]);
  const library = useLibraryItems(filters);
  const items = useMemo(() => library.data?.pages.flatMap((page) => page.items) ?? [], [library.data]);
  // 总数取服务端首个分页的过滤后总数，不随已加载页增长，避免“40 张跳 100 张”。
  const total = library.data?.pages[0]?.total ?? 0;
  const projectItems = projects.data?.items ?? [];

  // 筛选变化后旧的选中项可能已不在列表里，清空避免误加。
  useEffect(() => {
    setSelected(new Set());
  }, [kind, query]);

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
          kind: item.kind === "GENERATED" || item.kind === "LAYER" ? "REFERENCE" : item.kind,
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

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link to="/" className={styles.brand}>
          <Aperture size={20} strokeWidth={1.75} aria-hidden />
          <span className={styles.brandName}>EcomGen</span>
        </Link>
        <div className={styles.topActions}>
          <HealthBadge />
          <Button icon={<Settings2 size={16} strokeWidth={1.75} />} onClick={() => setSettingsOpen(true)}>
            设置
          </Button>
        </div>
      </header>

      <motion.main className={styles.main} variants={staggerContainer} initial="hidden" animate="visible">
        <motion.div className={styles.head} variants={fadeUp}>
          <div>
            <h1 className={styles.title}>资产库</h1>
            <p className={styles.subtitle}>
              {library.isPending ? "正在读取素材…" : `共 ${total} 张 · 来源覆盖全部项目的上传与生成结果`}
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
          <Segmented options={LIBRARY_KIND_OPTIONS} value={kind} onChange={(value) => setKind(value as LibraryKindFilter)} />
          <Input
            allowClear
            className={styles.search}
            prefix={<Search size={14} strokeWidth={1.75} aria-hidden />}
            placeholder="搜索名称或项目"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="搜索资产库"
          />
        </motion.div>

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
              description={query || kind !== "ALL" ? "没有匹配的素材" : "资产库还是空的"}
            />
            <p className={styles.subtitle}>
              {query || kind !== "ALL" ? "换个关键词或类型再试。" : "在任意项目里上传图片或生成结果，就会自动出现在这里。"}
            </p>
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

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
