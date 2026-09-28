import { App, Button, DatePicker, Input, Modal, Segmented, Select, Spin } from "antd";
import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { UserAssetKind } from "../../api/adapters/projectDetail";
import {
  LIBRARY_KIND_OPTIONS,
  hasActiveLibraryFilters,
  libraryFilterScope,
  type LibraryKindFilter,
} from "../../api/adapters/library";
import { useCopyLibraryAssetToProject, useLibraryItems } from "../../api/hooks/useLibrary";
import { useProjects } from "../../api/hooks/useProjects";
import { errorText } from "../../lib/errorText";
import { dayRangeBounds, formatShortDate } from "../../lib/format";
import { MODEL_IDENTITY_FILTERS, type ModelIdentityFilters, type ModelIdentityKey } from "../../lib/modelIdentityFilters";
import { USER_ASSET_KIND_META } from "../../lib/roles";
import styles from "../workbench/workbench.module.css";

const { RangePicker } = DatePicker;

/** 日期范围控件的受控值类型：antd 内部用 dayjs，应用不直接依赖它，因此从属性类型反推。 */
type LibraryDateRange = Parameters<NonNullable<React.ComponentProps<typeof RangePicker>["onChange"]>>[0];

/** 资产库选择器：跨项目素材/生成结果，勾选后由服务端复制为当前项目素材。 */
export function LibraryPickerDialog({
  open,
  projectId,
  kind,
  excludeHashes,
  onClose,
}: {
  open: boolean;
  projectId: string;
  kind: UserAssetKind;
  excludeHashes: Set<string>;
  onClose: () => void;
}) {
  const { notification } = App.useApp();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [kindFilter, setKindFilter] = useState<LibraryKindFilter>("ALL");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<LibraryDateRange>(null);
  const [modelIdentity, setModelIdentity] = useState<ModelIdentityFilters>({});
  const copy = useCopyLibraryAssetToProject();
  const projects = useProjects();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
      setKindFilter("ALL");
      setSearch("");
      setQuery("");
      setProjectFilter(null);
      setDateRange(null);
      setModelIdentity({});
    }
  }, [open]);

  const scope = libraryFilterScope(kindFilter);
  const timeBounds = useMemo(() => dayRangeBounds(dateRange?.[0]?.valueOf(), dateRange?.[1]?.valueOf()), [dateRange]);
  const filters = useMemo(
    () => ({
      kind: kindFilter,
      q: query,
      projectId: projectFilter,
      createdFrom: timeBounds.createdFrom,
      createdTo: timeBounds.createdTo,
      modelIdentity,
    }),
    [kindFilter, query, projectFilter, timeBounds, modelIdentity],
  );
  const library = useLibraryItems(filters, open);
  const filterActive = hasActiveLibraryFilters(filters);
  // 项目内已有 hash 直接隐藏，避免选到必然被项目内 hash 唯一性拒绝的图片。
  const items = useMemo(
    () => (library.data?.pages.flatMap((page) => page.items) ?? []).filter((item) => !excludeHashes.has(item.hash)),
    [library.data, excludeHashes],
  );
  // 服务端 total 是「筛选后去重」的匹配数，不扣除项目内已有的图片，因此只能当匹配数展示，不能当可添加数。
  const matched = library.data?.pages[0]?.total ?? 0;

  // 搜索或筛选变化后旧选择可能已不可见，清空避免把看不见的图片带进「添加」。
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filters]);

  const changeKind = (value: LibraryKindFilter) => {
    const next = libraryFilterScope(value);
    setKindFilter(value);
    if (!next.project) setProjectFilter(null);
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

  const toggle = (itemId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleOk = async () => {
    if (selectedIds.size === 0) return;
    let succeeded = 0;
    let failed = 0;
    let firstError = "";
    for (const itemId of selectedIds) {
      try {
        await copy.mutateAsync({ projectId, itemId, kind });
        succeeded += 1;
      } catch (error: unknown) {
        failed += 1;
        if (!firstError) firstError = errorText(error);
      }
    }
    if (succeeded > 0) {
      notification.success({ title: `已添加 ${succeeded} 张${USER_ASSET_KIND_META[kind].label}` });
      onClose();
    }
    if (failed > 0) {
      notification.error({ title: `${failed} 张添加失败`, description: firstError });
    }
  };

  return (
    <Modal
      open={open}
      title="从资产库添加"
      okText={selectedIds.size > 0 ? `添加 ${selectedIds.size} 张` : "添加"}
      okButtonProps={{ disabled: selectedIds.size === 0 }}
      cancelText="取消"
      onOk={handleOk}
      onCancel={onClose}
      width={760}
    >
      <div className={styles.historyToolbar}>
        <Segmented
          options={LIBRARY_KIND_OPTIONS}
          value={kindFilter}
          onChange={(value) => changeKind(value as LibraryKindFilter)}
          aria-label="按类型筛选"
        />
        <Input
          allowClear
          prefix={<Search size={14} strokeWidth={1.75} aria-hidden />}
          placeholder="搜索名称或项目"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="搜索资产库"
        />
      </div>
      <div className={styles.historyFilterRow}>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          className={styles.historyFilterSelect}
          placeholder={scope.project ? "全部项目" : "定妆照不属于项目"}
          aria-label="按来源项目筛选"
          value={projectFilter ?? undefined}
          onChange={(value) => setProjectFilter(value ?? null)}
          options={(projects.data?.items ?? []).map((project) => ({ label: project.name, value: project.id }))}
          loading={projects.isPending}
          disabled={!scope.project}
          popupMatchSelectWidth={false}
        />
        <RangePicker
          allowClear
          className={styles.historyFilterSelect}
          value={dateRange}
          onChange={setDateRange}
          placeholder={["开始日期", "结束日期"]}
          aria-label="按创建时间筛选"
        />
        {library.isSuccess ? (
          <span className={styles.historyCount}>
            {matched} 张匹配{matched > 0 ? " · 项目内已有的自动隐藏" : ""}
          </span>
        ) : null}
      </div>
      {/* 身份维度查的是模特实体的规格，只对定妆照成立：切到其他类型时隐藏并清空。 */}
      {scope.identity ? (
        <div className={styles.historyFilterRow}>
          {MODEL_IDENTITY_FILTERS.map((filter) => (
            <Select
              key={filter.key}
              allowClear
              className={styles.historyIdentitySelect}
              placeholder={filter.label}
              aria-label={filter.label}
              value={modelIdentity[filter.key]}
              onChange={(value) => setIdentityFilter(filter.key, value ?? null)}
              options={filter.options}
              popupMatchSelectWidth={false}
            />
          ))}
        </div>
      ) : null}
      {library.isLoading ? (
        <div className={styles.historyState}>
          <Spin />
        </div>
      ) : library.isError ? (
        <p className={styles.historyState}>资产库加载失败：{errorText(library.error)}</p>
      ) : items.length === 0 ? (
        <p className={styles.historyState}>
          {matched > 0
            ? "当前筛选结果的图片都已经在本项目里。"
            : filterActive
              ? "没有匹配的图片，换个关键词或放宽筛选条件。"
              : "资产库还没有可添加的图片。"}
        </p>
      ) : (
        <div className={styles.historyGrid}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.historyItem}
              data-selected={selectedIds.has(item.id)}
              aria-pressed={selectedIds.has(item.id)}
              aria-label={`选择 ${item.name}`}
              onClick={() => toggle(item.id)}
            >
              <span className={styles.historyThumbWrap}>
                <img className={styles.historyThumb} src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                <span className={styles.historyCheck} aria-hidden>
                  <Check size={13} strokeWidth={2.5} />
                </span>
              </span>
              <span className={styles.historyMeta}>
                <span className={styles.historyName} title={item.name}>
                  {item.name}
                </span>
                <span className={styles.historyDate}>{item.projectName || formatShortDate(item.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {items.length > 0 ? (
        <div className={styles.historyMore}>
          {library.hasNextPage ? (
            <Button type="text" loading={library.isFetchingNextPage} onClick={() => void library.fetchNextPage()}>
              加载更多
            </Button>
          ) : (
            <span className={styles.historyCount}>已经到底了</span>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
