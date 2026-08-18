import { App, Button, Checkbox, Image, Modal, Segmented } from "antd";
import { CircleSlash, Maximize2, SquareCheckBig } from "lucide-react";
import { useMemo, useState } from "react";

import type { Output, ProjectDetail, StoryboardItem } from "../../api/adapters/projectDetail";
import { useReviewOutput } from "../../api/hooks/useReview";
import { useStoryboard } from "../../api/hooks/useStoryboard";
import { ModeBadge } from "../../components/ModeBadge";
import { errorText } from "../../lib/errorText";
import { scopeLabel } from "../../lib/factClaims";
import { groupOutputsByItem, REVIEW_LABEL, type ReviewDecision } from "../../lib/review";
import styles from "./workbench.module.css";

export function ReviewStage({
  detail,
  onRetryItem,
}: {
  detail: ProjectDetail;
  onRetryItem: (itemId: string) => void;
}) {
  const { notification } = App.useApp();
  const board = useStoryboard(detail.id);
  const review = useReviewOutput(detail.id);
  const items = board.data?.items ?? detail.items;
  const groups = useMemo(() => groupOutputsByItem(items, detail.outputs), [detail.outputs, items]);
  const [picked, setPicked] = useState<string[]>([]);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const decide = (outputId: string, decision: ReviewDecision) => {
    void review.mutateAsync({ outputId, decision }).catch((error: unknown) => {
      notification.error({ title: "审核未保存", description: errorText(error) });
    });
  };

  const toggle = (id: string) => {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const lightbox = detail.outputs.find((output) => output.id === lightboxId);
  const lightboxItem = items.find((item) => item.id === lightbox?.storyboardItemId);

  if (detail.outputs.length === 0) {
    return (
      <div className={styles.placeholder}>
        <h2>还没有成图</h2>
        <p>回到生成阶段勾选分镜出图后再审。</p>
      </div>
    );
  }

  return (
    <div className={styles.lightboxStage}>
      {groups.map((group) => (
        <section key={group.item.id} className={styles.reviewGroup}>
          <h2 className={styles.reviewGroupTitle}>
            {group.item.assetType}
            <span>{scopeLabel(group.item.variantScope, detail.variants)}</span>
          </h2>
          <div className={styles.reviewGrid}>
            {group.outputs.map((output) => (
              <ReviewCard
                key={output.id}
                output={output}
                checked={picked.includes(output.id)}
                onToggle={() => toggle(output.id)}
                onDecide={(decision) => decide(output.id, decision)}
                onOpen={() => setLightboxId(output.id)}
              />
            ))}
          </div>
        </section>
      ))}

      {picked.length > 0 ? (
        <div className={styles.confirmBar}>
          <p>已选 {picked.length} 张</p>
          <div className={styles.batchActions}>
            <Button
              icon={<SquareCheckBig size={14} strokeWidth={1.75} />}
              onClick={() => {
                for (const id of picked) decide(id, "SELECTED");
                setPicked([]);
              }}
            >
              批量选入
            </Button>
            <Button
              icon={<CircleSlash size={14} strokeWidth={1.75} />}
              onClick={() => {
                for (const id of picked) decide(id, "REJECTED");
                setPicked([]);
              }}
            >
              批量淘汰
            </Button>
          </div>
        </div>
      ) : null}

      <LightboxModal
        output={lightbox}
        item={lightboxItem}
        variants={detail.variants}
        onClose={() => setLightboxId(null)}
        onDecide={(decision) => {
          if (lightbox) decide(lightbox.id, decision);
        }}
        onRetry={() => {
          if (lightboxItem) onRetryItem(lightboxItem.id);
        }}
      />
    </div>
  );
}

function ReviewCard({
  output,
  checked,
  onToggle,
  onDecide,
  onOpen,
}: {
  output: Output;
  checked: boolean;
  onToggle: () => void;
  onDecide: (decision: ReviewDecision) => void;
  onOpen: () => void;
}) {
  return (
    <article className={styles.reviewCard} data-decision={output.reviewDecision} data-checked={checked}>
      <div className={styles.reviewThumb}>
        <img src={output.url} alt="" className={styles.outputImage} loading="lazy" decoding="async" />
        <span className={styles.reviewMark}>{REVIEW_LABEL[output.reviewDecision]}</span>
        <div className={styles.reviewActions}>
          <button type="button" onClick={() => onDecide("SELECTED")} aria-label="选入">
            <SquareCheckBig size={16} strokeWidth={1.75} />
            选入
          </button>
          <button type="button" onClick={() => onDecide("REJECTED")} aria-label="淘汰">
            <CircleSlash size={16} strokeWidth={1.75} />
            淘汰
          </button>
          <button type="button" onClick={onOpen} aria-label="灯箱">
            <Maximize2 size={16} strokeWidth={1.75} />
            灯箱
          </button>
        </div>
      </div>
      <label className={styles.reviewPick}>
        <Checkbox checked={checked} onChange={onToggle} aria-label="选择成图" />
        对比选中
      </label>
    </article>
  );
}

function LightboxModal({
  output,
  item,
  variants,
  onClose,
  onDecide,
  onRetry,
}: {
  output: Output | undefined;
  item: StoryboardItem | undefined;
  variants: ProjectDetail["variants"];
  onClose: () => void;
  onDecide: (decision: ReviewDecision) => void;
  onRetry: () => void;
}) {
  return (
    <Modal open={Boolean(output)} onCancel={onClose} footer={null} width={920} title="灯箱">
      {output && item ? (
        <div className={styles.lightboxBody}>
          <Image src={output.url} alt={item.assetType} />
          <div className={styles.lightboxMeta}>
            <p className={styles.shotType}>{item.assetType}</p>
            <ModeBadge mode={item.mode} />
            <p>{scopeLabel(item.variantScope, variants)}</p>
            <p className={styles.promptPreview}>{item.promptInstruction}</p>
            <Segmented
              value={output.reviewDecision}
              options={[
                { label: "选入", value: "SELECTED" },
                { label: "待审", value: "NEEDS_REVIEW" },
                { label: "淘汰", value: "REJECTED" },
              ]}
              onChange={(value) => onDecide(value as ReviewDecision)}
            />
            <Button onClick={onRetry}>用此分镜重新生成</Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
