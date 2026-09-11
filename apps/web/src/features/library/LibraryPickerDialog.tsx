import { App, Button, Input, Modal, Segmented, Spin } from "antd";
import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { UserAssetKind } from "../../api/adapters/projectDetail";
import { LIBRARY_KIND_OPTIONS, type LibraryKindFilter } from "../../api/adapters/library";
import { useCopyLibraryAssetToProject, useLibraryItems } from "../../api/hooks/useLibrary";
import { errorText } from "../../lib/errorText";
import { formatShortDate } from "../../lib/format";
import { USER_ASSET_KIND_META } from "../../lib/roles";
import styles from "../workbench/workbench.module.css";

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
  const copy = useCopyLibraryAssetToProject();

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
    }
  }, [open]);

  const filters = useMemo(() => ({ kind: kindFilter, q: query }), [kindFilter, query]);
  const library = useLibraryItems(filters, open);
  // 项目内已有 hash 直接隐藏，避免选到必然被项目内 hash 唯一性拒绝的图片。
  const items = useMemo(
    () => (library.data?.pages.flatMap((page) => page.items) ?? []).filter((item) => !excludeHashes.has(item.hash)),
    [library.data, excludeHashes],
  );

  const changeKind = (value: LibraryKindFilter) => {
    setKindFilter(value);
    setSelectedIds(new Set());
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
      {library.isLoading ? (
        <div className={styles.historyState}>
          <Spin />
        </div>
      ) : library.isError ? (
        <p className={styles.historyState}>资产库加载失败：{errorText(library.error)}</p>
      ) : items.length === 0 ? (
        <p className={styles.historyState}>资产库还没有可添加的图片。</p>
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
      {library.hasNextPage ? (
        <div className={styles.historyMore}>
          <Button type="text" loading={library.isFetchingNextPage} onClick={() => void library.fetchNextPage()}>
            加载更多
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
