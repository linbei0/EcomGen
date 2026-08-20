import { App, Button, Checkbox, Image, InputNumber, Modal, Segmented, Select } from "antd";
import { CircleSlash, Maximize2, SquareCheckBig } from "lucide-react";
import { useMemo, useState } from "react";

import type { Output, ProjectDetail, StoryboardItem } from "../../api/adapters/projectDetail";
import { useReviewOutput } from "../../api/hooks/useReview";
import { useProviders } from "../../api/hooks/useProviders";
import { useStoryboard } from "../../api/hooks/useStoryboard";
import { useTemplates } from "../../api/hooks/useTemplates";
import { ModeBadge } from "../../components/ModeBadge";
import { errorText } from "../../lib/errorText";
import { itemDisplayName } from "../../lib/itemName";
import { groupOutputsByItem, REVIEW_LABEL, type ReviewDecision } from "../../lib/review";
import styles from "./workbench.module.css";
import type { GenerationJobInput } from "../../api/serializeGenerationBody";
import { ASPECT_LABEL, RESOLUTION_LABEL } from "../../lib/roles";
import { modelOptions } from "../../lib/modelOptions";

export function ReviewStage({
  detail,
  onRetryItem,
}: {
  detail: ProjectDetail;
  onRetryItem: (itemId: string, generationConfig: NonNullable<GenerationJobInput["generationConfig"]>) => void;
}) {
  const { notification } = App.useApp();
  const board = useStoryboard(detail.id);
  const review = useReviewOutput(detail.id);
  const templates = useTemplates();
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
        <p>确认分镜并生成后再查看结果。</p>
      </div>
    );
  }

  return (
    <div className={styles.lightboxStage}>
      {groups.map((group) => (
        <section key={group.item.id} className={styles.reviewGroup}>
          <h2 className={styles.reviewGroupTitle}>
            {itemDisplayName(group.item, templates.data ?? [])}
            <span>{group.outputs.length} 张</span>
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
        label={lightboxItem ? itemDisplayName(lightboxItem, templates.data ?? []) : ""}
        onClose={() => setLightboxId(null)}
        onDecide={(decision) => {
          if (lightbox) decide(lightbox.id, decision);
        }}
        onRetry={(generationConfig) => {
          if (lightboxItem) onRetryItem(lightboxItem.id, generationConfig);
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
  label,
  onClose,
  onDecide,
  onRetry,
}: {
  output: Output | undefined;
  item: StoryboardItem | undefined;
  label: string;
  onClose: () => void;
  onDecide: (decision: ReviewDecision) => void;
  onRetry: (generationConfig: NonNullable<GenerationJobInput["generationConfig"]>) => void;
}) {
  const providers = useProviders();
  const [retryOpen, setRetryOpen] = useState(false);
  const [resolution, setResolution] = useState<NonNullable<GenerationJobInput["generationConfig"]>["imageResolution"]>(item?.imageResolution ?? "1K");
  const [aspectRatio, setAspectRatio] = useState<NonNullable<GenerationJobInput["generationConfig"]>["imageAspectRatio"]>(item?.imageAspectRatio ?? "AUTO");
  const [candidateCount, setCandidateCount] = useState(item?.candidateCount ?? 1);
  const [modelKey, setModelKey] = useState(item?.imageProviderId && item.imageModelId ? `${item.imageProviderId}::${item.imageModelId}` : undefined);
  const imageOptions = modelOptions(providers.data?.items ?? [], "image");
  const openRetry = () => {
    setResolution(item?.imageResolution ?? "1K");
    setAspectRatio(item?.imageAspectRatio ?? "AUTO");
    setCandidateCount(item?.candidateCount ?? 1);
    setModelKey(item?.imageProviderId && item.imageModelId ? `${item.imageProviderId}::${item.imageModelId}` : imageOptions[0]?.value);
    setRetryOpen(true);
  };
  const submitRetry = () => {
    if (!modelKey) return;
    const [providerId, modelId] = modelKey.split("::");
    if (!providerId || !modelId) return;
    onRetry({ imageResolution: resolution, imageAspectRatio: aspectRatio, candidateCount, imageModel: { providerId, modelId } });
    setRetryOpen(false);
  };
  return (
    <>
    <Modal open={Boolean(output)} onCancel={onClose} footer={null} width={920} title="灯箱">
      {output && item ? (
        <div className={styles.lightboxBody}>
          <Image src={output.url} alt={label} />
          <div className={styles.lightboxMeta}>
            <p className={styles.shotType}>{label}</p>
            <ModeBadge mode={item.mode} />
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
            <Button onClick={openRetry}>用此分镜重新生成</Button>
          </div>
        </div>
      ) : null}
    </Modal>
    <Modal open={retryOpen} title="重新生成配置" okText="开始生成" cancelText="取消" onOk={submitRetry} onCancel={() => setRetryOpen(false)} okButtonProps={{ disabled: !modelKey }}>
      <div className={styles.inspectorSettingGrid}>
        <label className={styles.fieldLabel}>图片比例<Select value={aspectRatio} options={Object.entries(ASPECT_LABEL).map(([value, label]) => ({ value, label }))} onChange={setAspectRatio} /></label>
        <label className={styles.fieldLabel}>分辨率<Select value={resolution} options={Object.entries(RESOLUTION_LABEL).map(([value, label]) => ({ value, label }))} onChange={setResolution} /></label>
        <label className={styles.fieldLabel}>候选数<InputNumber min={1} max={4} value={candidateCount} onChange={(value) => setCandidateCount(value ?? 1)} /></label>
        <label className={styles.fieldLabel}>生图模型<Select value={modelKey} options={imageOptions} placeholder="选择生图模型" onChange={setModelKey} /></label>
      </div>
    </Modal>
    </>
  );
}
