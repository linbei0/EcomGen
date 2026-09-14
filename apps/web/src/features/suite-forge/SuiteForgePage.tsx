import { App, Button, Empty, Input, Progress, Select, Tag, Tooltip } from "antd";
import {
  Aperture,
  ArrowLeft,
  Check,
  ImagePlus,
  Images,
  Layers,
  LibraryBig,
  Loader2,
  Palette,
  RefreshCw,
  Settings2,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { useProviders } from "../../api/hooks/useProviders";
import {
  useCommitSuiteForge,
  useCreateSuiteForge,
  useSuiteForgeJob,
  useSuiteForgeResult,
  type SuiteForgeJob,
} from "../../api/hooks/useSuiteForge";
import { useSuiteCategories } from "../../api/hooks/useSuites";
import { HealthBadge } from "../../components/HealthBadge";
import { fadeUp, staggerContainer } from "../../design/motion";
import { errorText } from "../../lib/errorText";
import { modelOptions } from "../../lib/modelOptions";
import { SHOT_ROLE_LABEL, SHOT_ROLE_ORDER } from "../../lib/roles";
import { SettingsDrawer } from "../providers/SettingsDrawer";
import styles from "./SuiteForgePage.module.css";

const MAX_SOURCES = 12;
const MIN_SOURCES = 1;

const RUN_STEPS = [
  { at: 0, label: "读取源图" },
  { at: 20, label: "逐张拆解构图与光影" },
  { at: 45, label: "提炼 Campaign Style Lock" },
  { at: 65, label: "撰写分镜与 Prompt 模板" },
  { at: 85, label: "校验并归一化套图" },
] as const;

function roleLabel(role: string | null | undefined): string {
  if (!role) return "分镜";
  return SHOT_ROLE_LABEL[role as (typeof SHOT_ROLE_ORDER)[number]] ?? role;
}

function roleTone(role: string | null | undefined): string {
  const index = SHOT_ROLE_ORDER.indexOf(role as (typeof SHOT_ROLE_ORDER)[number]);
  return String(Math.max(0, index));
}

function jobErrorMessage(job: SuiteForgeJob | undefined): string | null {
  if (!job || !job.error) return null;
  const message = (job.error as { message?: unknown }).message;
  return typeof message === "string" && message.length > 0 ? message : "任务执行失败";
}

interface Preview {
  id: string;
  url: string;
  name: string;
}

export function SuiteForgePage() {
  const { notification } = App.useApp();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [name, setName] = useState("");
  const [l1, setL1] = useState<string>();
  const [l2, setL2] = useState<string>();
  const [leaf, setLeaf] = useState("");
  const [targetShotCount, setTargetShotCount] = useState<number>();
  const [modelKey, setModelKey] = useState<string>();
  const [instruction, setInstruction] = useState("");
  const [jobId, setJobId] = useState<string>();
  const [committedSuiteId, setCommittedSuiteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const providers = useProviders();
  const categories = useSuiteCategories();
  const create = useCreateSuiteForge();
  const commit = useCommitSuiteForge();

  const jobQuery = useSuiteForgeJob(jobId);
  const job = jobQuery.data;
  const jobStatus = job?.status;
  const resultQuery = useSuiteForgeResult(jobId, jobStatus === "SUCCEEDED");
  const result = resultQuery.data;

  // 缩略图 object URL 随文件集合重建，卸载或替换时统一回收，避免内存泄漏。
  const previews = useMemo<Preview[]>(
    () => files.map((file, index) => ({ id: `${file.name}-${file.size}-${index}`, url: URL.createObjectURL(file), name: file.name })),
    [files],
  );
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  const visionModels = useMemo(
    () => modelOptions(providers.data?.items ?? [], "reasoning").filter((option) => option.vision),
    [providers.data],
  );
  const l1List = categories.data?.l1 ?? [];
  const l2List = useMemo(() => (l1 && categories.data ? categories.data.l2[l1] ?? [] : []), [l1, categories.data]);

  const phase: "compose" | "running" | "failed" | "review" | "done" = committedSuiteId
    ? "done"
    : create.isPending || (jobStatus !== undefined && (jobStatus === "QUEUED" || jobStatus === "RUNNING"))
      ? "running"
      : jobStatus === "FAILED" || jobStatus === "CANCELLED"
        ? "failed"
        : jobStatus === "SUCCEEDED"
          ? "review"
          : "compose";

  const addFiles = (incoming: FileList | File[]) => {
    const images = Array.from(incoming).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      notification.warning({ title: "只支持图片文件", description: "请上传 JPG、PNG 或 WebP 格式的爆款套图。" });
      return;
    }
    setFiles((current) => {
      const next = [...current];
      for (const file of images) {
        if (next.length >= MAX_SOURCES) break;
        if (next.some((item) => item.name === file.name && item.size === file.size)) continue;
        next.push(file);
      }
      return next;
    });
  };

  const removeFile = (index: number) => setFiles((current) => current.filter((_, i) => i !== index));

  const reset = () => {
    setFiles([]);
    setJobId(undefined);
    setCommittedSuiteId(null);
    setName("");
    setLeaf("");
    setInstruction("");
    setTargetShotCount(undefined);
  };

  const run = async () => {
    if (files.length < MIN_SOURCES) {
      notification.warning({ title: "至少上传一张源图", description: "建议上传一整组 5–12 张爆款套图以获得稳定模板。" });
      return;
    }
    if (!modelKey) {
      notification.warning({ title: "请选择反推模型", description: "需要一个支持视觉的推理模型。" });
      return;
    }
    const [providerId, modelId] = modelKey.split("::");
    if (!providerId || !modelId) return;
    try {
      const created = await create.mutateAsync({
        files,
        providerId,
        modelId,
        name: name.trim() || undefined,
        l1,
        l2,
        leaf: leaf.trim() || undefined,
        targetShotCount,
        userInstruction: instruction.trim() || undefined,
      });
      setJobId(created.id);
    } catch (error: unknown) {
      notification.error({ title: "任务创建失败", description: errorText(error) });
    }
  };

  const commitSuite = async () => {
    if (!jobId) return;
    try {
      const committed = await commit.mutateAsync(jobId);
      setCommittedSuiteId(committed.suiteId ?? null);
      notification.success({ title: "套图已入库", description: "现在可以在工作台的套图模式里选用了。" });
    } catch (error: unknown) {
      notification.error({ title: "入库失败", description: errorText(error) });
    }
  };

  const suite = result?.suite;
  const progress = job?.progress ?? (create.isPending ? 5 : 0);
  const currentStep = RUN_STEPS.filter((step) => progress >= step.at).length - 1;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link to="/" className={styles.brand}>
          <Aperture size={20} strokeWidth={1.75} aria-hidden />
          <span className={styles.brandName}>EcomGen</span>
        </Link>
        <div className={styles.topActions}>
          <Button icon={<LibraryBig size={16} strokeWidth={1.75} />} onClick={() => void navigate("/library")}>
            资产库
          </Button>
          <HealthBadge />
          <Button icon={<Settings2 size={16} strokeWidth={1.75} />} onClick={() => setSettingsOpen(true)}>
            设置
          </Button>
        </div>
      </header>

      <motion.main className={styles.main} variants={staggerContainer} initial="hidden" animate="visible">
        <motion.section className={styles.hero} variants={fadeUp}>
          <p className={styles.eyebrow}>SUITE FORGE · 套图工坊</p>
          <h1 className={styles.headline}>把爆款套图，变成可复用模板</h1>
          <p className={styles.lede}>上传一组详情图，反推为分镜化套图。</p>
        </motion.section>

        <div className={styles.workspace}>
          <motion.section className={styles.composer} variants={fadeUp} aria-label="反推参数">
            <div className={styles.block}>
              <div className={styles.blockHead}>
                <span className={styles.blockIndex}>01</span>
                <div>
                  <p className={styles.blockTitle}>上传爆款套图</p>
                  <p className={styles.blockHint}>建议 5–12 张，覆盖主图、场景、细节与卖点页</p>
                </div>
              </div>

              <div
                className={styles.dropzone}
                data-dragging={dragging}
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  addFiles(event.dataTransfer.files);
                }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(event) => {
                    if (event.target.files) addFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
                <ImagePlus size={26} strokeWidth={1.5} aria-hidden className={styles.dropIcon} />
                <p className={styles.dropTitle}>拖入或点击选择图片</p>
                <p className={styles.dropHint}>已选 {files.length} / {MAX_SOURCES} 张</p>
              </div>

              {previews.length > 0 ? (
                <div className={styles.thumbs}>
                  {previews.map((preview, index) => (
                    <figure key={preview.id} className={styles.thumb}>
                      <img src={preview.url} alt={preview.name} />
                      <button type="button" className={styles.thumbRemove} onClick={() => removeFile(index)} aria-label={`移除 ${preview.name}`}>
                        <X size={12} strokeWidth={2.5} />
                      </button>
                    </figure>
                  ))}
                </div>
              ) : null}
            </div>

            <div className={styles.block}>
              <div className={styles.blockHead}>
                <span className={styles.blockIndex}>02</span>
                <div>
                  <p className={styles.blockTitle}>分类与命名</p>
                  <p className={styles.blockHint}>帮助 Agent 收敛品类语境，留空则自动判断</p>
                </div>
              </div>
              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>套图名称</span>
                  <Input value={name} maxLength={60} placeholder="例：氨基酸洁面泡沫套图" onChange={(event) => setName(event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>一级品类</span>
                  <Select
                    allowClear
                    showSearch
                    value={l1}
                    placeholder="自动判断"
                    options={l1List.map((item) => ({ label: item, value: item }))}
                    onChange={(value) => {
                      setL1(value);
                      setL2(undefined);
                    }}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>二级品类</span>
                  <Select
                    allowClear
                    showSearch
                    value={l2}
                    placeholder={l1 ? "自动判断" : "先选一级品类"}
                    disabled={!l1}
                    options={l2List.map((item) => ({ label: item, value: item }))}
                    onChange={setL2}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>叶子类目</span>
                  <Input value={leaf} maxLength={40} placeholder="例：洁面乳" onChange={(event) => setLeaf(event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>目标分镜数</span>
                  <Select
                    allowClear
                    value={targetShotCount}
                    placeholder="自动（5–12）"
                    options={Array.from({ length: 8 }, (_, index) => index + 5).map((count) => ({ label: `${count} 张`, value: count }))}
                    onChange={setTargetShotCount}
                  />
                </label>
              </div>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>额外要求（可选）</span>
                <Input.TextArea
                  value={instruction}
                  maxLength={4000}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="例：只保留卖点对比结构；背景统一为暖米色。"
                  onChange={(event) => setInstruction(event.target.value)}
                />
              </label>
            </div>

            <div className={styles.block}>
              <div className={styles.blockHead}>
                <span className={styles.blockIndex}>03</span>
                <div>
                  <p className={styles.blockTitle}>反推模型</p>
                  <p className={styles.blockHint}>需要支持视觉的推理模型，可直接读取源图</p>
                </div>
              </div>
              {providers.isPending ? (
                <div className={styles.inlineState}><Loader2 size={16} strokeWidth={1.75} className={styles.spin} aria-hidden /> 正在读取 Provider…</div>
              ) : visionModels.length === 0 ? (
                <div className={styles.inlineState} data-tone="warn">
                  <Sparkles size={16} strokeWidth={1.75} aria-hidden />
                  还没有支持视觉的推理模型，请先在设置里配置。
                  <Button size="small" type="link" onClick={() => setSettingsOpen(true)}>去设置</Button>
                </div>
              ) : (
                <Select
                  className={styles.modelSelect}
                  value={modelKey}
                  placeholder="选择 Provider / 模型"
                  options={visionModels.map((option) => ({ label: option.label, value: option.value }))}
                  onChange={setModelKey}
                />
              )}
            </div>

            <div className={styles.runRow}>
              <Button
                type="primary"
                size="large"
                icon={<Wand2 size={16} strokeWidth={1.75} />}
                loading={phase === "running"}
                onClick={() => void run()}
              >
                {phase === "compose" ? "开始反推" : "重新反推"}
              </Button>
              {files.length > 0 || jobId ? (
                <Button type="text" icon={<RefreshCw size={15} strokeWidth={1.75} />} onClick={reset} disabled={phase === "running"}>
                  清空
                </Button>
              ) : null}
            </div>
          </motion.section>

          <motion.section className={styles.stage} variants={fadeUp} aria-label="反推结果">
            {phase === "compose" ? (
              <div className={styles.stageEmpty}>
                <Sparkles size={30} strokeWidth={1.25} aria-hidden className={styles.stageEmptyIcon} />
                <p className={styles.stageEmptyTitle}>等待反推</p>
                <p className={styles.stageEmptyHint}>上传源图后开始反推，这里会显示分镜与 Prompt 模板。</p>
                <ul className={styles.promiseList}>
                  <li><Layers size={14} strokeWidth={1.75} aria-hidden /> 5–12 张分镜，覆盖漏斗全链路</li>
                  <li><Palette size={14} strokeWidth={1.75} aria-hidden /> 统一的 Campaign Style Lock 与色板</li>
                  <li><Check size={14} strokeWidth={1.75} aria-hidden /> 去标识化 + 质量门槛校验</li>
                </ul>
              </div>
            ) : phase === "running" ? (
              <div className={styles.running}>
                <div className={styles.runningHead}>
                  <Loader2 size={18} strokeWidth={1.75} className={styles.spin} aria-hidden />
                  <span>正在拆解爆款套图…</span>
                  <em>{Math.round(progress)}%</em>
                </div>
                <Progress percent={Math.round(progress)} showInfo={false} strokeColor="var(--accent)" trailColor="var(--bg-3)" />
                <ul className={styles.stepList}>
                  {RUN_STEPS.map((step, index) => (
                    <li key={step.label} data-state={index < currentStep ? "done" : index === currentStep ? "active" : "todo"}>
                      <span className={styles.stepDot} aria-hidden />
                      {step.label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : phase === "failed" ? (
              <div className={styles.stageEmpty} data-tone="error">
                <Empty
                  image={<Sparkles size={30} strokeWidth={1.25} aria-hidden />}
                  description={jobErrorMessage(job) ?? errorText(create.error) ?? "反推失败"}
                />
                <Button icon={<RefreshCw size={15} strokeWidth={1.75} />} onClick={() => void run()}>重试</Button>
              </div>
            ) : phase === "done" ? (
              <div className={styles.done}>
                <div className={styles.doneMark}><Check size={22} strokeWidth={2.5} aria-hidden /></div>
                <p className={styles.doneTitle}>套图已入库</p>
                <p className={styles.doneHint}>「{suite?.name ?? name ?? "新套图"}」已入库，可在工作台套图模式里按分镜选用。</p>
                <div className={styles.doneActions}>
                  <Button type="primary" icon={<ArrowLeft size={15} strokeWidth={1.75} />} onClick={() => void navigate("/")}>
                    返回项目
                  </Button>
                  <Button icon={<Images size={15} strokeWidth={1.75} />} onClick={reset}>再反推一套</Button>
                </div>
              </div>
            ) : (
              <ReviewPanel
                result={result}
                loading={resultQuery.isPending}
                error={resultQuery.isError ? errorText(resultQuery.error) : null}
                committing={commit.isPending}
                onCommit={() => void commitSuite()}
              />
            )}
          </motion.section>
        </div>
      </motion.main>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

interface ReviewPanelProps {
  result: import("../../api/hooks/useSuiteForge").SuiteForgeResult | undefined;
  loading: boolean;
  error: string | null;
  committing: boolean;
  onCommit: () => void;
}

/** 草稿预览：先让人读懂反推结果，再决定是否入库，避免直接写入套图库。 */
function ReviewPanel({ result, loading, error, committing, onCommit }: ReviewPanelProps) {
  if (loading) {
    return <div className={styles.inlineState}><Loader2 size={16} strokeWidth={1.75} className={styles.spin} aria-hidden /> 正在读取反推结果…</div>;
  }
  if (error) {
    return <div className={styles.stageEmpty} data-tone="error"><Empty description={error} /></div>;
  }
  if (!result) {
    return <div className={styles.stageEmpty}><Empty description="暂无反推结果" /></div>;
  }
  const suite = result.suite;
  const palette = suite.styleLock.palette ?? [];
  return (
    <div className={styles.review}>
      <header className={styles.reviewHead}>
        <div>
          <div className={styles.reviewTags}>
            <Tag color="purple">草稿</Tag>
            <span className={styles.reviewCategory}>{suite.category.l1} / {suite.category.l2} · {suite.category.leaf}</span>
          </div>
          <h2 className={styles.reviewName}>{suite.name}</h2>
          {suite.description ? <p className={styles.reviewDesc}>{suite.description}</p> : null}
        </div>
        <span className={styles.reviewCount}><Layers size={14} strokeWidth={1.75} aria-hidden /> {suite.shots.length} 张成套</span>
      </header>

      <div className={styles.reviewLock}>
        <div className={styles.reviewLockHead}>
          <Palette size={15} strokeWidth={1.75} aria-hidden />
          <span>Campaign Style Lock</span>
        </div>
        <p className={styles.reviewLockText}>{suite.styleLock.lockText}</p>
        {palette.length > 0 ? (
          <div className={styles.palette}>
            {palette.map((color, index) => (
              <Tooltip key={`${color.hex}-${index}`} title={`${color.name} · ${color.hex}`}>
                <span className={styles.swatch} style={{ background: color.hex }} aria-label={`${color.name} ${color.hex}`} />
              </Tooltip>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.shots}>
        {suite.shots.map((shot) => (
          <article key={shot.shotId} className={styles.shot}>
            <div className={styles.shotHead}>
              <span className={styles.shotRole} data-role={roleTone(shot.shotRole)}>{roleLabel(shot.shotRole)}</span>
              <span className={styles.shotName}>{shot.displayName}</span>
              {shot.aspectRatio ? <Tag bordered={false}>{shot.aspectRatio}</Tag> : null}
            </div>
            {shot.intent ? <p className={styles.shotIntent}>{shot.intent}</p> : null}
            <pre className={styles.shotPrompt}>{shot.promptTemplate}</pre>
          </article>
        ))}
      </div>

      <footer className={styles.reviewFoot}>
        <span className={styles.reviewFootHint}>确认后写入套图库，可在工作台按分镜选用</span>
        <Button type="primary" loading={committing} icon={<Check size={15} strokeWidth={2} />} onClick={onCommit}>
          确认入库
        </Button>
      </footer>
    </div>
  );
}
