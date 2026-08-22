import { App, Button, Checkbox, Image, InputNumber, Modal, Segmented, Select } from "antd";
import { CircleSlash, Maximize2, Minus, Plus, SquareCheckBig } from "lucide-react";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

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
import { EditImageWorkspace } from "./EditImageWorkspace";

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
  const originalOutputs = useMemo(() => detail.outputs.filter((output) => !output.editSessionId), [detail.outputs]);
  const editedOutputs = useMemo(() => detail.outputs.filter((output) => Boolean(output.editSessionId)), [detail.outputs]);
  const groups = useMemo(() => groupOutputsByItem(items, originalOutputs), [originalOutputs, items]);
  const editedByRoot = useMemo(() => {
    const grouped = new Map<string, Output[]>();
    for (const output of editedOutputs) {
      const rootId = output.rootOutputId ?? output.parentOutputId;
      if (!rootId) continue;
      const bucket = grouped.get(rootId) ?? [];
      bucket.push(output);
      grouped.set(rootId, bucket.sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
    }
    return grouped;
  }, [editedOutputs]);
  const [picked, setPicked] = useState<string[]>([]);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [versionRootId, setVersionRootId] = useState<string | null>(null);

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
                editedOutputs={editedByRoot.get(output.id) ?? []}
                onOpenVersions={() => setVersionRootId(output.id)}
              />
            ))}
          </div>
        </section>
      ))}

      <VersionTreeModal
        root={versionRootId ? detail.outputs.find((output) => output.id === versionRootId) : undefined}
        outputs={versionRootId ? [detail.outputs.find((output) => output.id === versionRootId), ...(editedByRoot.get(versionRootId) ?? [])].filter((output): output is Output => Boolean(output)) : []}
        onClose={() => setVersionRootId(null)}
        onOpenOutput={(outputId) => { setVersionRootId(null); setEditingId(outputId); }}
      />

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
        onEdit={() => { if (lightbox) setEditingId(lightbox.id); }}
      />
      <EditImageWorkspace projectId={detail.id} output={detail.outputs.find((output) => output.id === editingId)} outputs={detail.outputs} assets={detail.assets} onSelectOutput={setEditingId} onClose={() => setEditingId(null)} />
    </div>
  );
}

function ReviewCard({
  output,
  checked,
  onToggle,
  onDecide,
  onOpen,
  editedOutputs = [],
  onOpenVersions,
}: {
  output: Output;
  checked: boolean;
  onToggle: () => void;
  onDecide: (decision: ReviewDecision) => void;
  onOpen: () => void;
  editedOutputs?: Output[];
  onOpenVersions?: () => void;
}) {
  return (
    <article className={styles.reviewCard} data-decision={output.reviewDecision} data-checked={checked}>
      <div className={styles.reviewThumb}>
        <img src={output.url} alt="" className={styles.outputImage} loading="lazy" decoding="async" />
        <span className={styles.reviewMark}>{REVIEW_LABEL[output.reviewDecision]}</span>
        {editedOutputs.length > 0 ? <button type="button" className={styles.editVersionPeek} onClick={onOpenVersions} aria-label={`查看 ${editedOutputs.length} 个编辑版本`}><span className={styles.editVersionPeekImages}>{editedOutputs.slice(-3).map((version) => <img key={version.id} src={version.url} alt="" />)}</span><span>编辑 {editedOutputs.length} 版</span></button> : null}
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
  onEdit,
}: {
  output: Output | undefined;
  item: StoryboardItem | undefined;
  label: string;
  onClose: () => void;
  onDecide: (decision: ReviewDecision) => void;
  onRetry: (generationConfig: NonNullable<GenerationJobInput["generationConfig"]>) => void;
  onEdit: () => void;
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
            <Button type="primary" onClick={onEdit}>编辑图片</Button>
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

function VersionTreeModal({ root, outputs, onClose, onOpenOutput }: { root: Output | undefined; outputs: Output[]; onClose: () => void; onOpenOutput: (outputId: string) => void }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const nodes = useMemo(() => {
    const byId = new Map(outputs.map((output) => [output.id, output]));
    const children = new Map<string, Output[]>();
    for (const output of outputs) { if (!output.parentOutputId) continue; const bucket = children.get(output.parentOutputId) ?? []; bucket.push(output); children.set(output.parentOutputId, bucket); }
    const level = new Map<string, number>(root ? [[root.id, 0]] : []);
    const visit = (output: Output) => {
      for (const child of children.get(output.id) ?? []) {
        level.set(child.id, (level.get(output.id) ?? 0) + 1);
        visit(child);
      }
    };
    if (root) visit(root);
    const rows = new Map<number, Output[]>();
    for (const output of outputs) { const bucket = rows.get(level.get(output.id) ?? 0) ?? []; bucket.push(output); rows.set(level.get(output.id) ?? 0, bucket); }
    return [...rows.entries()].flatMap(([depth, row]) => row.map((output, index) => {
      const parent = output.parentOutputId ? byId.get(output.parentOutputId) : undefined;
      const siblings = parent ? (children.get(parent.id) ?? []) : [];
      return {
        output,
        depth,
        index,
        x: 72 + index * 250,
        y: 72 + depth * 190,
        parent,
        siblingCount: siblings.length,
        siblingOrdinal: siblings.findIndex((candidate) => candidate.id === output.id) + 1,
      };
    }));
  }, [outputs, root]);
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }; };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => { if (!dragRef.current) return; setOffset({ x: dragRef.current.ox + event.clientX - dragRef.current.x, y: dragRef.current.oy + event.clientY - dragRef.current.y }); };
  const pointerUp = () => { dragRef.current = null; };
  return <Modal open={Boolean(root)} onCancel={onClose} footer={null} width="min(1100px, calc(100vw - 32px))" title="编辑版本关系">
    <div className={styles.versionTreeHeader}><div><strong>{root ? "这张图的编辑版本" : ""}</strong><span>点击图片进入编辑，拖动画布查看关系</span></div><div><button type="button" onClick={() => setZoom((value) => Math.max(0.65, value - 0.1))} aria-label="缩小"><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))} aria-label="放大"><Plus size={16} /></button></div></div>
    <div className={styles.versionTreeCanvas} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <div className={styles.versionTreeWorld} style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}>
        <svg className={styles.versionTreeLinks} width="1000" height="650" aria-hidden>{nodes.filter((node) => node.parent).map((node) => { const parent = nodes.find((candidate) => candidate.output.id === node.parent?.id); return parent ? <path key={node.output.id} d={`M ${parent.x + 96} ${parent.y + 126} C ${parent.x + 96} ${parent.y + 155}, ${node.x + 96} ${node.y - 25}, ${node.x + 96} ${node.y}`} /> : null; })}</svg>
        {nodes.map((node) => { const label = node.depth === 0 ? "原图" : `V${node.depth + 1}${node.siblingCount > 1 ? ` · ${node.siblingOrdinal}` : ""}`; return <button type="button" key={node.output.id} className={styles.versionTreeNode} style={{ left: node.x, top: node.y }} onPointerDown={(event) => event.stopPropagation()} onClick={() => onOpenOutput(node.output.id)}><img src={node.output.url} alt="" /><span>{label}</span></button>; })}
      </div>
    </div>
  </Modal>;
}
