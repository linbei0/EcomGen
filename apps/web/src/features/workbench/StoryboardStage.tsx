import { App, Button } from "antd";
import { motion } from "motion/react";
import { TriangleAlert } from "lucide-react";

import type { ProjectDetail, StoryboardItem, Variant } from "../../api/adapters/projectDetail";
import { useConfirmStoryboard, useStoryboard } from "../../api/hooks/useStoryboard";
import { ModeBadge } from "../../components/ModeBadge";
import { isApiError } from "../../api/errors";
import { transition } from "../../design/motion";
import { errorText } from "../../lib/errorText";
import { ITEM_STATUS_LABEL, scopeLabel } from "../../lib/factClaims";
import styles from "./workbench.module.css";

export function StoryboardStage({
  detail,
  selectedItemId,
  onSelectItem,
}: {
  detail: ProjectDetail;
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
}) {
  const { notification } = App.useApp();
  const board = useStoryboard(detail.id);
  const confirm = useConfirmStoryboard(detail.id);
  const items = board.data?.items ?? detail.items;
  const storyboard = board.data?.storyboard ?? detail.storyboard;
  const locked = storyboard?.status === "CONFIRMED";
  const creative = items.filter((item) => item.mode === "CREATIVE").length;
  const protectedCount = items.length - creative;

  const onConfirm = async () => {
    if (!storyboard) return;
    try {
      await confirm.mutateAsync(storyboard.version);
      notification.success({ title: "分镜已确认", description: "可以进入生成阶段勾选目标分镜。" });
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") {
        notification.error({ title: "分镜已被其他操作更新" });
        void board.refetch();
        return;
      }
      notification.error({ title: "确认失败", description: errorText(error) });
    }
  };

  if (items.length === 0) {
    return (
      <div className={styles.placeholder}>
        <h2>还没有分镜</h2>
        <p>先完成规划。Agent 不会自动生图，确认分镜后才会进入生成。</p>
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
        {items.map((item) => (
          <StoryboardCard
            key={item.id}
            item={item}
            variants={detail.variants}
            selected={item.id === selectedItemId}
            onSelect={() => onSelectItem(item.id)}
          />
        ))}
      </motion.div>

      <div className={styles.confirmBar}>
        <p>
          {items.length} 个分镜 · 创意 {creative} / 像素保护 {protectedCount}
        </p>
        {locked ? (
          <span className={styles.lockedNote}>已锁定，进入生成勾选目标分镜</span>
        ) : (
          <Button type="primary" loading={confirm.isPending} disabled={!storyboard} onClick={() => void onConfirm()}>
            确认分镜
          </Button>
        )}
      </div>
    </div>
  );
}

function StoryboardCard({
  item,
  variants,
  selected,
  onSelect,
}: {
  item: StoryboardItem;
  variants: Variant[];
  selected: boolean;
  onSelect: () => void;
}) {
  const risks = item.riskFlags.length;
  return (
    <button
      type="button"
      className={styles.shotCard}
      data-selected={selected}
      data-scope={item.variantScope === "COMMON" ? "common" : "sku"}
      onClick={onSelect}
    >
      <div className={styles.shotHero} data-mode={item.mode}>
        <span className={styles.shotType}>{item.assetType}</span>
        {risks > 0 ? (
          <span className={styles.riskMark} aria-label={`${risks} 条风险`}>
            <TriangleAlert size={14} strokeWidth={1.75} />
            {risks}
          </span>
        ) : null}
      </div>
      <div className={styles.shotMeta}>
        <span className={styles.scopeChip}>{scopeLabel(item.variantScope, variants)}</span>
        <ModeBadge mode={item.mode} />
        <span className={styles.statusPill}>{ITEM_STATUS_LABEL[item.status]}</span>
      </div>
    </button>
  );
}
