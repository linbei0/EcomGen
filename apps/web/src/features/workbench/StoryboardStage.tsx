import { App, Button, Input, Modal } from "antd";
import { motion } from "motion/react";
import { Check, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import type { ProjectDetail, StoryboardItem } from "../../api/adapters/projectDetail";
import { useCreateGenerationJobs } from "../../api/hooks/useGeneration";
import { useConfirmStoryboard, useDeleteStoryboardItem, useStoryboard, useUpdateStoryboardItem } from "../../api/hooks/useStoryboard";
import { useTemplates } from "../../api/hooks/useTemplates";
import { ModeBadge } from "../../components/ModeBadge";
import { isApiError } from "../../api/errors";
import { transition } from "../../design/motion";
import { errorText } from "../../lib/errorText";
import { ITEM_STATUS_LABEL } from "../../lib/factClaims";
import { itemDisplayName } from "../../lib/itemName";
import { StoryboardInspector } from "./StoryboardInspector";
import styles from "./workbench.module.css";

export function StoryboardStage({
  detail,
  onGenerated,
}: {
  detail: ProjectDetail;
  onGenerated?: () => void;
}) {
  const { notification } = App.useApp();
  const board = useStoryboard(detail.id);
  const confirm = useConfirmStoryboard(detail.id);
  const remove = useDeleteStoryboardItem(detail.id);
  const update = useUpdateStoryboardItem(detail.id);
  const generate = useCreateGenerationJobs(detail.id);
  const templates = useTemplates();
  const items = board.data?.items ?? detail.items;
  const storyboard = board.data?.storyboard ?? detail.storyboard;
  const locked = storyboard?.status === "CONFIRMED";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const editing = items.find((item) => item.id === editingId);
  const expected = items.reduce((sum, item) => sum + item.candidateCount, 0);
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  const selectedExpected = selectedItems.reduce((sum, item) => sum + item.candidateCount, 0);
  const allSelected = selectedItems.length === items.length;

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => items.some((item) => item.id === id)));
  }, [items]);

  const requestDelete = (item: StoryboardItem) => {
    Modal.confirm({
      title: "删除这个分镜？",
      content: "删除后将从当前分镜列表移除，且无法恢复。",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await remove.mutateAsync(item.id);
          if (editingId === item.id) setEditingId(null);
        } catch (error) {
          notification.error({ title: "分镜删除失败", description: errorText(error) });
          throw error;
        }
      },
    });
  };

  const onConfirmAndGenerate = async (itemIds: string[]) => {
    if (!storyboard || itemIds.length === 0) return;
    try {
      if (!locked) {
        await confirm.mutateAsync(storyboard.version);
      }
      await generate.mutateAsync({ storyboardItemIds: itemIds });
      onGenerated?.();
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") {
        notification.error({ title: "分镜已被其他操作更新" });
        void board.refetch();
        return;
      }
      notification.error({ title: locked ? "生成失败" : "确认失败", description: errorText(error) });
    }
  };

  const toggleSelection = (itemId: string) => {
    setSelectedIds((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId],
    );
  };

  if (items.length === 0) {
    return (
      <div className={styles.placeholder}>
        <h2>还没有分镜</h2>
        <p>先在左侧完成配置并生成分镜。Agent 不会自动生图。</p>
      </div>
    );
  }

  return (
    <div className={styles.boardWrap}>
      <motion.div
        className={styles.board}
        data-locked={locked}
        animate={locked ? { opacity: [0.96, 1] } : { opacity: 1 }}
        transition={transition.fast}
      >
        {items.map((item) => {
          const label = itemDisplayName(item, templates.data ?? []);
          return (
            <StoryboardCard
              key={item.id}
              item={item}
              label={label}
              selected={item.id === editingId}
              checked={selectedIds.includes(item.id)}
              deletable={!locked && item.status === "DRAFT"}
              deleting={remove.isPending}
              onSelect={() => setEditingId(item.id)}
              onToggle={() => toggleSelection(item.id)}
              onDelete={() => requestDelete(item)}
            />
          );
        })}
      </motion.div>

      <div className={styles.confirmBar}>
        <div className={styles.selectionSummary} aria-live="polite">
          <strong>{selectedItems.length} 个已选分镜</strong>
          <span>共 {items.length} 个 · 预计 {selectedExpected}/{expected} 张候选</span>
        </div>
        <div className={styles.confirmActions}>
          <Button className={styles.selectAllAction} onClick={() => setSelectedIds(allSelected ? [] : items.map((item) => item.id))}>
            {allSelected ? "取消全选" : "全选"}
          </Button>
          <Button
            type="primary"
            className={styles.selectedGenerateAction}
            loading={confirm.isPending || generate.isPending}
            disabled={!storyboard || selectedItems.length === 0}
            onClick={() => void onConfirmAndGenerate(selectedItems.map((item) => item.id))}
          >
            确认并生成
          </Button>
        </div>
      </div>

      <Modal
        open={Boolean(editing)}
        title={editing ? <StoryboardTitleEditor item={editing} editable={!locked && editing.status === "DRAFT"} onSave={(displayName) => update.mutateAsync({ itemId: editing.id, body: { displayName } })} /> : "编辑分镜"}
        footer={null}
        onCancel={() => setEditingId(null)}
        width={560}
        destroyOnHidden
      >
        {editing ? (
          <StoryboardInspector
            projectId={detail.id}
            item={editing}
            templates={templates.data ?? []}
            locked={Boolean(locked)}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function StoryboardTitleEditor({
  item,
  editable,
  onSave,
}: {
  item: StoryboardItem;
  editable: boolean;
  onSave: (displayName: string) => Promise<unknown>;
}) {
  const { notification } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.displayName);

  useEffect(() => setValue(item.displayName), [item.displayName]);

  const save = async () => {
    const next = value.trim();
    if (!next || next === item.displayName) {
      setValue(item.displayName);
      setEditing(false);
      return;
    }
    try {
      await onSave(next);
      setEditing(false);
    } catch (error) {
      notification.error({ title: "显示名称保存失败", description: errorText(error) });
    }
  };

  if (editing && editable) {
    return (
      <Input
        autoFocus
        value={value}
        maxLength={80}
        aria-label="分镜显示名称"
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onPressEnter={() => void save()}
      />
    );
  }

  return editable ? (
    <button type="button" className={styles.modalTitleButton} onClick={() => setEditing(true)} title="点击编辑显示名称">
      {item.displayName || item.assetType}
    </button>
  ) : (
    <span className={styles.modalTitleButton}>{item.displayName || item.assetType}</span>
  );
}

function StoryboardCard({
  item,
  label,
  selected,
  checked,
  deletable,
  deleting,
  onSelect,
  onToggle,
  onDelete,
}: {
  item: StoryboardItem;
  label: string;
  selected: boolean;
  checked: boolean;
  deletable: boolean;
  deleting: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const risks = item.riskFlags.length;
  return (
    <div className={styles.shotCardWrap}>
      <button
        type="button"
        className={styles.shotPick}
        role="checkbox"
        aria-checked={checked}
        aria-label={`选择${label}`}
        title={checked ? "取消选择" : "选择分镜"}
        onClick={onToggle}
      >
        {checked ? <Check size={15} strokeWidth={2.5} aria-hidden /> : null}
      </button>
      <button
        type="button"
        className={styles.shotCard}
        data-selected={selected}
        data-picked={checked}
        aria-label={`${label} 分镜`}
        onClick={onSelect}
      >
        <div className={styles.shotHero} data-mode={item.mode}>
          <span className={styles.shotType}>{label}</span>
          {risks > 0 ? (
            <span className={styles.riskMark} aria-label={`${risks} 条风险`}>
              <TriangleAlert size={14} strokeWidth={1.75} />
              {risks}
            </span>
          ) : null}
        </div>
        <div className={styles.shotMeta}>
          <span className={styles.scopeChip}>{item.candidateCount} 张候选</span>
          <ModeBadge mode={item.mode} />
          <span className={styles.statusPill}>{ITEM_STATUS_LABEL[item.status]}</span>
        </div>
      </button>
      {deletable ? (
        <button
          type="button"
          className={styles.shotDelete}
          aria-label={`删除${label}`}
          title="删除分镜"
          disabled={deleting}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={14} strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
