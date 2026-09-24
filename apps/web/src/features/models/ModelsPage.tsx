import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Image, Input, Progress, Select, Skeleton } from "antd";
import {
  Camera,
  ChevronDown,
  Dices,
  Images,
  Plus,
  ScanFace,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import {
  MODEL_SPEC_FIELDS,
  MODEL_SPEC_MULTI_FIELD_DEFS,
  compileModelCastPrompt,
  modelSpecSummary,
  type ModelOptionDef,
  type ModelSpecLayerId,
} from "@ecomgen/ecom-skill";
import { MODEL_CAST_CANDIDATES_MAX, type ModelSpec } from "@ecomgen/contracts";

import {
  useCreateModelCastJob,
  useDeleteModel,
  useDeleteModelPortrait,
  useDeleteReferenceFace,
  useModelCastJob,
  useModelPortraits,
  useModels,
  useSelectModelPortrait,
  useUploadReferenceFace,
  type EcomModel,
  type ModelPortrait,
} from "../../api/hooks/useModels";
import { qk } from "../../api/queryKeys";
import { useProviders } from "../../api/hooks/useProviders";
import { AppTopbar } from "../../components/AppTopbar";
import { errorText } from "../../lib/errorText";
import { formatShortDate } from "../../lib/format";
import { modelOptions } from "../../lib/modelOptions";
import { ModelDesigner } from "./ModelDesigner";
import styles from "./ModelsPage.module.css";

function jobMessage(job: { error?: unknown } | undefined): string | null {
  const error = job?.error as { message?: unknown } | null | undefined;
  return typeof error?.message === "string" && error.message ? error.message : null;
}

/** 模特定妆照是人像摄影，只保留竖构图与方形画幅；横版（3:2/4:3/16:9/21:9）没有业务意义。 */
const MODEL_ASPECT_RATIOS: ReadonlyArray<string> = ["AUTO", "2:3", "3:4", "4:5", "9:16", "1:1"];

/** 少于该数量时列表短到一眼看完，搜索框只会占地方。 */
const SEARCH_THRESHOLD = 6;

/**
 * 展示层字段视图：MODEL_SPEC_FIELDS 的泛型键在渲染层统一放宽为 string。
 * 取值标签与设计师抽屉走同一份 ecom-skill 单源数据，两侧不会各自漂移。
 */
type FieldEntry = {
  key: string;
  layer: ModelSpecLayerId;
  label: string;
  options: Record<string, ModelOptionDef>;
};

// 单选在前、多选在后：层内顺序即编译器展开顺序，多选维度（特色标记、气质）排在本层末尾。
const SPEC_FIELD_ENTRIES: ReadonlyArray<FieldEntry> = [
  ...Object.entries(MODEL_SPEC_FIELDS as unknown as Record<string, Omit<FieldEntry, "key">>),
  ...Object.entries(MODEL_SPEC_MULTI_FIELD_DEFS as unknown as Record<string, Omit<FieldEntry, "key">>),
].map(([key, field]) => ({ key, layer: field.layer, label: field.label, options: field.options }));

function entriesOfLayer(layer: ModelSpecLayerId): ReadonlyArray<FieldEntry> {
  return SPEC_FIELD_ENTRIES.filter((entry) => entry.layer === layer);
}

const IDENTITY_ENTRIES = entriesOfLayer("identity");
const FEATURE_ENTRIES = entriesOfLayer("features");
/** 表达层与镜头呈现描述的是「这张定妆照怎么拍」，不是「这个人是谁」，默认折叠。 */
const PRESENTATION_ENTRIES = [...entriesOfLayer("expression"), ...entriesOfLayer("camera")];

/** 逐字段取值标签；多选维度返回多个，空数组与未指定维度都按空处理。 */
function specValueLabels(spec: ModelSpec, entry: FieldEntry): string[] {
  const raw = (spec as unknown as Record<string, unknown>)[entry.key];
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => entry.options[value]?.label ?? value);
}

/** 全局模特库：左边人物列表，右边定妆照主区与身份规格侧栏；所有入口都在这一页内闭环。 */
export function ModelsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const modelsQuery = useModels();
  const providersQuery = useProviders();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 只有「新建」一种设计器入口：规格落库即定稿，身份基准不允许事后改写。
  const [creating, setCreating] = useState(false);
  const [castJobId, setCastJobId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const models = useMemo(() => modelsQuery.data?.items ?? [], [modelsQuery.data]);
  const selected = models.find((model) => model.id === selectedId) ?? models[0] ?? null;
  const portraitsQuery = useModelPortraits(selected?.id);
  const portraits = useMemo(() => portraitsQuery.data?.items ?? [], [portraitsQuery.data]);
  const castJob = useModelCastJob(castJobId ?? undefined);

  // 名称与身份摘要都能命中：用户记得住的是「北欧那个高个」而不一定是名字。
  const filteredModels = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return models;
    return models.filter((model) =>
      `${model.name} ${modelSpecSummary(model.spec)}`.toLowerCase().includes(keyword),
    );
  }, [models, query]);

  const providers = providersQuery.data?.items ?? [];
  const imageOptions = useMemo(() => modelOptions(providers, "image"), [providers]);
  const [modelPair, setModelPair] = useState<string>(imageOptions[0]?.value ?? "");
  const [aspectRatio, setAspectRatio] = useState<string>("AUTO");
  const [candidateCount, setCandidateCount] = useState(1);
  const pairRef = useRef(modelPair);
  pairRef.current = modelPair;
  // 参考脸上传入口挂在圆圈本身，需要用它去点隐藏的 file input。
  const faceInput = useRef<HTMLInputElement>(null);

  // 选角任务进入终态后失效候选与列表缓存并停止跟踪；失败时把原因带到页面上。
  useEffect(() => {
    const status = castJob.data?.status;
    if (!castJobId || (status !== "SUCCEEDED" && status !== "FAILED" && status !== "CANCELLED")) return;
    setCastJobId(null);
    // 候选是逐个落库的：失败或取消也可能已经存下前几张，两个分支都要让页面看到它们，
    // 否则用户以为一张都没出，会为同一批候选重复付费。
    if (selected?.id) {
      void queryClient.invalidateQueries({ queryKey: qk.modelPortraits(selected.id) });
    }
    void queryClient.invalidateQueries({ queryKey: qk.models });
    if (status === "SUCCEEDED") message.success("定妆照已生成");
    else message.error(`定妆照生成失败：${jobMessage(castJob.data) ?? "请检查生图模型配置"}`);
    // selected 只用来定位失效范围，其引用变化不应重触发本 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castJobId, castJob.data, message, queryClient]);

  const cast = useCreateModelCastJob();
  const selectPortrait = useSelectModelPortrait();
  const deletePortrait = useDeleteModelPortrait();
  const deleteModel = useDeleteModel();
  const uploadFace = useUploadReferenceFace();
  const deleteFace = useDeleteReferenceFace();

  const castRunning = castJob.data?.status === "RUNNING" || castJob.data?.status === "QUEUED";

  const handleCast = async () => {
    if (!selected) return;
    const [providerId, imageModelId] = pairRef.current.split("::");
    if (!providerId || !imageModelId) {
      message.warning("请先在设置里配置一个支持生图的模型");
      return;
    }
    try {
      const { job, reused } = await cast.mutateAsync({
        modelId: selected.id,
        body: { providerId, imageModelId, aspectRatio: aspectRatio as never, candidateCount },
      });
      if (reused) {
        // 指纹命中了已成功的同参数任务：不会有新候选，也没有可轮询的任务，别报「已生成」骗人。
        message.info("参数与上一次完全相同，已复用上次的生成结果；需要新候选请调整画幅或候选数");
        return;
      }
      setCastJobId(job.id);
    } catch (error) {
      message.error(errorText(error));
    }
  };

  const handleDeleteModel = (model: EcomModel) => {
    modal.confirm({
      title: `删除模特「${model.name}」？`,
      content: "所有定妆照与参考脸会一并删除，使用该模特的已生成套图不受影响。",
      okButtonProps: { danger: true },
      okText: "删除",
      onOk: async () => {
        try {
          await deleteModel.mutateAsync(model.id);
          setSelectedId(null);
          message.success("已删除");
        } catch (error) {
          message.error(errorText(error));
        }
      },
    });
  };

  const handleFaceUpload = async (model: EcomModel, file: File) => {
    try {
      await uploadFace.mutateAsync({ modelId: model.id, file });
      message.success("参考脸已更新，后续生成将以这张脸为唯一身份基准");
    } catch (error) {
      message.error(errorText(error));
    }
  };

  const handleFaceClear = (model: EcomModel) => {
    modal.confirm({
      title: "清除参考脸？",
      content: "清除后，后续生成不再以这张人脸照片作为身份基准。",
      okButtonProps: { danger: true },
      okText: "清除",
      onOk: async () => {
        try {
          await deleteFace.mutateAsync(model.id);
          message.success("参考脸已清除");
        } catch (error) {
          message.error(errorText(error));
        }
      },
    });
  };

  return (
    <div className={styles.page}>
      <AppTopbar current="models" settingsOpen={false} onSettingsOpenChange={() => { }} />
      <div className={styles.content}>
        <aside className={styles.listPane}>
          <div className={styles.listHeader}>
            <h1 className={styles.title}>模特库</h1>
            <Button type="primary" icon={<Plus size={15} strokeWidth={2} />} onClick={() => setCreating(true)}>
              新建模特
            </Button>
          </div>
          <p className={styles.subtitle}>
            一次定妆，全站复用：规格化的模特在所有项目里保持同一张脸。
          </p>

          {models.length > 0 ? (
            <div className={styles.listTools}>
              {models.length >= SEARCH_THRESHOLD ? (
                <Input
                  allowClear
                  size="small"
                  value={query}
                  placeholder="按名字或身份筛选"
                  aria-label="筛选模特"
                  prefix={<Search size={13} strokeWidth={1.75} />}
                  onChange={(event) => setQuery(event.target.value)}
                />
              ) : null}
              <span className={styles.listCount}>
                {query.trim() ? `${filteredModels.length} / ${models.length} 位` : `共 ${models.length} 位`}
              </span>
            </div>
          ) : null}

          {modelsQuery.isLoading ? (
            <div className={styles.listSkeleton}>
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} active avatar={{ shape: "circle", size: 44 }} title={false} paragraph={{ rows: 1, width: "78%" }} />
              ))}
            </div>
          ) : models.length === 0 ? (
            <div className={styles.listEmpty}>
              <span className={styles.emptyGlyph}><UserRound size={24} strokeWidth={1.25} /></span>
              <p className={styles.emptyTitle}>还没有模特</p>
              <p className={styles.emptyHint}>
                模特是跨项目复用的身份。定妆一次，之后所有套图都保持同一张脸。
              </p>
              <Button type="primary" icon={<Plus size={15} strokeWidth={2} />} onClick={() => setCreating(true)}>
                新建第一位模特
              </Button>
            </div>
          ) : filteredModels.length === 0 ? (
            <div className={styles.listEmpty}>
              <p className={styles.emptyTitle}>没有匹配「{query.trim()}」的模特</p>
              <Button size="small" onClick={() => setQuery("")}>清除筛选</Button>
            </div>
          ) : (
            <ul className={styles.modelList} aria-label="模特列表">
              {filteredModels.map((model) => {
                const active = model.id === selected?.id;
                return (
                  <li key={model.id}>
                    <button
                      type="button"
                      className={active ? styles.modelItemActive : styles.modelItem}
                      aria-current={active ? "true" : undefined}
                      onClick={() => setSelectedId(model.id)}
                    >
                      <span className={styles.modelThumb}>
                        {model.selectedPortrait?.url
                          ? <img src={model.selectedPortrait.url} alt="" loading="lazy" decoding="async" />
                          : <UserRound size={20} strokeWidth={1.5} />}
                        {model.hasReferenceFace ? (
                          <>
                            <span className={styles.faceLockDot} aria-hidden />
                            <span className="sr-only">已锁定参考脸</span>
                          </>
                        ) : null}
                      </span>
                      <span className={styles.modelMeta}>
                        <span className={styles.modelName}>{model.name}</span>
                        <span className={styles.modelSummary}>{modelSpecSummary(model.spec)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {selected ? (
          <section className={styles.detailPane} aria-label={`模特 ${selected.name}`}>
            <header className={styles.detailHeader}>
              <div className={styles.detailIdent}>
                <h2 className={styles.detailTitle}>{selected.name}</h2>
                <p className={styles.detailMeta}>
                  {modelSpecSummary(selected.spec)} · {selected.portraitCount} 张定妆照 · 更新于 {formatShortDate(selected.updatedAt)}
                </p>
              </div>
              <div className={styles.detailActions}>
                <Button danger icon={<Trash2 size={14} strokeWidth={1.75} />} onClick={() => handleDeleteModel(selected)}>
                  删除
                </Button>
              </div>
            </header>

            {/* 控制条与身份基准固定成一条信息带：生成操作与基准状态常驻，下方两栏各自滚动。 */}
            <div className={styles.detailBand}>
              <div className={styles.composer}>
                <div className={styles.castBar}>
                  <div className={`${styles.castField} ${styles.castFieldModel}`}>
                    <span className={styles.castLabel}>生图模型</span>
                    <Select
                      style={{ width: "100%" }}
                      placeholder="选择生图模型"
                      value={imageOptions.some((option) => option.value === modelPair) ? modelPair : undefined}
                      onChange={setModelPair}
                      options={imageOptions.map((option) => ({ value: option.value, label: option.label }))}
                    />
                  </div>
                  <div className={`${styles.castField} ${styles.castFieldRatio}`}>
                    <span className={styles.castLabel}>画幅</span>
                    <Select
                      style={{ width: "100%" }}
                      value={aspectRatio}
                      onChange={setAspectRatio}
                      options={MODEL_ASPECT_RATIOS.map((value) => ({ value, label: value }))}
                    />
                  </div>
                  <div className={`${styles.castField} ${styles.castFieldCount}`}>
                    <span className={styles.castLabel}>候选</span>
                    <Select
                      style={{ width: "100%" }}
                      value={candidateCount}
                      onChange={setCandidateCount}
                      options={Array.from({ length: MODEL_CAST_CANDIDATES_MAX }, (_, index) => index + 1).map((count) => ({
                        value: count,
                        label: `${count} 张`,
                      }))}
                    />
                  </div>
                  <Button
                    className={styles.castSubmit}
                    type="primary"
                    icon={<Dices size={14} strokeWidth={1.75} />}
                    loading={cast.isPending || Boolean(castJobId)}
                    disabled={castRunning}
                    onClick={() => void handleCast()}
                  >
                    生成定妆照
                  </Button>
                </div>
                <p className={styles.castHint}>
                  提示词由当前规格确定性编译。新候选追加到下方定妆照，不会覆盖已选定的那张；参数完全相同时会复用上一次的结果。
                </p>
                {castRunning ? (
                  <div className={styles.castProgress} role="status">
                    <Progress percent={castJob.data?.progress ?? 0} size="small" showInfo={false} />
                    <span className="tnum">正在生成 {castJob.data?.progress ?? 0}%</span>
                  </div>
                ) : null}
              </div>

              <aside className={styles.anchorCard} aria-label="身份基准">
                <div className={styles.identityBlock}>
                  <p className={styles.eyebrow}>ANCHOR · 身份基准</p>
                  <div className={styles.faceRow}>
                    {/* 圆圈本身就是上传入口：单独一行按钮既占高，又把「上传」和「这张脸」拆成两件事。 */}
                    <div className={styles.facePick}>
                      <button
                        type="button"
                        className={styles.faceAvatar}
                        data-locked={selected.hasReferenceFace ? "true" : undefined}
                        aria-label={selected.hasReferenceFace ? "更换参考脸" : "上传参考脸"}
                        onClick={() => faceInput.current?.click()}
                      >
                        {selected.referenceFaceUrl
                          ? <img src={selected.referenceFaceUrl} alt="" loading="lazy" decoding="async" />
                          : <ScanFace size={20} strokeWidth={1.5} />}
                        <span className={styles.facePickHint}>{selected.hasReferenceFace ? "更换" : "上传"}</span>
                      </button>
                      <input
                        ref={faceInput}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) void handleFaceUpload(selected, file);
                        }}
                      />
                      {selected.hasReferenceFace ? (
                        <button type="button" className={styles.faceClear} aria-label="清除参考脸" title="清除参考脸" onClick={() => handleFaceClear(selected)}>
                          <X size={11} strokeWidth={2.4} />
                        </button>
                      ) : null}
                    </div>
                    <div className={styles.faceMeta}>
                      <strong>{selected.hasReferenceFace ? "参考脸已锁定" : "参考脸未设置"}</strong>
                      <span>
                        {selected.hasReferenceFace
                          ? "后续所有生成以这张脸为唯一身份基准。"
                          : "点左侧圆圈上传一张人脸照片，生成以它为锚点。"}
                      </span>
                    </div>
                  </div>
                </div>
              </aside>
            </div>

            <div className={styles.stage}>

              <section className={styles.portraits}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionHeadMain}>
                    <p className={styles.eyebrow}>CAST · 定妆照</p>
                    <h3 className={styles.sectionTitle}>身份锚点</h3>
                  </div>
                  {portraits.length > 0 ? (
                    <span className={styles.sectionCount}><Images size={13} strokeWidth={1.75} />{portraits.length} 张候选</span>
                  ) : null}
                </div>

                {portraits.length === 0 ? (
                  <div className={styles.portraitEmpty}>
                    <Camera size={22} strokeWidth={1.5} />
                    <p className={styles.emptyTitle}>还没有定妆照</p>
                    <p className={styles.emptyHint}>
                      选好生图模型后点「生成定妆照」。规格在创建时就已定稿，建议先确认五官无误，再一次性多出几张候选挑脸。
                    </p>
                  </div>
                ) : (
                  <div className={styles.portraitGrid}>
                    {/* antd Image + PreviewGroup：点击看大图、多张间左右翻页，复用工作台审核区的同一模式。 */}
                    <Image.PreviewGroup>
                      {portraits.map((portrait) => (
                        <PortraitTile
                          key={portrait.id}
                          portrait={portrait}
                          busy={selectPortrait.isPending || deletePortrait.isPending}
                          onSelect={() => {
                            void selectPortrait.mutateAsync(portrait.id).catch((error) => message.error(errorText(error)));
                          }}
                          onDelete={() => {
                            modal.confirm({
                              title: "删除这张定妆照？",
                              content: "删除后不可恢复。",
                              okButtonProps: { danger: true },
                              okText: "删除",
                              onOk: async () => {
                                try {
                                  await deletePortrait.mutateAsync(portrait.id);
                                  message.success("已删除");
                                } catch (error) {
                                  message.error(errorText(error));
                                }
                              },
                            });
                          }}
                        />
                      ))}
                    </Image.PreviewGroup>
                  </div>
                )}
              </section>

            <aside className={styles.identity} aria-label="身份规格">
                <div className={styles.identityBlock}>
                  <p className={styles.eyebrow}>IDENTITY · 身份内核</p>
                  <SpecRows spec={selected.spec} entries={IDENTITY_ENTRIES} />
                </div>

                <div className={styles.identityBlock}>
                  <p className={styles.eyebrow}>FEATURES · 容貌细节</p>
                  <SpecRows spec={selected.spec} entries={FEATURE_ENTRIES} />
                </div>

                {selected.notes ? (
                  <div className={styles.identityBlock}>
                    <p className={styles.eyebrow}>NOTES · 补充要求</p>
                    <p className={styles.notesText}>{selected.notes}</p>
                  </div>
                ) : null}

                <details className={styles.specMore}>
                  <summary>
                    <ChevronDown size={14} strokeWidth={1.75} className={styles.chevron} />
                    定妆呈现 · {PRESENTATION_ENTRIES.length} 项
                  </summary>
                  <div className={styles.specMoreBody}>
                    <SpecRows spec={selected.spec} entries={PRESENTATION_ENTRIES} />
                  </div>
                </details>

                <details className={styles.specMore}>
                  <summary>
                    <ChevronDown size={14} strokeWidth={1.75} className={styles.chevron} />
                    定妆提示词
                  </summary>
                  <p className={styles.promptBlock}>{compileModelCastPrompt(selected.spec, selected.notes, selected.hasReferenceFace)}</p>
                </details>
              </aside>
            </div>
          </section>
        ) : (
          <section className={styles.detailPlaceholder}>
            <span className={styles.emptyGlyph}><UserRound size={26} strokeWidth={1.25} /></span>
            <p className={styles.emptyTitle}>从左侧选择一位模特</p>
            <p className={styles.emptyHint}>右侧会显示身份规格、参考脸与全部定妆照候选。</p>
          </section>
        )}
      </div>

      {creating ? <ModelDesigner open onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

interface SpecRowsProps {
  spec: ModelSpec;
  entries: ReadonlyArray<FieldEntry>;
}

/** 规格明细：左侧字段名、右侧中文取值；留空维度显式标注「未指定」而不是隐藏。 */
function SpecRows({ spec, entries }: SpecRowsProps) {
  return (
    <dl className={styles.specList}>
      {entries.map((entry) => {
        const labels = specValueLabels(spec, entry);
        return (
          <div key={entry.key} className={styles.specRow}>
            <dt>{entry.label}</dt>
            <dd className={labels.length === 0 ? styles.specUnset : undefined}>
              {labels.length === 0 ? "未指定" : labels.join(" · ")}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

interface PortraitTileProps {
  portrait: ModelPortrait;
  busy: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function PortraitTile({ portrait, busy, onSelect, onDelete }: PortraitTileProps) {
  return (
    <figure className={portrait.selected ? styles.portraitSelected : styles.portrait}>
      {/* wrapperStyle 撑满网格列；cover:false 关掉悬浮遮罩，避免盖住底部操作条。 */}
      <Image
        src={portrait.url}
        alt=""
        loading="lazy"
        decoding="async"
        preview={{ cover: false }}
        wrapperStyle={{ width: "100%" }}
      />
      <figcaption className={styles.portraitActions}>
        {portrait.selected ? (
          <span className={styles.selectedBadge}>当前选定</span>
        ) : (
          <Button size="small" disabled={busy} onClick={onSelect}>设为选定</Button>
        )}
        <Button size="small" type="text" danger disabled={busy} icon={<Trash2 size={13} strokeWidth={1.75} />} onClick={onDelete} />
      </figcaption>
    </figure>
  );
}
