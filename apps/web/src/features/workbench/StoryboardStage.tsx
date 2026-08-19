import { App, Button, Input, Modal } from "antd";
import { motion } from "motion/react";
import { Trash2, TriangleAlert } from "lucide-react";
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
  const editing = items.find((item) => item.id === editingId);
  const expected = items.reduce((sum, item) => sum + item.candidateCount, 0);

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

  const onConfirmAndGenerate = async () => {
    if (!storyboard) return;
    try {
      if (!locked) {
        await confirm.mutateAsync(storyboard.version);
      }
      await generate.mutateAsync({ storyboardItemIds: items.map((item) => item.id) });
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
              deletable={!locked && item.status === "DRAFT"}
              deleting={remove.isPending}
              onSelect={() => setEditingId(item.id)}
              onDelete={() => requestDelete(item)}
            />
          );
        })}
      </motion.div>

      <div className={styles.confirmBar}>
        <p>
          {items.length} 个分镜 · 预计 {expected} 张候选
        </p>
        <Button
          type="primary"
          loading={confirm.isPending || generate.isPending}
          disabled={!storyboard || items.length === 0}
          onClick={() => void onConfirmAndGenerate()}
        >
          {locked ? "开始生成" : "确认并生成"}
        </Button>
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
  deletable,
  deleting,
  onSelect,
  onDelete,
}: {
  item: StoryboardItem;
  label: string;
  selected: boolean;
  deletable: boolean;
  deleting: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const risks = item.riskFlags.length;
  return (
    <div className={styles.shotCardWrap}>
      <button type="button" className={styles.shotCard} data-selected={selected} aria-label={`${label} 分镜`} onClick={onSelect}>
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
