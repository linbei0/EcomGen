import { MAX_REQUESTED_SUITE_SHOTS } from "@ecomgen/contracts";
import { App, Button, Input, Modal, Popconfirm, Skeleton, Tag, Tooltip } from "antd";
import { Check, FileJson, Layers, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import type { SuiteSummary } from "../../api/adapters/suites";
import { useCreateUserSuite, useDeleteUserSuite, useRefreshSuites, useSuiteCategories, useSuitePage } from "../../api/hooks/useSuites";
import { errorText } from "../../lib/errorText";
import { SHOT_ROLE_LABEL, SHOT_ROLE_ORDER } from "../../lib/roles";
import styles from "./SuitePickerDialog.module.css";

function roleLabel(role: string): string {
  return SHOT_ROLE_LABEL[role as keyof typeof SHOT_ROLE_LABEL] ?? role;
}

function roleTone(role: string): number {
  return Math.max(0, SHOT_ROLE_ORDER.indexOf(role as (typeof SHOT_ROLE_ORDER)[number]));
}

function shotAssetType(suiteId: string, shotId: string): string {
  return `${suiteId}::${shotId}`;
}

interface SuitePickerDialogProps {
  open: boolean;
  value: string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
}

interface SuiteCardProps {
  suite: SuiteSummary;
  selected: Set<string>;
  atCap: boolean;
  onToggleShot: (assetType: string) => void;
  onToggleAll: (suiteId: string, shotIds: readonly string[]) => void;
  onDelete: (suiteId: string) => void;
  deleting: boolean;
}

/**
 * 单张套图卡片：卡片整体不承担点击，逐个分镜才是选择单位，避免误选整卷。
 * memo 只挡住无关的父级重渲染；勾选时 selected 引用变化仍会让已挂载的卡片重渲染，但虚拟化后同时挂载的卡片只有十几张。
 */
const SuiteCard = memo(function SuiteCard({ suite, selected, atCap, onToggleShot, onToggleAll, onDelete, deleting }: SuiteCardProps) {
  const assetTypes = suite.shots.map((shot) => shotAssetType(suite.id, shot.shotId));
  const selectedCount = assetTypes.filter((assetType) => selected.has(assetType)).length;
  const everySelected = selectedCount === assetTypes.length;

  return (
    <article className={styles.card} data-selected={selectedCount > 0}>
      <div className={styles.cardHead}>
        <div className={styles.cardTitle}>
          <h3 className={styles.cardName} title={suite.name}>{suite.name}</h3>
          <Tag className={styles.origin} color={suite.origin === "builtin" ? "geekblue" : "purple"}>
            {suite.origin === "builtin" ? "内置" : "导入"}
          </Tag>
          <span className={styles.cardCategory}>{suite.category.l1} / {suite.category.l2} · {suite.category.leaf}</span>
        </div>
        <div className={styles.cardMeta}>
          <span className={styles.cardCount}><Layers size={13} strokeWidth={1.75} aria-hidden /> {suite.shotCount} 张成套</span>
          {selectedCount > 0 ? (
            <span className={styles.cardAdded}><Check size={12} strokeWidth={2.75} aria-hidden /> 已选 {selectedCount}</span>
          ) : null}
        </div>
      </div>

      {suite.description ? <p className={styles.cardDesc}>{suite.description}</p> : null}

      <div className={styles.cardLabel}>套图分镜</div>
      <div className={styles.shotGrid}>
        {suite.shots.map((shot) => {
          const assetType = shotAssetType(suite.id, shot.shotId);
          const on = selected.has(assetType);
          return (
            <button
              key={shot.shotId}
              type="button"
              className={styles.shot}
              data-on={on}
              disabled={!on && atCap}
              aria-pressed={on}
              onClick={() => onToggleShot(assetType)}
            >
              <span className={styles.shotRole} data-role={roleTone(shot.shotRole)}>{roleLabel(shot.shotRole)}</span>
              <span className={styles.shotName} title={shot.displayName}>{shot.displayName}</span>
              <span className={styles.shotUnit}>×1</span>
              {on ? <Check className={styles.shotCheck} size={13} strokeWidth={2.75} aria-hidden /> : null}
            </button>
          );
        })}
      </div>

      <div className={styles.cardFoot}>
        <button
          type="button"
          className={styles.cardAll}
          onClick={() => onToggleAll(suite.id, suite.shots.map((shot) => shot.shotId))}
        >
          {everySelected ? "取消全选" : "选择整卷"}
        </button>
        {suite.origin === "user" ? (
          <Popconfirm title="删除该套图？" description="已使用它的分镜需重新规划。" okText="删除" cancelText="取消" onConfirm={() => onDelete(suite.id)}>
            <Button type="text" size="small" danger loading={deleting} icon={<Trash2 size={14} strokeWidth={1.75} />} aria-label="删除套图" />
          </Popconfirm>
        ) : null}
      </div>
    </article>
  );
});

/** 列表底部状态：沿用资产库文案，让“到底”与“还在加载”可区分。 */
function SuiteListFooter({ context }: { context: { isFetchingNextPage: boolean; hasNextPage: boolean } }) {
  return (
    <div className={styles.more}>
      {context.isFetchingNextPage ? "正在加载更多…" : context.hasNextPage ? "向下滚动加载更多" : "已经到底了"}
    </div>
  );
}

/** 套图分镜选择弹窗：左品类导航 + 右侧套图卡片，就地挑选分镜，不跳转整页以免抢占工作台焦点。 */
export function SuitePickerDialog({ open, value, onChange, onClose }: SuitePickerDialogProps) {
  const { notification } = App.useApp();
  const [activeL1, setActiveL1] = useState<string | undefined>();
  const [activeL2, setActiveL2] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const filters = useMemo(() => ({ q: query, l1: activeL1, l2: activeL2 }), [query, activeL1, activeL2]);
  // placeholderData 让切换品类/关键词时保留上一批结果与计数，避免整屏闪成骨架屏；真正的检索由服务端完成。
  const suites = useSuitePage(filters, open);
  const pages = suites.data?.pages;
  const loaded = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);
  const firstPage = pages?.[0];
  const categories = useSuiteCategories();
  const refresh = useRefreshSuites();
  const create = useCreateUserSuite();
  const remove = useDeleteUserSuite();
  const removeAsync = remove.mutateAsync;

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const selected = useMemo(() => new Set(value), [value]);
  const l1List = categories.data?.l1 ?? [];
  const l2List = useMemo(() => (activeL1 && categories.data ? categories.data.l2[activeL1] ?? [] : []), [activeL1, categories.data]);

  useEffect(() => {
    if (activeL1 && !l1List.includes(activeL1)) setActiveL1(undefined);
  }, [l1List, activeL1]);

  const atCap = value.length >= MAX_REQUESTED_SUITE_SHOTS;
  const selectedSuiteCount = useMemo(
    () => new Set(value.map((assetType) => assetType.split("::")[0])).size,
    [value],
  );

  const commit = useCallback((next: string[]) => {
    if (next.length > MAX_REQUESTED_SUITE_SHOTS) {
      notification.warning({ title: `最多选择 ${MAX_REQUESTED_SUITE_SHOTS} 个分镜`, description: "请先取消一些分镜再继续选择。" });
      return;
    }
    onChange(next);
  }, [notification, onChange]);

  const toggleShot = useCallback((assetType: string) => {
    commit(value.includes(assetType) ? value.filter((item) => item !== assetType) : [...value, assetType]);
  }, [commit, value]);

  const toggleAll = useCallback((suiteId: string, shotIds: readonly string[]) => {
    const all = shotIds.map((shotId) => shotAssetType(suiteId, shotId));
    const everySelected = all.every((assetType) => value.includes(assetType));
    commit(everySelected ? value.filter((assetType) => !all.includes(assetType)) : [...new Set([...value, ...all])]);
  }, [commit, value]);

  const deleteSuite = useCallback(async (suiteId: string) => {
    try {
      await removeAsync(suiteId);
      onChange(value.filter((assetType) => !assetType.startsWith(`${suiteId}::`)));
      notification.success({ title: "套图已删除" });
    } catch (error: unknown) {
      notification.error({ title: "删除失败", description: errorText(error) });
    }
  }, [notification, onChange, removeAsync, value]);

  const importSuite = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      notification.error({ title: "JSON 解析失败", description: "请粘贴完整的 .suite.json 内容。" });
      return;
    }
    try {
      const created = await create.mutateAsync(parsed as never);
      notification.success({ title: `已导入「${created.name}」` });
      setImportOpen(false);
      setImportText("");
    } catch (error: unknown) {
      notification.error({ title: "导入失败", description: errorText(error) });
    }
  };

  const fetchNextPage = suites.fetchNextPage;
  const hasNextPage = suites.hasNextPage;
  const isFetchingNextPage = suites.isFetchingNextPage;
  const isPlaceholderData = suites.isPlaceholderData;
  const handleEndReached = useCallback(() => {
    // 占位数据属于上一组筛选条件，此时翻页会拿着旧游标请求新结果集，跳过这一帧。
    if (isPlaceholderData || !hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isPlaceholderData]);

  const body = (
    <div className={styles.shell}>
      <aside className={styles.rail}>
        <div className={styles.railHead}>
          <span className={styles.railTitle}>选择套图分镜</span>
          <span className={styles.railSub}>按品类挑选高分镜模板，每个分镜生成一张属于你商品的图片</span>
        </div>
        <nav className={styles.railList} aria-label="一级品类">
          <button type="button" className={styles.railItem} data-on={activeL1 === undefined} onClick={() => { setActiveL1(undefined); setActiveL2(undefined); }}>
            <span>全部</span>
            <em>{firstPage?.total ?? 0}</em>
          </button>
          {l1List.map((l1) => {
            const count = firstPage?.l1Counts[l1] ?? 0;
            return (
              <button
                key={l1}
                type="button"
                className={styles.railItem}
                data-on={activeL1 === l1}
                disabled={count === 0}
                onClick={() => { setActiveL1(l1); setActiveL2(undefined); }}
              >
                <span>{l1}</span>
                <em>{count}</em>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div className={styles.l2Row}>
            <button type="button" className={styles.l2Chip} data-on={activeL2 === undefined} onClick={() => setActiveL2(undefined)}>全部</button>
            {l2List.map((l2) => (
              <button key={l2} type="button" className={styles.l2Chip} data-on={activeL2 === l2} onClick={() => setActiveL2(l2)}>{l2}</button>
            ))}
          </div>
          <div className={styles.panelTools}>
            <Input
              allowClear
              className={styles.search}
              prefix={<Search size={14} strokeWidth={1.75} aria-hidden />}
              placeholder="搜索套图、品类或商品"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="搜索套图"
            />
            <Button icon={<FileJson size={15} strokeWidth={1.75} />} onClick={() => setImportOpen(true)}>导入</Button>
            <Tooltip title="重新扫描套图目录">
              <Button icon={<RefreshCw size={15} strokeWidth={1.75} />} loading={refresh.isPending} onClick={() => void refresh.mutateAsync()} aria-label="重新扫描套图" />
            </Tooltip>
          </div>
        </header>

        <div className={styles.cards}>
          {suites.isLoading ? (
            <div className={styles.cardsFallback}>
              {Array.from({ length: 3 }).map((_, index) => <Skeleton.Node key={index} active style={{ width: "100%", height: 168 }} />)}
            </div>
          ) : suites.isError ? (
            <div className={styles.state}>
              <p>套图库加载失败</p>
              <p className={styles.stateHint}>{errorText(suites.error)}</p>
              <Button onClick={() => void suites.refetch()}>重试</Button>
            </div>
          ) : loaded.length === 0 ? (
            <div className={styles.state}>
              <Sparkles size={30} strokeWidth={1.25} aria-hidden />
              <p>{query || activeL1 ? "没有匹配的套图" : "套图库还是空的"}</p>
              <p className={styles.stateHint}>用 ecom-suite-forge 从爆款套图生成 .suite.json，或点右上角「导入」。</p>
            </div>
          ) : (
            <Virtuoso
              key={`${query}|${activeL1 ?? ""}|${activeL2 ?? ""}`}
              className={styles.cardsScroller}
              style={{ position: "absolute", inset: 0 }}
              data={loaded}
              computeItemKey={(_, suite) => suite.id}
              defaultItemHeight={260}
              increaseViewportBy={400}
              context={{ isFetchingNextPage, hasNextPage }}
              components={{ Header: () => <div className={styles.cardsTop} />, Footer: SuiteListFooter }}
              endReached={handleEndReached}
              itemContent={(_, suite) => (
                <div className={styles.cardSlot}>
                  <SuiteCard
                    suite={suite}
                    selected={selected}
                    atCap={atCap}
                    onToggleShot={toggleShot}
                    onToggleAll={toggleAll}
                    onDelete={deleteSuite}
                    deleting={remove.isPending && remove.variables === suite.id}
                  />
                </div>
              )}
            />
          )}
        </div>
      </section>
    </div>
  );

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        width={940}
        className={styles.modal}
        styles={{ body: { padding: 0 } }}
        title={null}
        destroyOnHidden={false}
      >
        {body}
        <footer className={styles.footer}>
          <span className={styles.footerCount}>
            已选 <strong>{selectedSuiteCount}</strong> 套 · 共 <strong>{value.length}</strong> 个分镜
            <span className={styles.footerCap}>/ {MAX_REQUESTED_SUITE_SHOTS}</span>
            {atCap ? <em className={styles.footerCapHit}>已达上限</em> : null}
          </span>
          <div className={styles.footerActions}>
            {value.length > 0 ? <Button type="text" onClick={() => onChange([])}>清空已选</Button> : null}
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={onClose} disabled={value.length === 0}>
              确定选择{value.length > 0 ? `（${value.length}）` : ""}
            </Button>
          </div>
        </footer>
      </Modal>

      <Modal
        open={importOpen}
        title="导入套图"
        okText="导入"
        cancelText="取消"
        confirmLoading={create.isPending}
        onOk={() => void importSuite()}
        onCancel={() => setImportOpen(false)}
        width={640}
      >
        <p className={styles.importHint}>
          粘贴 ecom-suite-forge 生成的 <code>.suite.json</code> 内容。导入后会保存到本机数据库，可随时删除。
        </p>
        <Input.TextArea
          className={styles.importArea}
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          autoSize={{ minRows: 12, maxRows: 20 }}
          placeholder='{ "kind": "ecomgen.suite", "name": "…", "category": { "l1": "…", "l2": "…", "leaf": "…" }, "styleLock": { "lockText": "…" }, "shots": [ … ] }'
        />
      </Modal>
    </>
  );
}
