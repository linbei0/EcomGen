import { useMemo, useState, type ReactNode } from "react";
import { App, Button, Drawer, Input, Select, Tag, Tooltip } from "antd";
import { ChevronDown, Dices, Eraser, Wand2 } from "lucide-react";

import {
  MODEL_CAST_PRESETS,
  MODEL_PROMPT_WORD_BUDGET,
  MODEL_SPEC_FIELDS,
  MODEL_SPEC_LAYERS,
  MODEL_SPEC_MULTI_FIELD_DEFS,
  MODEL_SPEC_MULTI_FIELDS,
  blockedModelOptions,
  compileModelPortraitPrompt,
  modelOptionIssue,
  reconcileModelSpecDraft,
  repairModelSpec,
  type ModelOptionDef,
  type ModelOptionIssue,
  type ModelSpecKey,
  type ModelSpecLayerId,
} from "@ecomgen/ecom-skill";
import { MAX_MODEL_NAME_LENGTH, MAX_MODEL_NOTES_LENGTH, MODEL_SPEC_DEFAULTS, type ModelSpec } from "@ecomgen/contracts";

import { useCreateModel } from "../../api/hooks/useModels";
import { errorText } from "../../lib/errorText";
import styles from "./ModelsPage.module.css";

/**
 * 展示层数据驱动的字段视图：MODEL_SPEC_FIELDS 的泛型键在渲染层统一放宽为 string，
 * 类型安全由编译器侧（ecom-skill）与契约校验兜底，UI 层不做重复 narrowing。
 */
type FieldView = { label: string; layer: ModelSpecLayerId; options: Record<string, ModelOptionDef> };
const SINGLE_FIELDS = MODEL_SPEC_FIELDS as unknown as Record<string, FieldView>;
const MULTI_FIELDS = MODEL_SPEC_MULTI_FIELD_DEFS as unknown as Record<string, FieldView>;

/** 设计器草稿：单选维度可留空（undefined），多选维度空数组即未选。 */
type PartialModelSpec = { [K in keyof ModelSpec]?: ModelSpec[K] };

/** 至少显式选择的维度数；其余维度保存时以 MODEL_SPEC_DEFAULTS 补全，合约始终完整。 */
const MIN_EXPLICIT_DIMENSIONS = 5;

/** 草稿里已显式指定的维度；这些维度在收敛时优先保留，不被补全出来的默认值顶掉。 */
function explicitKeys(draft: PartialModelSpec): Set<ModelSpecKey> {
  return new Set(
    Object.entries(draft)
      .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : value !== undefined))
      .map(([key]) => key as ModelSpecKey),
  );
}

/**
 * 草稿补全为完整 spec：留空维度落入基准款默认值，再修复一次互斥。
 *
 * 修复不可省：基准默认值可能撞上用户显式选择（显式选了儿童、默认的日常淡妆就要让位），
 * 只补全不修复会把矛盾一路带到编译层。
 */
function completeSpec(draft: PartialModelSpec): ModelSpec {
  // 写入侧放宽为 string 键：keyof ModelSpec 的赋值目标类型会被收窄成 never。
  const merged: Record<string, unknown> = { ...MODEL_SPEC_DEFAULTS };
  for (const [key, value] of Object.entries(draft)) {
    if (value === undefined) continue;
    merged[key] = value;
  }
  return repairModelSpec(merged as ModelSpec, explicitKeys(draft)).spec;
}

/** 显式选择的维度数：单选有值 / 多选非空数组各计 1。 */
function countExplicit(draft: PartialModelSpec): number {
  return Object.values(draft).filter((value) => (Array.isArray(value) ? value.length > 0 : value !== undefined)).length;
}

/** 维度中文名，用于把「已移除哪些维度」讲成人话。 */
function fieldName(key: ModelSpecKey): string {
  return SINGLE_FIELDS[key]?.label ?? MULTI_FIELDS[key]?.label ?? key;
}

interface ModelDesignerProps {
  open: boolean;
  onClose: () => void;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function randomOf<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)]!;
}

/**
 * 掷骰只随机当前层的字段。
 *
 * 逐维取「与当前草稿不冲突」的随机值，而不是随机完再回收：随机结果必须直接可用，
 * 否则用户会遇到掷骰之后若干维度被清成未指定。多选按上限随机重挑，保证结果可直接保存。
 */
function randomizeLayer(spec: PartialModelSpec, layer: ModelSpecLayerId): PartialModelSpec {
  // 写入侧放宽为 string 键：keyof ModelSpec 的赋值目标类型会被收窄成 never。
  const next = { ...spec } as Record<string, unknown>;
  for (const [key, field] of Object.entries(SINGLE_FIELDS)) {
    if (field.layer !== layer) continue;
    const allowed = Object.keys(field.options).filter((value) => modelOptionIssue(key as ModelSpecKey, value, next as PartialModelSpec)?.kind !== "conflict");
    if (allowed.length > 0) next[key] = randomOf(allowed);
  }
  for (const { key, max } of MODEL_SPEC_MULTI_FIELDS) {
    const field = MULTI_FIELDS[key]!;
    if (field.layer !== layer) continue;
    const pool = Object.keys(field.options).filter((value) => modelOptionIssue(key, value, next as PartialModelSpec)?.kind !== "conflict");
    const picked = new Set<string>();
    const count = Math.min(Math.floor(Math.random() * (max + 1)), pool.length);
    while (picked.size < count) picked.add(randomOf(pool));
    next[key] = [...picked];
  }
  return next as PartialModelSpec;
}

/** 清空一层：单选回到未选，多选清空数组。 */
function clearLayer(spec: PartialModelSpec, layer: ModelSpecLayerId): PartialModelSpec {
  const next = { ...spec } as Record<string, unknown>;
  for (const [key, field] of Object.entries(SINGLE_FIELDS)) {
    if (field.layer === layer) next[key] = undefined;
  }
  for (const { key } of MODEL_SPEC_MULTI_FIELDS) {
    if (MULTI_FIELDS[key]!.layer === layer) next[key] = [];
  }
  return next as PartialModelSpec;
}

/** 逐维比较草稿与预设：多选按集合比，勾选顺序不影响判定。 */
function sameDraftValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && [...a].sort().join("+") === [...b].sort().join("+");
  }
  return a === b;
}

/**
 * 草稿是否仍逐维等于某个预设。不一致就是「自定义」——改了任意一维之后，
 * 下拉框不能继续宣称还套着原来那个人设。
 */
function matchesPreset(draft: PartialModelSpec, presetSpec: ModelSpec): boolean {
  return (Object.keys(presetSpec) as Array<keyof ModelSpec>).every((key) => sameDraftValue(draft[key], presetSpec[key]));
}

/** 每层「已选/总维度」计数：层折叠起来之后，仍然看得出这层定了多少。 */
function countLayerPicks(draft: PartialModelSpec): Map<ModelSpecLayerId, { picked: number; total: number }> {
  const counts = new Map<ModelSpecLayerId, { picked: number; total: number }>();
  const bump = (layer: ModelSpecLayerId, picked: boolean) => {
    const entry = counts.get(layer) ?? { picked: 0, total: 0 };
    counts.set(layer, { picked: entry.picked + (picked ? 1 : 0), total: entry.total + 1 });
  };
  for (const [key, field] of Object.entries(SINGLE_FIELDS)) bump(field.layer, draft[key as ModelSpecKey] !== undefined);
  for (const { key } of MODEL_SPEC_MULTI_FIELDS) bump(MULTI_FIELDS[key]!.layer, ((draft[key] as string[] | undefined) ?? []).length > 0);
  return counts;
}

/** 预设下拉项：名称进输入框，描述在下拉里展开——十几个人设平铺会把整页向下顶。 */
const PRESET_OPTIONS = MODEL_CAST_PRESETS.map((preset) => ({ value: preset.id, label: preset.name, description: preset.description }));

/**
 * 选角设计器：四层选项全部来自 ecom-skill 单源映射，prompt 预览与 worker 编译结果逐字一致。
 *
 * 只用于新建。规格是模特的身份合约——一旦落库，全站所有生成都以它为同一张脸的基准，
 * 因此不提供「创建后再改规格」的入口：能随时改，就等于没有基准。
 */
export function ModelDesigner({ open, onClose }: ModelDesignerProps) {
  const { message } = App.useApp();
  const createModel = useCreateModel();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  // 草稿允许留空：从全空起步，未指定的维度保存时按基准款补全。
  const [spec, setSpec] = useState<PartialModelSpec>({});

  const fullSpec = useMemo(() => completeSpec(spec), [spec]);
  const explicitCount = useMemo(() => countExplicit(spec), [spec]);
  // 互斥判定按草稿记忆化：备注与名称的输入不触发重算，选项禁用态也就能直接做 Map 查表。
  const blocked = useMemo(() => blockedModelOptions(spec), [spec]);
  const layerCounts = useMemo(() => countLayerPicks(spec), [spec]);
  // 套用过的预设只在规格逐维一致时成立，改过任意一维就回落到「自定义」。
  const activePreset = useMemo(() => MODEL_CAST_PRESETS.find((preset) => matchesPreset(spec, preset.spec)) ?? null, [spec]);
  const prompt = useMemo(() => compileModelPortraitPrompt(fullSpec, notes), [fullSpec, notes]);
  const words = countWords(prompt);
  const overBudget = words > MODEL_PROMPT_WORD_BUDGET;
  const notEnoughPicks = explicitCount < MIN_EXPLICIT_DIMENSIONS;
  const saving = createModel.isPending;

  /**
   * 层的折叠状态。默认全部展开：打开就少一层比多滚两屏更让人意外。
   * 折叠是纯展示偏好、不进草稿，收起来只影响滚动长度。
   */
  const [collapsedLayers, setCollapsedLayers] = useState<ReadonlySet<ModelSpecLayerId>>(() => new Set<ModelSpecLayerId>());
  const toggleLayer = (layer: ModelSpecLayerId) => {
    setCollapsedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  };

  /** 套用预设：整份规格替换，随后仍可逐层微调。 */
  const applyPreset = (presetId: string) => {
    const preset = MODEL_CAST_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    // 预设与契约基准款都是模块级冻结对象：复制一份（含两个数组）再进 state，
    // 避免可编辑草稿与全站共享的基准数据共用同一个引用。
    setSpec({ ...preset.spec, distinctiveMarks: [...preset.spec.distinctiveMarks], aura: [...preset.spec.aura] });
    message.info(`已套用「${preset.name}」人设，可继续逐层微调`);
  };

  /**
   * 所有草稿改动都走这里：先应用改动，再按「刚动的维度优先」收敛掉被动冲突。
   *
   * 收敛是落库自洽的前提——界面禁用只能阻止用户主动选出矛盾，挡不住「先选了红唇、
   * 再把年龄改成 7 岁」这种改动一侧导致另一侧失效的路径。
   */
  const applyDraft = (changed: ModelSpecKey, next: PartialModelSpec) => {
    const { spec: reconciled, dropped } = reconcileModelSpecDraft(next, new Set([changed]));
    setSpec(reconciled);
    if (dropped.length > 0) {
      message.info(`已移除与「${fieldName(changed)}」互斥的 ${dropped.length} 项：${dropped.map(fieldName).join("、")}`);
    }
  };

  /** 单选：写入后收敛。 */
  const pickSingle = (key: string, value: string) => {
    const cleared = spec[key as ModelSpecKey] === value;
    applyDraft(key as ModelSpecKey, { ...spec, [key]: cleared ? undefined : value });
  };

  /** 多选：增删一项后收敛（收敛只可能清掉别处的单选项）。 */
  const pickMulti = (key: string, value: string, max: number) => {
    const list = (spec[key as ModelSpecKey] as string[] | undefined) ?? [];
    const picked = list.includes(value) ? list.filter((item) => item !== value) : [...list, value].slice(0, max);
    applyDraft(key as ModelSpecKey, { ...spec, [key]: picked });
  };

  /** 掷骰结果由引擎逐维筛选，本身就是自洽的；预设同理，两者都不需要再收敛。 */
  const randomize = (layer: ModelSpecLayerId) => setSpec((prev) => randomizeLayer(prev, layer));

  const handleSave = async () => {
    if (!name.trim()) {
      message.warning("先给模特起个名字");
      return;
    }
    if (notEnoughPicks) {
      message.warning(`至少选择 ${MIN_EXPLICIT_DIMENSIONS} 项，当前已选 ${explicitCount} 项`);
      return;
    }
    try {
      await createModel.mutateAsync({ name: name.trim(), spec: fullSpec, notes });
      message.success("模特已创建，可在右侧发起定妆照生成");
      onClose();
    } catch (error) {
      message.error(errorText(error));
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="min(1120px, 94vw)"
      title="新建模特"
      footer={
        <div className={styles.designerFooter}>
          <span className={styles.designerCounter}>
            已选 {explicitCount} 项{notEnoughPicks ? `（至少 ${MIN_EXPLICIT_DIMENSIONS} 项，留空维度按基准款生成）` : ""}
          </span>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} disabled={notEnoughPicks} onClick={() => void handleSave()}>
            创建模特
          </Button>
        </div>
      }
    >
      {/* 左栏编辑人设、右栏是编译结果：结果常驻在视线内，改一处不必翻到底再翻回来。 */}
      <div className={styles.designerLayout}>
        <div className={styles.designerColumn}>
          <section className={styles.designerSection}>
            <SectionHead title="名字" hint="只用于在库里辨认，不进入提示词。" />
            <Input value={name} maxLength={MAX_MODEL_NAME_LENGTH} placeholder="例如：小满" onChange={(event) => setName(event.target.value)} />
          </section>

          <section className={styles.designerSection}>
            <SectionHead title="快速预设" hint="按人设起手，套用后仍可逐层微调；改动任意一维即回落到自定义。" />
            <Select
              className={styles.presetSelect}
              value={activePreset?.id}
              placeholder="自定义（未套用预设）"
              prefix={<Wand2 size={14} strokeWidth={1.75} />}
              showSearch
              optionFilterProp="label"
              options={PRESET_OPTIONS}
              classNames={{ popup: { root: styles.presetDropdown } }}
              onChange={applyPreset}
              optionRender={(option) => {
                const preset = option.data as { label: string; description: string };
                return (
                  <div className={styles.presetOption}>
                    <span className={styles.presetOptionName}>{preset.label}</span>
                    <span className={styles.presetOptionDesc}>{preset.description}</span>
                  </div>
                );
              }}
            />
          </section>

          {MODEL_SPEC_LAYERS.map((layer, index) => {
            const count = layerCounts.get(layer.id) ?? { picked: 0, total: 0 };
            const collapsed = collapsedLayers.has(layer.id);
            return (
              <section key={layer.id} className={styles.layer}>
                <LayerHead index={String(index + 1).padStart(2, "0")} title={layer.title} count={count} collapsed={collapsed} onToggle={() => toggleLayer(layer.id)}>
                  <Button size="small" type="text" icon={<Dices size={14} strokeWidth={1.75} />} onClick={() => randomize(layer.id)}>
                    掷骰
                  </Button>
                  <Button size="small" type="text" icon={<Eraser size={14} strokeWidth={1.75} />} title="清空本层选择，未指定维度按基准款生成" onClick={() => setSpec((prev) => clearLayer(prev, layer.id))}>
                    清空本层
                  </Button>
                </LayerHead>
                {collapsed ? null : (
                  <>
                    <p className={styles.sectionHint}>{layer.hint}</p>
                    <div className={styles.fieldList}>
                      {Object.entries(SINGLE_FIELDS)
                        .filter(([, field]) => field.layer === layer.id)
                        .map(([key, field]) => (
                          <ChipField
                            key={key}
                            fieldKey={key}
                            label={field.label}
                            options={field.options}
                            blocked={blocked}
                            isActive={(value) => spec[key as keyof ModelSpec] === value}
                            onPick={(value) => pickSingle(key, value)}
                          />
                        ))}
                      {Object.entries(MULTI_FIELDS)
                        .filter(([, field]) => field.layer === layer.id)
                        .map(([key, field]) => {
                          const multi = MODEL_SPEC_MULTI_FIELDS.find((item) => item.key === key)!;
                          // 草稿里多选键可能尚未写入（新建全空起步），undefined 视为未选。
                          const picked = (spec[key as keyof PartialModelSpec] as string[] | undefined) ?? [];
                          return (
                            <ChipField
                              key={key}
                              fieldKey={key}
                              label={field.label}
                              hint={`至多 ${multi.max} 项`}
                              options={field.options}
                              blocked={blocked}
                              isActive={(value) => picked.includes(value)}
                              onPick={(value) => pickMulti(key, value, multi.max)}
                            />
                          );
                        })}
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>

        <aside className={styles.previewPane}>
          <SectionHead title="定妆照提示词预览">
            <Tag color={overBudget ? "warning" : "default"}>{words} / {MODEL_PROMPT_WORD_BUDGET} 词</Tag>
          </SectionHead>
          <div className={styles.promptPreview}>{prompt}</div>
          <p className={styles.promptNote}>
            提示词由规格确定性编译：同一规格在任何生成里都复现同一个人设段落，这正是模特可全站复用的前提。创建后若上传参考脸，实发生成会在最前面追加一句「以该脸为唯一身份基准」的锚点句。
          </p>
          <section className={styles.designerSection}>
            <SectionHead title="补充要求" hint="硬性要求，始终附加在提示词末尾，不参与词数预算。" />
            <Input.TextArea
              value={notes}
              maxLength={MAX_MODEL_NOTES_LENGTH}
              rows={3}
              placeholder="例如：左右手各戴一枚素圈戒指"
              onChange={(event) => setNotes(event.target.value)}
            />
          </section>
        </aside>
      </div>
    </Drawer>
  );
}

interface SectionHeadProps {
  title: string;
  hint?: string;
  /** 段操作（词数角标等）；有则钉在标题行行尾。 */
  children?: ReactNode;
}

/** 段落头：标题与操作同一行，说明单独占一行，避免长说明把按钮顶到远端。 */
function SectionHead({ title, hint, children }: SectionHeadProps) {
  return (
    <>
      <div className={styles.designerHead}>
        <h3 className={styles.designerTitle}>{title}</h3>
        {children ? <span className={styles.sectionActions}>{children}</span> : null}
      </div>
      {hint ? <p className={styles.sectionHint}>{hint}</p> : null}
    </>
  );
}

interface LayerHeadProps {
  index: string;
  title: string;
  /** 该层已选/总维度数，收起后仍能看出这层定了多少。 */
  count: { picked: number; total: number };
  collapsed: boolean;
  onToggle: () => void;
  /** 层操作（掷骰、清空本层）；与折叠按钮并列，避免按钮里套按钮。 */
  children?: ReactNode;
}

/** 层头：整行可点折叠，右侧钉着该层的已选计数与层操作。 */
function LayerHead({ index, title, count, collapsed, onToggle, children }: LayerHeadProps) {
  return (
    <div className={styles.layerHead}>
      <button type="button" className={styles.layerToggle} aria-expanded={!collapsed} onClick={onToggle}>
        <ChevronDown size={14} strokeWidth={2} className={collapsed ? styles.chevronCollapsed : styles.chevron} />
        <span className={styles.layerIndex}>{index}</span>
        <span className={styles.designerTitle}>{title}</span>
        <span className={styles.layerCount}>{count.picked}/{count.total}</span>
      </button>
      {children ? <span className={styles.sectionActions}>{children}</span> : null}
    </div>
  );
}

interface ChipFieldProps {
  fieldKey: string;
  label: string;
  hint?: string;
  options: Record<string, ModelOptionDef>;
  blocked: ReadonlyMap<string, ModelOptionIssue>;
  isActive: (value: string) => boolean;
  onPick: (value: string) => void;
}

/**
 * 单个维度：字段名定宽在左、选项在右；字段各占一行，换行不会把相邻字段推歪。
 *
 * 互斥项按 ecom-skill 的判定结果禁用并给出原因——用户看到的是「为什么不能选」，
 * 而不是一个点了没反应的按钮。已选中的项不因阻塞而禁用：它可能是当前维度里
 * 「不参与编译」的取值（童模的身高锚点），禁用会把已选状态画成一个坏掉的控件。
 */
function ChipField({ fieldKey, label, hint, options, blocked, isActive, onPick }: ChipFieldProps) {
  const issues = Object.keys(options)
    .map((value) => blocked.get(`${fieldKey}:${value}`))
    .filter((issue): issue is ModelOptionIssue => issue !== undefined);
  // 维度级「不参与」是整维的说明，移到字段名旁边，不逐个压在选项上。
  const note = issues.find((issue) => issue.kind === "inapplicable")?.reason;
  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldName}>
        {label}
        {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
      </span>
      <div className={styles.fieldOptions}>
        {note ? <span className={styles.fieldNote}>{note}</span> : null}
        <div className={styles.chipRow}>
          {Object.entries(options).map(([value, option]) => {
            const active = isActive(value);
            const issue = blocked.get(`${fieldKey}:${value}`);
            const locked = issue?.kind === "conflict" && !active;
            const chip = (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                disabled={locked}
                className={`${active ? styles.chipActive : styles.chip} ${locked ? styles.chipBlocked : ""}`.trim()}
                onClick={() => onPick(value)}
              >
                {option.label}
              </button>
            );
            return locked ? <Tooltip key={value} title={issue.reason}>{chip}</Tooltip> : chip;
          })}
        </div>
      </div>
    </div>
  );
}
