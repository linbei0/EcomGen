/**
 * 花型墙与花型工作区共享的常量与小部件。
 * 两个路由分属不同 chunk，常量与 ListingModelSelect/CopyRow 这类两处都要用的件放这里，避免复制。
 */
import { useEffect, useMemo, type ReactNode } from "react";
import { App, Button, Checkbox, Select } from "antd";
import { Copy } from "lucide-react";

import { PATTERN_BACKGROUND_MODE_LABELS } from "@ecomgen/ecom-skill";
import { usePodPrintSpecs } from "../../api/hooks/usePatterns";
import { useProviders } from "../../api/hooks/useProviders";
import type { ListingPlatform, Pattern, PatternBackgroundMode, PatternPipelineAnswers, PodPrintLayout, PodPrintSpec } from "../../api/hooks/usePatterns";
import { modelOptions, parseModelKey, type ModelOption } from "../../lib/modelOptions";
import styles from "./PatternsPage.module.css";
// 版式 chips 在工作区（rail 密度）与花型墙（默认密度）各有一套类；共享组件按 variant 取用。
import railStyles from "./PatternWorkspacePage.module.css";

/** 花型卡上的来源徽标文案；取值与 contracts 的 PatternSource 一一对应。 */
export const SOURCE_LABELS: Record<Pattern["source"], string> = { EXTRACTED: "提取", GENERATED: "起稿", UPLOADED: "上传", DERIVED: "衍生" };

/** 筛选栏的来源选项；ALL 之外与 PatternSource 一一对应。 */
export const SOURCE_FILTERS: Array<{ value: "ALL" | Pattern["source"]; label: string }> = [
  { value: "ALL", label: "全部" },
  { value: "EXTRACTED", label: "提取" },
  { value: "GENERATED", label: "起稿" },
  { value: "UPLOADED", label: "上传" },
  { value: "DERIVED", label: "衍生" },
];

/** 首版跨境三平台；平台字数为后端硬校验，这里只负责选择。 */
export const LISTING_PLATFORM_OPTIONS: Array<{ value: ListingPlatform; label: string }> = [
  { value: "ETSY", label: "Etsy" },
  { value: "AMAZON", label: "Amazon Merch" },
  { value: "TIKTOK_SHOP", label: "TikTok Shop" },
];

/** 版式的两个取值与中文标签：四处 chip 行共用的唯一清单，加档位只改这里。 */
export const POD_PRINT_LAYOUT_OPTIONS: Array<{ value: PodPrintLayout; label: string }> = [
  { value: "CENTERED", label: "居中" },
  { value: "TILE", label: "平铺满印" },
];

/** 规格目录选项的统一标签：尺寸与 DPI 是选规格时真正要看的两个数，四处下拉共用一份拼法。 */
export function podSpecOptionLabel(spec: PodPrintSpec): string {
  return `${spec.label}（${spec.widthPx}×${spec.heightPx} · ${spec.dpi}DPI）`;
}

/**
 * 版式 chips：花型墙与工作区各有一套 chip 类（密度不同），variant 决定用哪套。
 * 只换类名不换语义——把四处逐字相同的 map 收成一件。
 */
export function LayoutChipRow({ value, onChange, variant = "wall", ariaLabel = "版式" }: {
  value: PodPrintLayout;
  onChange: (layout: PodPrintLayout) => void;
  variant?: "wall" | "rail";
  ariaLabel?: string;
}) {
  const row = variant === "rail" ? railStyles.wsChipRow : styles.chipRow;
  const chip = variant === "rail" ? railStyles.wsChip : styles.chip;
  const chipActive = variant === "rail" ? railStyles.wsChipActive : styles.chipActive;
  return (
    <div className={row} role="group" aria-label={ariaLabel}>
      {POD_PRINT_LAYOUT_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? `${chip} ${chipActive}` : chip}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 生图模型候选（花型域三处共用）：useProviders + modelOptions("image") 的固定组合，省三份 useMemo 链。 */
export function useImageModelOptions(): ModelOption[] {
  const providersQuery = useProviders();
  return useMemo(() => modelOptions(providersQuery.data?.items ?? [], "image"), [providersQuery.data]);
}

/**
 * 可平铺徽标：VERIFIED / FAILED 才渲染，NONE（未校验）不渲染——"还没验过"不是缺陷，
 * 无条件标出来只会成为噪声；而 FAILED 必须可见，这正是竞品普遍隐藏掉的那一步。
 */
export function tileableBadge(tileable: Pattern["tileable"]): { label: string; className: string | undefined } | null {
  if (tileable === "VERIFIED") return { label: "可平铺", className: styles.badgeOk };
  if (tileable === "FAILED") return { label: "接缝明显", className: styles.badgeWarn };
  return null;
}

/** 占位卡/衍生进度的阶段文案：不确定的进度用阶段标签表达，不做匀速假进度。 */
export function stageText(kind: "EXTRACT" | "FORGE" | "DERIVE" | "VARIANT", status: string, progress: number): string {
  if (status === "QUEUED") return "排队中…";
  if (kind === "EXTRACT") {
    if (progress < 15) return "提交源图…";
    if (progress < 60) return "分割图案区域…";
    if (progress < 90) return "抠除背景…";
    return "写入花型库…";
  }
  if (kind === "DERIVE") {
    if (progress < 60) return "本地运算中…";
    return "写入花型库…";
  }
  if (kind === "VARIANT") {
    if (progress < 40) return "按源花型改写…";
    return "写入花型库…";
  }
  if (progress < 20) return "编译构图…";
  if (progress < 80) return "生成候选图…";
  return "写入花型库…";
}

/**
 * 状态语义：rail 内所有"某件事跑到哪一步"的展示共用这一套色调与文案。
 *
 * 以前三处各维护一份映射表（步骤卡、流水线整体、规格包），同一个 RUNNING 在三处被写成三种说法，
 * 加一个状态要改三个地方；这里收成一份。`blocked` 单独留给"在等你做决定"——它不是失败也不是进行中，
 * 用告警色而不是错误色，因为这类停等是设计好的等待，不是故障。
 */
export type StatusTone = "neutral" | "busy" | "ok" | "failed" | "blocked";

const STATUS_TONE_CLASS: Record<StatusTone, string | undefined> = {
  neutral: styles.statusNeutral,
  busy: styles.statusBusy,
  ok: styles.statusOk,
  failed: styles.statusFailed,
  blocked: styles.statusBlocked,
};

/** 未登记的状态原样返回：不猜它的含义，也不假装它是成功。 */
export function statusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "等待";
    case "QUEUED":
      return "排队中";
    case "RUNNING":
      return "进行中";
    case "SUCCEEDED":
      return "已完成";
    case "FAILED":
      return "失败";
    case "CANCELLED":
      return "已取消";
    case "AWAITING_INPUT":
      return "等你决定";
    default:
      return status;
  }
}

export function statusTone(status: string): StatusTone {
  if (status === "SUCCEEDED") return "ok";
  if (status === "FAILED") return "failed";
  if (status === "AWAITING_INPUT") return "blocked";
  if (status === "QUEUED" || status === "RUNNING") return "busy";
  return "neutral";
}

export function StatusPill({ tone, children, title }: { tone: StatusTone; children: ReactNode; title?: string }) {
  return (
    <span className={[styles.statusPill, STATUS_TONE_CLASS[tone]].filter(Boolean).join(" ")} title={title}>
      {children}
    </span>
  );
}

/**
 * 节标题行：标题 + 该节状态徽标 + 右侧动作槽。
 *
 * 状态提到标题上，是为了不必滚进节里才知道这一节跑完了没有；`sticky` 变体给主路径节用，
 * 滚动它自己的收据时标题仍留在栏顶。
 */
export function SectionHead({ title, status, sticky = false }: { title: string; status?: ReactNode; sticky?: boolean }) {
  return (
    <h3 className={sticky ? `${styles.sectionHead} ${styles.sectionHeadSticky}` : styles.sectionHead}>
      <span className={styles.sectionHeadTitle}>{title}</span>
      {status}
    </h3>
  );
}

/**
 * 生图模型选择（花型域通用）：起稿、画风/构图衍生的候选模型来源。
 * 局部用 localStorage 记住上一次选择——全局页没有项目配置可继承，每次重选同一模型是纯粹的摩擦。
 *
 * 尺寸由调用方给：rail 内一切控件走小密度，而花型墙的弹窗沿用默认尺寸，
 * 组件里写死任一种都会让另一边和别人不齐。
 */
export function ImageModelSelect({ value, onChange, storageKey, label = "生图模型", size }: { value: string | null; onChange: (key: string) => void; storageKey: string; label?: string; size?: "small" | "middle" }) {
  const imageOptions = useImageModelOptions();

  useEffect(() => {
    if (value || imageOptions.length === 0) return;
    const stored = window.localStorage.getItem(storageKey);
    onChange(stored && imageOptions.some((option) => option.value === stored) ? stored : imageOptions[0]!.value);
  }, [value, imageOptions, onChange, storageKey]);

  // 记忆写在组件里：读与写是同一件事的两半，收进来调用方才不会漏（以前只有读，记忆从未生效）。
  const select = (key: string) => {
    window.localStorage.setItem(storageKey, key);
    onChange(key);
  };

  return (
    <Select
      size={size}
      style={{ width: "100%" }}
      placeholder={label}
      aria-label={label}
      value={value}
      onChange={select}
      options={imageOptions.map((option) => ({ value: option.value, label: option.label }))}
      notFoundContent={<span style={{ fontSize: 12 }}>没有可用的生图模型，请先在设置中配置</span>}
    />
  );
}

/**
 * 底版选择：白底 / 透明底（衍生多一个"跟随源图"）。
 *
 * "透明底"是参数级能力，不是提示词风格——模型给不了时它只会照提示词画一块看起来透明的棋盘格。
 * 所以模型不支持就把这一项禁掉并写明原因（判定与 worker 同源，见 contracts 的
 * supportsTransparentBackground），而不是让用户选完再被服务端拒绝。
 *
 * 一旦当前选择因换模型而变得不可用，自动退到 `fallback`：留一个禁用但仍被选中的值，
 * antd 会渲染成空选择，用户看到的是"设置丢了"而不是"这个模型不行"。
 *
 * 模式集合用泛型而不是 PatternBackgroundMode：起稿的请求体在契约里收窄掉了 SOURCE，
 * 这里跟着收窄，编译期就能挡住"起稿发了跟随源图"。
 */
export function BackgroundModeSelect<M extends PatternBackgroundMode>({ value, onChange, modes, fallback, transparentAvailable, size }: {
  value: M;
  onChange: (mode: M) => void;
  modes: readonly M[];
  /** 被禁用的当前值退到哪一档：起稿退白底，衍生退跟随源图。 */
  fallback: M;
  transparentAvailable: boolean;
  size?: "small" | "middle";
}) {
  useEffect(() => {
    if (value === "TRANSPARENT" && !transparentAvailable) onChange(fallback);
  }, [value, transparentAvailable, onChange, fallback]);

  return (
    <Select
      size={size}
      style={{ width: "100%" }}
      aria-label="底版"
      value={value}
      onChange={onChange}
      options={modes.map((mode) => {
        const blocked = mode === "TRANSPARENT" && !transparentAvailable;
        return {
          value: mode,
          label: blocked ? `${PATTERN_BACKGROUND_MODE_LABELS[mode]}（所选模型不支持）` : PATTERN_BACKGROUND_MODE_LABELS[mode],
          disabled: blocked,
        };
      })}
    />
  );
}

/** Listing 文案的推理模型选择（需支持视觉）：花型域没有项目配置，最近一次选择持久化在 localStorage。 */
export function ListingModelSelect({ value, onChange, size }: { value: string | null; onChange: (key: string) => void; size?: "small" | "middle" }) {
  const providersQuery = useProviders();
  // 看图写文案要求视觉输入；纯文本推理模型不进入候选。
  const reasoningOptions = useMemo(
    () => modelOptions(providersQuery.data?.items ?? [], "reasoning").filter((option) => option.vision),
    [providersQuery.data],
  );

  // 未选择时回填默认值：localStorage 的最近选择优先，其次取第一个视觉模型。
  useEffect(() => {
    if (value || reasoningOptions.length === 0) return;
    const stored = window.localStorage.getItem("ecomgen.patterns.listing");
    onChange(stored && reasoningOptions.some((option) => option.value === stored) ? stored : reasoningOptions[0]!.value);
  }, [value, reasoningOptions, onChange]);

  // 与 ImageModelSelect 同理：写也收进组件，三个调用入口（工作区/流水线/批量文案）行为一致。
  const select = (key: string) => {
    window.localStorage.setItem("ecomgen.patterns.listing", key);
    onChange(key);
  };

  return (
    <Select
      size={size}
      style={{ width: "100%" }}
      placeholder="推理模型（需支持视觉）"
      aria-label="文案推理模型"
      value={value}
      onChange={select}
      options={reasoningOptions.map((option) => ({ value: option.value, label: option.label }))}
      notFoundContent={<span style={{ fontSize: 12 }}>没有支持视觉的推理模型，请先在设置中配置</span>}
    />
  );
}

export function CopyRow({ label, value }: { label: string; value: string }) {
  const { message } = App.useApp();
  return (
    <div className={styles.copyRow}>
      <span className={styles.copyLabel}>{label}</span>
      <span className={styles.copyValue}>{value}</span>
      <Button
        size="small"
        type="text"
        icon={<Copy size={12} strokeWidth={2} />}
        aria-label={`复制${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            message.success("已复制");
          } catch {
            message.error("复制失败，请手动选择文本");
          }
        }}
      />
    </div>
  );
}

/** 「接着成包」的草稿：勾选才发字段，未勾选时源入口的请求体与从前一字不差。 */
export interface PipelineAnswerDraft {
  enabled: boolean;
  specId: string | null;
  layout: PodPrintLayout;
  platform: ListingPlatform;
  modelKey: string | null;
}

export const EMPTY_PIPELINE_ANSWERS: PipelineAnswerDraft = { enabled: false, specId: null, layout: "CENTERED", platform: "ETSY", modelKey: null };

/** 缺失项的用户提示；返回 null 表示可以提交。缺项不让提交，而不是发一份会被服务端拒绝的半份答案。 */
export function missingPipelineAnswer(draft: PipelineAnswerDraft): string | null {
  if (!draft.enabled) return null;
  if (!draft.specId) return "接着成包需要选择品类规格";
  if (!draft.modelKey) return "接着成包需要选择文案模型（需支持视觉）";
  return null;
}

/** 草稿 → 请求体；未勾选返回 undefined，调用方据此决定要不要带这个字段。 */
export function toPipelineAnswers(draft: PipelineAnswerDraft): PatternPipelineAnswers | undefined {
  if (!draft.enabled || !draft.specId || !draft.modelKey) return undefined;
  const { providerId, modelId } = parseModelKey(draft.modelKey);
  return { specId: draft.specId, layout: draft.layout, listingPlatform: draft.platform, listingProviderId: providerId, listingModelId: modelId };
}

/**
 * 「接着成包」的折叠答案区：源入口（提取/起稿/上传）里的可选加速器。
 *
 * 默认收起——"我只想先拿到花型"是最常见的意图，把三个问题摊在源入口上会让常规路径变慢；
 * 勾选后才会把答案随同一请求发出去，服务端在源任务成功后自动接着跑完整条链。
 */
export function PipelineAnswersBlock({ draft, onChange }: { draft: PipelineAnswerDraft; onChange: (next: PipelineAnswerDraft) => void }) {
  const specsQuery = usePodPrintSpecs();
  const specs = specsQuery.data?.items ?? [];
  return (
    <div className={styles.pipelineToggle}>
      <Checkbox checked={draft.enabled} onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}>
        接着成包（验缝 → 规格包 → 文案）
      </Checkbox>
      {draft.enabled ? (
        <div className={styles.formRow}>
          <p className={styles.formHint}>产物就绪后自动接着跑完整条流水线；Listing 文案会调用你选的模型，这一步会产生费用。</p>
          <Select
            style={{ width: "100%" }}
            placeholder="品类规格"
            aria-label="接着成包品类规格"
            value={draft.specId}
            onChange={(specId) => onChange({ ...draft, specId })}
            options={specs.map((spec) => ({ value: spec.id, label: podSpecOptionLabel(spec) }))}
          />
          <LayoutChipRow
            value={draft.layout}
            onChange={(layout) => onChange({ ...draft, layout })}
            ariaLabel="接着成包版式"
          />
          <Select
            style={{ width: "100%" }}
            aria-label="接着成包目标平台"
            value={draft.platform}
            onChange={(platform) => onChange({ ...draft, platform })}
            options={LISTING_PLATFORM_OPTIONS}
          />
          <ListingModelSelect value={draft.modelKey} onChange={(modelKey) => onChange({ ...draft, modelKey })} />
        </div>
      ) : null}
    </div>
  );
}
