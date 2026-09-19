import { App, Button, Empty, Input, Progress, Select, Tag, Tooltip } from "antd";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ImagePlus,
  Images,
  Info,
  Layers,
  LibraryBig,
  Loader2,
  Palette,
  RefreshCw,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

// 文件体积与数量上限与后端 multipart 限制同源，避免前端放行一个必然被拒的文件。
import { MAX_SUITE_FORGE_SOURCES, MAX_UPLOAD_FILE_BYTES } from "@ecomgen/contracts";

import { useProviders } from "../../api/hooks/useProviders";
import {
  useCancelSuiteForgeJob,
  useCommitSuiteForge,
  useCreateSuiteForge,
  useSuiteForgeJob,
  useSuiteForgeJobList,
  useSuiteForgeResult,
  type CommitSuiteBody,
  type SuiteForgeJob,
  type SuiteForgeJobSummary,
  type SuiteForgeResult,
} from "../../api/hooks/useSuiteForge";
import { useSuiteCategories } from "../../api/hooks/useSuites";
import { AppTopbar } from "../../components/AppTopbar";
import { fadeUp, staggerContainer } from "../../design/motion";
import { errorText } from "../../lib/errorText";
import { formatShortDate } from "../../lib/format";
import { clearForgeJobId, loadForgeJobId, saveForgeJobId } from "../../lib/forgeJobState";
import { modelOptions } from "../../lib/modelOptions";
import { SHOT_ROLE_LABEL, SHOT_ROLE_ORDER } from "../../lib/roles";
import styles from "./SuiteForgePage.module.css";

const MAX_MB = Math.round(MAX_UPLOAD_FILE_BYTES / (1024 * 1024));

/**
 * 阶段阈值与 worker 实际上报点对齐（20% 压缩视觉输入、40% 送入模型、85% 契约校验）。
 * 旧实现的 45/65 两档在后端永远命中不了，导致耗时最长的模型推理期（40→85）
 * 进度条冻结且阶段文案停在上一档。
 */
const FORGE_STAGES = [
  { from: 0, label: "读取源图" },
  { from: 20, label: "压缩并准备视觉输入" },
  { from: 40, label: "模型反推中" },
  { from: 85, label: "契约校验与归一化" },
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

interface ForgeFailure {
  title: string;
  hint: string;
}

/**
 * 把 worker 抛出的内部措辞翻译成用户能采取的动作。
 * 键串取自 apps/worker/src/worker.ts 的实际抛错文案，改文案时需同步这里。
 */
function describeForgeFailure(message: string | null): ForgeFailure {
  if (!message) {
    return { title: "反推失败", hint: "可以直接重试；若反复失败，请检查设置里的 Provider 配置。" };
  }
  if (message.includes("支持视觉")) {
    return { title: "所选模型不支持视觉", hint: "套图反推需要能直接读取源图的推理模型，请在设置里换成声明了视觉能力的模型。" };
  }
  if (message.includes("缺少源图")) {
    return { title: "缺少源图", hint: "源图可能没有上传成功，重新选择图片后再试一次。" };
  }
  if (message.includes("契约校验")) {
    return { title: "反推结果未通过套图契约校验", hint: "通常是模型产出不稳定，换用能力更强的推理模型，或把目标分镜数调低一些。" };
  }
  if (message.includes("Provider")) {
    return { title: "Provider 不可用", hint: "所选模型可能已被删除或改名，请在设置里确认 Provider 与模型仍然有效。" };
  }
  return { title: "反推失败", hint: "可以直接重试；若反复失败，请展开技术详情后检查 Provider 配置。" };
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} 分钟` : `${minutes} 分 ${rest} 秒`;
}

interface RejectedFile {
  name: string;
  reason: string;
}

/**
 * 把一次拖入/粘贴的文件分成可用与不可用两组。
 *
 * 旧实现遇到超量直接 break、遇到重名直接 continue，用户看到的是「选了 13 张只进去 12 张」
 * 却不知道哪张被丢。这里返回明细，由调用方一次性说明。
 */
function collectAccepted(incoming: FileList | File[], existing: File[]): { accepted: File[]; rejected: RejectedFile[] } {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];
  for (const file of Array.from(incoming)) {
    if (!file.type.startsWith("image/")) {
      rejected.push({ name: file.name, reason: "不是图片" });
      continue;
    }
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      rejected.push({ name: file.name, reason: `超过 ${MAX_MB} MB` });
      continue;
    }
    if ([...existing, ...accepted].some((item) => item.name === file.name && item.size === file.size)) {
      rejected.push({ name: file.name, reason: "已在列表中" });
      continue;
    }
    if (existing.length + accepted.length >= MAX_SUITE_FORGE_SOURCES) {
      rejected.push({ name: file.name, reason: `最多 ${MAX_SUITE_FORGE_SOURCES} 张` });
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejected };
}

interface Preview {
  id: string;
  url: string;
  name: string;
}

/**
 * 步骤标题。解释性文字收进 tooltip 按需展开，不再每块摊开一行说明——
 * 三行说明叠加后会把面板顶出视口，参数全貌反而看不全。
 */
function BlockHead({ index, title, hint }: { index: string; title: string; hint: string }) {
  return (
    <div className={styles.blockHead}>
      <span className={styles.blockIndex}>{index}</span>
      <p className={styles.blockTitle}>
        {title}
        <Tooltip title={hint}>
          <button type="button" className={styles.blockInfo} aria-label={`${title}说明`}>
            <Info size={13} strokeWidth={1.75} aria-hidden />
          </button>
        </Tooltip>
      </p>
    </div>
  );
}

export function SuiteForgePage() {
  const { notification, modal } = App.useApp();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [l1, setL1] = useState<string>();
  const [l2, setL2] = useState<string>();
  const [leaf, setLeaf] = useState("");
  const [targetShotCount, setTargetShotCount] = useState<number>();
  const [modelKey, setModelKey] = useState<string>();
  const [instruction, setInstruction] = useState("");
  const [jobId, setJobId] = useState<string | undefined>(loadForgeJobId);
  const [justCommittedId, setJustCommittedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<File[]>([]);

  const providers = useProviders();
  const categories = useSuiteCategories();
  const create = useCreateSuiteForge();
  const commit = useCommitSuiteForge();
  const cancelRun = useCancelSuiteForgeJob();
  const recentQuery = useSuiteForgeJobList();

  const jobQuery = useSuiteForgeJob(jobId);
  const job = jobQuery.data;
  const jobStatus = job?.status;
  const resultQuery = useSuiteForgeResult(jobId, jobStatus === "SUCCEEDED");
  const result = resultQuery.data;

  // 本地记住刚入库的 ID，避免 commit 后结果查询还没回源就掉回 review 阶段。
  const committedSuiteId = justCommittedId ?? (result?.status === "COMMITTED" ? result.suiteId ?? null : null);

  const phase: "compose" | "running" | "failed" | "review" | "done" = committedSuiteId
    ? "done"
    : create.isPending || jobStatus === "QUEUED" || jobStatus === "RUNNING"
      ? "running"
      : jobStatus === "FAILED" || jobStatus === "CANCELLED"
        ? "failed"
        : jobStatus === "SUCCEEDED"
          ? "review"
          : "compose";

  // 缩略图 object URL 随文件集合重建，卸载或替换时统一回收，避免内存泄漏。
  const previews = useMemo<Preview[]>(
    () => files.map((file, index) => ({ id: `${file.name}-${file.size}-${index}`, url: URL.createObjectURL(file), name: file.name })),
    [files],
  );
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // 恢复出的 jobId 已被服务端清理时不再反复请求，回到空白反推态。
  useEffect(() => {
    if (!jobQuery.isError || !jobId) return;
    clearForgeJobId();
    setJobId(undefined);
  }, [jobQuery.isError, jobId]);

  const visionModels = useMemo(
    () => modelOptions(providers.data?.items ?? [], "reasoning").filter((option) => option.vision),
    [providers.data],
  );
  const selectedModel = visionModels.find((option) => option.value === modelKey);
  const l1List = categories.data?.l1 ?? [];
  const l2List = useMemo(() => (l1 && categories.data ? categories.data.l2[l1] ?? [] : []), [l1, categories.data]);

  const reportRejected = useCallback(
    (rejected: RejectedFile[]) => {
      const head = rejected.slice(0, 3).map((item) => `${item.name}（${item.reason}）`).join("、");
      const rest = rejected.length > 3 ? `，另有 ${rejected.length - 3} 个` : "";
      notification.warning({ title: `${rejected.length} 个文件未加入`, description: `${head}${rest}。` });
    },
    [notification],
  );

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const { accepted, rejected } = collectAccepted(incoming, filesRef.current);
      if (rejected.length > 0) reportRejected(rejected);
      if (accepted.length === 0) return;
      const next = [...filesRef.current, ...accepted];
      // 同步写 ref，使同一次交互里连续两次 addFiles（例如粘贴后又拖入）都能看到彼此。
      filesRef.current = next;
      setFiles(next);
    },
    [reportRejected],
  );

  const moveFile = useCallback((from: number, to: number) => {
    if (from === to) return;
    setFiles((current) => {
      if (from < 0 || from >= current.length || to < 0 || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (!moved) return current;
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const removeFile = (index: number) => setFiles((current) => current.filter((_, position) => position !== index));

  // 只接管含图片的粘贴；纯文本粘贴不受影响。
  useEffect(() => {
    if (phase !== "compose") return;
    const onPaste = (event: ClipboardEvent) => {
      const pasted = event.clipboardData?.files;
      if (!pasted || pasted.length === 0) return;
      event.preventDefault();
      addFiles(pasted);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [phase, addFiles]);

  const reset = () => {
    setFiles([]);
    filesRef.current = [];
    setJobId(undefined);
    clearForgeJobId();
    setJustCommittedId(null);
    // 保留 modelKey：模型是操作者偏好而非本次产品的属性，重开一套时不必重选。
    setName("");
    setLeaf("");
    setInstruction("");
    setTargetShotCount(undefined);
    setL1(undefined);
    setL2(undefined);
  };

  const run = async () => {
    if (files.length === 0) {
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
      saveForgeJobId(created.id);
    } catch (error: unknown) {
      notification.error({ title: "任务创建失败", description: errorText(error) });
    }
  };

  const commitSuite = async (suite: CommitSuiteBody) => {
    if (!jobId) return;
    try {
      const committed = await commit.mutateAsync({ jobId, suite });
      setJustCommittedId(committed.suiteId ?? null);
      notification.success({ title: "套图已入库", description: "现在可以在工作台的套图模式里选用了。" });
    } catch (error: unknown) {
      notification.error({ title: "入库失败", description: errorText(error) });
    }
  };

  const requestCancel = () => {
    if (!jobId) return;
    modal.confirm({
      title: "取消这次反推？",
      content: "取消后本次结果不会入库。已经发出的模型请求不会被中止，已经产生的调用开销也不会退回。",
      okText: "取消反推",
      okButtonProps: { danger: true },
      cancelText: "继续等待",
      onOk: async () => {
        try {
          await cancelRun.mutateAsync(jobId);
        } catch (error: unknown) {
          notification.error({ title: "取消失败", description: errorText(error) });
        }
      },
    });
  };

  // 已用时按任务创建时间计算，刷新后仍是同一次反推的真实耗时。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);
  const createdAt = job?.createdAt ? Date.parse(job.createdAt) : undefined;
  const elapsed = createdAt !== undefined && Number.isFinite(createdAt) ? Math.max(0, Math.round((now - createdAt) / 1000)) : null;

  const progress = job?.progress ?? (create.isPending ? 5 : 0);
  const stageIndex = FORGE_STAGES.reduce((acc, stage, index) => (progress >= stage.from ? index : acc), 0);
  const cancelRequested = job?.cancelRequested ?? false;
  // 分镜数是模型返回前唯一真实推进的观察值：进度条停在 40% 时，它就是"还在动"的证据。
  const shotsGenerated = job?.progressDetail?.shotsGenerated ?? 0;
  const shotsTarget = job?.progressDetail?.shotsTarget ?? null;
  const rawFailure = jobErrorMessage(job) ?? (create.error ? errorText(create.error) : null);
  const failure = describeForgeFailure(rawFailure);

  const liveMessage =
    phase === "running"
      ? cancelRequested
        ? "已请求取消反推，等待当前阶段结束"
        : shotsGenerated > 0
          ? `反推进行中，已生成 ${shotsGenerated} 张分镜`
          : `反推进行中，已完成 ${Math.round(progress)}%`
      : phase === "failed"
        ? `反推失败：${failure.title}`
        : phase === "review"
          ? "反推完成，请确认后入库"
          : phase === "done"
            ? "套图已入库"
            : "";

  const recentItems = recentQuery.data?.items ?? [];

  return (
    <div className={styles.page}>
      <AppTopbar current="forge" settingsOpen={settingsOpen} onSettingsOpenChange={setSettingsOpen} />

      <motion.main className={styles.main} variants={staggerContainer} initial="hidden" animate="visible">
        <motion.section className={styles.hero} variants={fadeUp}>
          <p className={styles.eyebrow}>SUITE FORGE · 套图工坊</p>
          <h1 className={styles.headline}>把爆款套图，变成可复用模板</h1>
        </motion.section>

        <div className={styles.workspace}>
          <motion.section className={styles.composer} variants={fadeUp} aria-label="反推参数">
            <div className={styles.block}>
              <BlockHead
                index="01"
                title="上传爆款套图"
                hint={`建议 5–12 张，覆盖主图、场景、细节与卖点页。缩略图顺序即分镜参考顺序，第一张作为首图。最多 ${MAX_SUITE_FORGE_SOURCES} 张，单张不超过 ${MAX_MB} MB。`}
              />

              <div
                className={styles.dropzone}
                data-dragging={dragging}
                role="button"
                tabIndex={0}
                aria-label={`选择源图，最多 ${MAX_SUITE_FORGE_SOURCES} 张，也可以直接粘贴图片`}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    inputRef.current?.click();
                  }
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
                <ImagePlus size={22} strokeWidth={1.5} aria-hidden className={styles.dropIcon} />
                <p className={styles.dropTitle}>拖入、粘贴或点击选择图片</p>
                <p className={styles.dropHint}>{files.length} / {MAX_SUITE_FORGE_SOURCES} 张 · 单张 ≤ {MAX_MB} MB</p>
              </div>

              {previews.length > 0 ? (
                <div className={styles.thumbs} role="list" aria-label="已选源图，按下方按钮调整顺序">
                  {previews.map((preview, index) => (
                    <figure
                      key={preview.id}
                      role="listitem"
                      className={styles.thumb}
                      data-dragging={dragIndex === index}
                      data-over={dragOverIndex === index}
                      draggable
                      onDragStart={(event) => {
                        setDragIndex(index);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(event) => {
                        if (dragIndex === null) return;
                        event.preventDefault();
                        setDragOverIndex(index);
                      }}
                      onDragLeave={() => setDragOverIndex((current) => (current === index ? null : current))}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragOverIndex(null);
                        if (dragIndex !== null) moveFile(dragIndex, index);
                        setDragIndex(null);
                      }}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setDragOverIndex(null);
                      }}
                    >
                      <img src={preview.url} alt={preview.name} draggable={false} />
                      <span className={styles.thumbIndex} data-first={index === 0}>{index === 0 ? "首图" : index + 1}</span>
                      <button
                        type="button"
                        className={styles.thumbRemove}
                        draggable={false}
                        onClick={() => removeFile(index)}
                        aria-label={`移除 ${preview.name}`}
                      >
                        <X size={13} strokeWidth={2.5} />
                      </button>
                      {previews.length > 1 ? (
                        <div className={styles.thumbOrder}>
                          <button
                            type="button"
                            draggable={false}
                            disabled={index === 0}
                            onClick={() => moveFile(index, index - 1)}
                            aria-label={`将 ${preview.name} 前移`}
                          >
                            <ArrowLeft size={12} strokeWidth={2.5} />
                          </button>
                          <button
                            type="button"
                            draggable={false}
                            disabled={index === previews.length - 1}
                            onClick={() => moveFile(index, index + 1)}
                            aria-label={`将 ${preview.name} 后移`}
                          >
                            <ArrowRight size={12} strokeWidth={2.5} />
                          </button>
                        </div>
                      ) : null}
                    </figure>
                  ))}
                </div>
              ) : null}
            </div>

            <div className={styles.block}>
              <BlockHead
                index="02"
                title="分类与命名"
                hint="品类与名称用于让 Agent 收敛语境；留空则由模型按源图自动判断。"
              />
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
              <BlockHead index="03" title="反推模型" hint="只列出声明了视觉能力的推理模型——反推需要模型直接读取源图。" />
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

            <div className={styles.runSummary}>
              <span><Images size={13} strokeWidth={1.75} aria-hidden /> 源图 {files.length} 张</span>
              <span><Sparkles size={13} strokeWidth={1.75} aria-hidden /> {selectedModel?.label ?? "未选模型"}</span>
              <span><Layers size={13} strokeWidth={1.75} aria-hidden /> {targetShotCount ? `目标 ${targetShotCount} 张` : "目标分镜自动"}</span>
            </div>

            <div className={styles.runRow}>
              <Tooltip
                title={`${files.length > 0 ? `这 ${files.length} 张源图` : "源图"}会全部作为视觉输入发送给所选模型，耗时取决于数量与模型。`}
              >
                <Button
                  type="primary"
                  size="large"
                  icon={<Wand2 size={16} strokeWidth={1.75} />}
                  loading={phase === "running"}
                  onClick={() => void run()}
                >
                  {phase === "compose" ? "开始反推" : "重新反推"}
                </Button>
              </Tooltip>
              {files.length > 0 || jobId ? (
                <Button type="text" icon={<RefreshCw size={15} strokeWidth={1.75} />} onClick={reset} disabled={phase === "running"}>
                  清空
                </Button>
              ) : null}
            </div>
          </motion.section>

          <motion.section className={styles.stage} variants={fadeUp} aria-label="反推结果">
            <p className="sr-only" aria-live="polite">{liveMessage}</p>
            {phase === "compose" ? (
              <>
                <div className={styles.stageIntro}>
                  <Sparkles size={26} strokeWidth={1.25} aria-hidden className={styles.stageEmptyIcon} />
                  <p className={styles.stageEmptyTitle}>等待反推</p>
                  <p className={styles.stageEmptyHint}>分镜与 Prompt 模板会出现在这里。</p>
                  <div className={styles.skeletonRow} aria-hidden>
                    {[0, 1, 2].map((index) => (
                      <div key={index} className={styles.skeletonCard}>
                        <span className={styles.skeletonChip} />
                        <span className={styles.skeletonLine} />
                        <span className={styles.skeletonLine} data-short="true" />
                        <span className={styles.skeletonBlock} />
                      </div>
                    ))}
                  </div>
                </div>
                {recentItems.length > 0 ? (
                  <RecentForgeList
                    items={recentItems}
                    activeJobId={jobId}
                    onOpen={(id) => {
                      setJustCommittedId(null);
                      setJobId(id);
                      saveForgeJobId(id);
                    }}
                  />
                ) : null}
              </>
            ) : phase === "running" ? (
              <div className={styles.running}>
                <div className={styles.runningHead}>
                  <Loader2 size={18} strokeWidth={1.75} className={styles.spin} aria-hidden />
                  <span>{cancelRequested ? "正在取消…" : "正在拆解爆款套图…"}</span>
                  <em>{Math.round(progress)}%</em>
                </div>
                <Progress percent={Math.round(progress)} showInfo={false} strokeColor="var(--accent)" trailColor="var(--bg-3)" />
                <p className={styles.runningMeta}>
                  {elapsed !== null ? `已用时 ${formatElapsed(elapsed)}` : "刚刚开始"}
                  {cancelRequested ? " · 取消请求已发出，等待当前阶段结束" : ""}
                  {shotsGenerated > 0 ? ` · 已生成 ${shotsTarget ? `${shotsGenerated} / ${shotsTarget}` : shotsGenerated} 张分镜` : ""}
                  {!cancelRequested && shotsGenerated === 0 && progress >= 40 ? " · 模型返回前进度停在 40%" : ""}
                </p>
                <ul className={styles.stepList}>
                  {FORGE_STAGES.map((stage, index) => (
                    <li key={stage.label} data-state={index < stageIndex ? "done" : index === stageIndex ? "active" : "todo"}>
                      <span className={styles.stepDot} aria-hidden />
                      {stage.label}
                    </li>
                  ))}
                </ul>
                {!cancelRequested ? (
                  <Button danger icon={<X size={15} strokeWidth={2} />} loading={cancelRun.isPending} onClick={requestCancel}>
                    取消反推
                  </Button>
                ) : null}
              </div>
            ) : phase === "failed" ? (
              <div className={styles.stageEmpty} data-tone="error">
                <AlertTriangle size={28} strokeWidth={1.5} aria-hidden className={styles.failureIcon} />
                <p className={styles.stageEmptyTitle}>{failure.title}</p>
                <p className={styles.stageEmptyHint}>{failure.hint}</p>
                {rawFailure ? (
                  <details className={styles.failureDetail}>
                    <summary>技术详情</summary>
                    <pre>{rawFailure}</pre>
                  </details>
                ) : null}
                {files.length > 0 ? (
                  <Button icon={<RefreshCw size={15} strokeWidth={1.75} />} onClick={() => void run()}>重试</Button>
                ) : (
                  <Button icon={<ImagePlus size={15} strokeWidth={1.75} />} onClick={() => inputRef.current?.click()}>
                    重新选择源图
                  </Button>
                )}
              </div>
            ) : phase === "done" ? (
              <div className={styles.done}>
                <div className={styles.doneMark}><Check size={22} strokeWidth={2.5} aria-hidden /></div>
                <p className={styles.doneTitle}>套图已入库</p>
                <p className={styles.doneHint}>「{result?.suite.name ?? name ?? "新套图"}」</p>
                <div className={styles.doneActions}>
                  <Tooltip title="入库的套图可在项目工作台的套图模式里按分镜选用">
                    <Button type="primary" icon={<LibraryBig size={15} strokeWidth={1.75} />} onClick={() => void navigate("/library")}>
                      去资产库
                    </Button>
                  </Tooltip>
                  <Button icon={<Images size={15} strokeWidth={1.75} />} onClick={reset}>再反推一套</Button>
                </div>
              </div>
            ) : (
              <ReviewPanel
                result={result}
                loading={resultQuery.isPending}
                error={resultQuery.isError ? errorText(resultQuery.error) : null}
                committing={commit.isPending}
                onCommit={(suite) => void commitSuite(suite)}
              />
            )}
          </motion.section>
        </div>
      </motion.main>
    </div>
  );
}

interface RecentForgeListProps {
  items: SuiteForgeJobSummary[];
  activeJobId: string | undefined;
  onOpen: (jobId: string) => void;
}

/** 「最近反推」：反推是全局任务且没有独立页面，这里是刷新或跳转后唯一的回程入口。 */
function RecentForgeList({ items, activeJobId, onOpen }: RecentForgeListProps) {
  return (
    <div className={styles.recent}>
      <div className={styles.recentHead}>
        <span>最近反推</span>
        <span className={styles.recentCount}>{items.length} 条</span>
      </div>
      <ul className={styles.recentList}>
        {items.map((item) => {
          const status = recentStatus(item);
          const title = item.draft?.name?.trim() || "未命名反推";
          const category = item.draft ? `${item.draft.l1} / ${item.draft.l2} · ${item.draft.leaf}` : "尚无草稿";
          return (
            <li key={item.jobId}>
              <button
                type="button"
                className={styles.recentRow}
                data-active={item.jobId === activeJobId}
                aria-current={item.jobId === activeJobId}
                onClick={() => onOpen(item.jobId)}
              >
                <span className={styles.recentMain}>
                  <span className={styles.recentName}>{title}</span>
                  <span className={styles.recentMeta}>
                    {category}
                    {item.draft ? ` · ${item.draft.shotCount} 张` : ""} · {formatShortDate(item.updatedAt)}
                  </span>
                </span>
                <span className={styles.recentStatus} data-tone={status.tone}>{status.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function recentStatus(item: SuiteForgeJobSummary): { label: string; tone: string } {
  if (item.status === "SUCCEEDED") {
    return item.draft?.suiteId ? { label: "已入库", tone: "ok" } : { label: "待入库", tone: "warn" };
  }
  if (item.status === "FAILED") return { label: "失败", tone: "bad" };
  if (item.status === "CANCELLED") return { label: "已取消", tone: "muted" };
  return { label: `${item.status === "QUEUED" ? "排队中" : "进行中"} ${item.progress}%`, tone: "run" };
}

interface ReviewPanelProps {
  result: SuiteForgeResult | undefined;
  loading: boolean;
  error: string | null;
  committing: boolean;
  onCommit: (suite: CommitSuiteBody) => void;
}

/** 草稿预览：先让人读懂并修正反推结果，再决定是否入库，避免直接写入套图库。 */
function ReviewPanel({ result, loading, error, committing, onCommit }: ReviewPanelProps) {
  const categories = useSuiteCategories();
  const [draft, setDraft] = useState<CommitSuiteBody | null>(result?.suite ?? null);
  const [baseline, setBaseline] = useState(() => (result ? JSON.stringify(result.suite) : ""));
  const appliedKeyRef = useRef<string | null>(null);

  // 结果查询 staleTime 为 0，切回页面会重新取回同一个对象的新引用。只在内容标识真的变化时
  // 覆盖草稿，否则一次后台重取就会把用户正在编辑的分镜清掉。
  useEffect(() => {
    if (!result) return;
    const key = `${result.jobId}:${result.status}:${result.updatedAt ?? ""}`;
    if (appliedKeyRef.current === key) return;
    appliedKeyRef.current = key;
    setDraft(result.suite);
    setBaseline(JSON.stringify(result.suite));
  }, [result]);

  const patch = useCallback((updater: (next: CommitSuiteBody) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      updater(next);
      return next;
    });
  }, []);

  const moveShot = useCallback(
    (index: number, delta: number) =>
      patch((next) => {
        const target = index + delta;
        if (target < 0 || target >= next.shots.length) return;
        const [moved] = next.shots.splice(index, 1);
        if (!moved) return;
        next.shots.splice(target, 0, moved);
        next.shots.forEach((shot, position) => {
          shot.order = position + 1;
        });
      }),
    [patch],
  );

  const removeShot = useCallback(
    (index: number) =>
      patch((next) => {
        // 契约要求至少一张分镜，删除最后一张会让文档无法通过校验。
        if (next.shots.length <= 1) return;
        next.shots.splice(index, 1);
        next.shots.forEach((shot, position) => {
          shot.order = position + 1;
        });
      }),
    [patch],
  );

  if (loading && !draft) {
    return <div className={styles.inlineState}><Loader2 size={16} strokeWidth={1.75} className={styles.spin} aria-hidden /> 正在读取反推结果…</div>;
  }
  if (error && !draft) {
    return <div className={styles.stageEmpty} data-tone="error"><Empty description={error} /></div>;
  }
  if (!draft) {
    return <div className={styles.stageEmpty}><Empty description="暂无反推结果" /></div>;
  }

  const dirty = JSON.stringify(draft) !== baseline;
  const l1List = categories.data?.l1 ?? [];
  const l2List = categories.data?.l2[draft.category.l1] ?? [];
  const palette = draft.styleLock.palette ?? [];

  const problems: string[] = [];
  if (!draft.name.trim()) problems.push("套图名称不能为空");
  if (!draft.category.l1.trim() || !draft.category.l2.trim() || !draft.category.leaf.trim()) {
    problems.push("一级、二级与叶子类目都不能为空");
  }
  if (draft.shots.length === 0) problems.push("至少保留一张分镜");
  else if (draft.shots.some((shot) => !shot.promptTemplate.trim())) problems.push("每张分镜的 Prompt 模板都不能为空");

  return (
    <div className={styles.review}>
      <header className={styles.reviewHead}>
        <div className={styles.reviewHeadMain}>
          <div className={styles.reviewTags}>
            <Tooltip title="编辑会覆盖服务端草稿，入库时以当前内容为准">
              <Tag color="purple">草稿</Tag>
            </Tooltip>
            {dirty ? <Tag color="gold">已修改</Tag> : null}
          </div>
          <Input
            className={styles.reviewNameInput}
            value={draft.name}
            maxLength={60}
            aria-label="套图名称"
            onChange={(event) => patch((next) => { next.name = event.target.value; })}
          />
        </div>
        <span className={styles.reviewCount}><Layers size={14} strokeWidth={1.75} aria-hidden /> {draft.shots.length} 张成套</span>
      </header>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>套图描述</span>
        <Input.TextArea
          value={draft.description ?? ""}
          autoSize={{ minRows: 2, maxRows: 4 }}
          placeholder="这套图的整体叙事与适用场景"
          onChange={(event) => patch((next) => { next.description = event.target.value; })}
        />
      </label>

      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>一级品类</span>
          <Select
            showSearch
            value={draft.category.l1}
            options={l1List.map((item) => ({ label: item, value: item }))}
            onChange={(value) => patch((next) => { next.category.l1 = value; })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>二级品类</span>
          <Select
            showSearch
            value={draft.category.l2}
            options={l2List.map((item) => ({ label: item, value: item }))}
            onChange={(value) => patch((next) => { next.category.l2 = value; })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>叶子类目</span>
          <Input
            value={draft.category.leaf}
            maxLength={40}
            onChange={(event) => patch((next) => { next.category.leaf = event.target.value; })}
          />
        </label>
      </div>

      {/* 风格锁定文本同时出现在每条 Prompt 模板块里，这里折叠成一行标题：
          常显会占掉半屏并把它下面的分镜列表挤出视野。 */}
      <div className={styles.reviewLock}>
        <details className={styles.reviewLockDetails}>
          <summary>
            <Palette size={15} strokeWidth={1.75} aria-hidden />
            <span>Campaign Style Lock</span>
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden className={styles.reviewLockChevron} />
          </summary>
          <p className={styles.reviewLockText}>{draft.styleLock.lockText}</p>
        </details>
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
        {draft.shots.map((shot, index) => (
          <article key={shot.shotId} className={styles.shot}>
            <div className={styles.shotHead}>
              <span className={styles.shotRole} data-role={roleTone(shot.shotRole)}>{roleLabel(shot.shotRole)}</span>
              <Input
                className={styles.shotNameInput}
                value={shot.displayName}
                maxLength={80}
                aria-label={`第 ${index + 1} 张分镜名称`}
                onChange={(event) => patch((next) => { const target = next.shots[index]; if (target) target.displayName = event.target.value; })}
              />
              {shot.aspectRatio ? <Tag bordered={false}>{shot.aspectRatio}</Tag> : null}
              <div className={styles.shotActions}>
                <Tooltip title="上移">
                  <Button
                    size="small"
                    type="text"
                    disabled={index === 0}
                    icon={<ArrowUp size={14} strokeWidth={1.75} />}
                    aria-label={`将「${shot.displayName}」上移`}
                    onClick={() => moveShot(index, -1)}
                  />
                </Tooltip>
                <Tooltip title="下移">
                  <Button
                    size="small"
                    type="text"
                    disabled={index === draft.shots.length - 1}
                    icon={<ArrowDown size={14} strokeWidth={1.75} />}
                    aria-label={`将「${shot.displayName}」下移`}
                    onClick={() => moveShot(index, 1)}
                  />
                </Tooltip>
                <Tooltip title={draft.shots.length <= 1 ? "至少保留一张分镜" : "删除这张分镜"}>
                  <Button
                    size="small"
                    type="text"
                    danger
                    disabled={draft.shots.length <= 1}
                    icon={<Trash2 size={14} strokeWidth={1.75} />}
                    aria-label={`删除「${shot.displayName}」`}
                    onClick={() => removeShot(index)}
                  />
                </Tooltip>
              </div>
            </div>
            <div className={styles.intentField}>
              <Input.TextArea
                value={shot.intent ?? ""}
                autoSize={{ minRows: 1, maxRows: 3 }}
                placeholder="这张分镜要解决的问题"
                aria-label={`第 ${index + 1} 张分镜意图`}
                onChange={(event) => patch((next) => { const target = next.shots[index]; if (target) target.intent = event.target.value; })}
              />
            </div>
            {/* 包一层容器而不是给 TextArea 挂 className：等宽字体要落到内部 <textarea> 上，
                不依赖 antd 把 className 放在元素本身还是包裹层。 */}
            <div className={styles.promptField}>
              <Input.TextArea
                value={shot.promptTemplate}
                autoSize={{ minRows: 4, maxRows: 12 }}
                aria-label={`第 ${index + 1} 张分镜 Prompt 模板`}
                onChange={(event) => patch((next) => { const target = next.shots[index]; if (target) target.promptTemplate = event.target.value; })}
              />
            </div>
          </article>
        ))}
      </div>

      <footer className={styles.reviewFoot}>
        <div className={styles.reviewFootMain}>
          {problems.length > 0 ? (
            <ul className={styles.problemList}>
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          ) : null}
        </div>
        <div className={styles.reviewFootActions}>
          {dirty ? (
            <Button
              icon={<Undo2 size={15} strokeWidth={1.75} />}
              disabled={committing}
              onClick={() => setDraft(structuredClone(result?.suite ?? draft))}
            >
              撤销修改
            </Button>
          ) : null}
          <Button
            type="primary"
            loading={committing}
            disabled={problems.length > 0}
            icon={<Check size={15} strokeWidth={2} />}
            onClick={() => onCommit(draft)}
          >
            确认入库
          </Button>
        </div>
      </footer>
    </div>
  );
}
