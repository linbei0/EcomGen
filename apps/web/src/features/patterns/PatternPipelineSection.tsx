import { useMemo, useState } from "react";
import { App, Button, Progress, Select } from "antd";
import { Download, RotateCcw } from "lucide-react";
import { PATTERN_PIPELINE_STEP_LABELS } from "@ecomgen/contracts";

import { useJobStatus } from "../../api/hooks/useJobs";
import {
  useCancelPatternPipeline,
  useContinuePatternPipeline,
  useCreatePatternPipeline,
  usePatternListingResult,
  usePatternPipelines,
  usePatternPrintPacks,
  useRetryPatternPipelineStep,
  type ListingPlatform,
  type Pattern,
  type PatternPipeline,
  type PatternPipelineResolution,
  type PatternPipelineStep,
  type PatternPipelineStepName,
  type PodPrintLayout,
  type PodPrintSpec,
  type PodRepeatLayout,
} from "../../api/hooks/usePatterns";
import { errorText } from "../../lib/errorText";
import { jobErrorText } from "../../lib/jobError";
import { formatDateTime, formatShortDate } from "../../lib/format";
import { parseModelKey } from "../../lib/modelOptions";
import { CopyRow, LayoutChipRow, LISTING_PLATFORM_OPTIONS, ListingModelSelect, podSpecOptionLabel, RepeatLayoutChipRow, SectionHead, StatusPill, statusLabel, statusTone } from "./shared";
import styles from "./PatternWorkspacePage.module.css";

/** 步骤阶段文案：进度不确定时用阶段标签表达，与花型墙的 stageText 同一纪律（不编造匀速进度）。 */
function stepStageText(step: PatternPipelineStepName, progress: number): string {
  if (step === "SOURCE") return progress < 50 ? "生成图案中…" : "写入花型库…";
  if (step === "TILE_CHECK") return progress < 50 ? "比对四边像素…" : "写入判定…";
  if (step === "PRINT_PACK") {
    if (progress < 45) return "按规格排版中…";
    if (progress < 85) return "渲染品类示意图…";
    return "写入规格包…";
  }
  if (progress < 45) return "看图写文案…";
  if (progress < 85) return "校验平台字数…";
  return "写入结果…";
}

/**
 * 当前推进到哪一步：在途的那一步，否则最后落定的一步（AWAITING_INPUT 时就落在等待裁决的验缝步）。
 * 以步骤名为身份而不是行 id：步骤在 API 上本来就按名寻址（同一个流水线内步骤名唯一），
 * 行 id 是持久化细节，不该泄漏到契约里。
 */
function currentStepName(steps: PatternPipelineStep[]): PatternPipelineStepName | null {
  const ordered = [...steps].sort((left, right) => left.position - right.position);
  const inFlight = ordered.find((step) => step.status === "QUEUED" || step.status === "RUNNING");
  if (inFlight) return inFlight.step;
  const lastSettled = [...ordered].reverse().find((step) => step.status !== "PENDING");
  return lastSettled?.step ?? ordered[0]?.step ?? null;
}

/**
 * 成包流水线（三问一跑）：把「验缝 → 规格包 → 文案」串成一次执行。
 *
 * 编排本身不是用户要学的东西——顺序内建在服务端，这里只让用户回答三个问题，然后把每一步的
 * 状态、产物与失败原文摊开。刻意不做弹窗向导：收据要和入口待在同一节里，用户改完答案能立刻
 * 看到上一次跑到了哪一步。
 */
export function PatternPipelineSection({ pattern, specs }: { pattern: Pattern; specs: PodPrintSpec[] }) {
  const { message } = App.useApp();
  const pipelinesQuery = usePatternPipelines(pattern.id);
  const createPipeline = useCreatePatternPipeline(pattern.id);
  const pipelines = useMemo(() => pipelinesQuery.data?.items ?? [], [pipelinesQuery.data]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [specId, setSpecId] = useState<string | null>(null);
  const [layout, setLayout] = useState<PodPrintLayout>("CENTERED");
  const [repeatLayout, setRepeatLayout] = useState<PodRepeatLayout>("STRAIGHT");
  const [platform, setPlatform] = useState<ListingPlatform>("ETSY");
  const [listingModelKey, setListingModelKey] = useState<string | null>(null);

  // 默认看最新一条（服务端已按创建时间倒序）；显式选过历史记录则保持选中，不因轮询重取而跳回。
  const active = pipelines.find((entry) => entry.id === activeId) ?? pipelines[0] ?? null;

  const submit = () => {
    if (!specId) {
      message.warning("请选择品类规格");
      return;
    }
    if (!listingModelKey) {
      message.warning("请选择文案模型（需支持视觉）");
      return;
    }
    const { providerId, modelId } = parseModelKey(listingModelKey);
    createPipeline.mutate(
      { specId, layout, ...(layout === "TILE" ? { repeatLayout } : {}), listingPlatform: platform, listingProviderId: providerId, listingModelId: modelId },
      {
        onSuccess: ({ pipeline, reused }) => {
          if (reused) message.info("相同答案的流水线正在进行中，已为你复用");
          setActiveId(pipeline.id);
        },
        onError: (error) => message.error(errorText(error)),
      },
    );
  };

  return (
    <section className={styles.wsSection} data-section="pipeline">
      <SectionHead
        title="成包流水线"
        sticky
        status={active ? <StatusPill tone={statusTone(active.status)}>{statusLabel(active.status)}</StatusPill> : null}
      />
      <p className={styles.wsHint}>验缝 → 规格包 → Listing 文案，一次跑完；每步留下收据，失败的那一步可单独重跑。</p>

      <div className={styles.formCol}>
        <Select
          size="small"
          style={{ width: "100%" }}
          placeholder="品类规格"
          aria-label="流水线品类规格"
          value={specId}
          onChange={setSpecId}
          options={specs.map((spec) => ({ value: spec.id, label: podSpecOptionLabel(spec) }))}
        />
        <LayoutChipRow value={layout} onChange={setLayout} variant="rail" ariaLabel="流水线版式" />
        {/* 满印的风险提示与规格包节同源：验缝给过判定才算数，所以这里也说清判定状态。 */}
        {layout === "TILE" ? (
          <>
            <RepeatLayoutChipRow value={repeatLayout} onChange={setRepeatLayout} variant="rail" ariaLabel="流水线平铺排列" />
            <p className={styles.wsHint}>
              {repeatLayout === "MIRROR"
                ? "镜像排列按构造无缝，无需验缝通过；图案会上下左右翻转对称，含文字或明显朝向的花型慎用。"
                : "满印要求四边能对上；验缝未通过时流水线会停下来等你决定（改居中 / 换镜像 / 仍出满印），不会静默降级。"}
            </p>
          </>
        ) : null}
        <Select size="small" style={{ width: "100%" }} aria-label="流水线目标平台" value={platform} onChange={setPlatform} options={LISTING_PLATFORM_OPTIONS} />
        <ListingModelSelect size="small" value={listingModelKey} onChange={setListingModelKey} />
        <Button type="primary" block loading={createPipeline.isPending} onClick={submit}>
          开始成包
        </Button>
      </div>

      {pipelines.length === 0 ? null : (
        <>
          {pipelines.length > 1 ? (
            <div className={styles.wsChipRow} role="group" aria-label="历史流水线">
              {pipelines.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={entry.id === active?.id ? `${styles.wsChip} ${styles.wsChipActive}` : styles.wsChip}
                  onClick={() => setActiveId(entry.id)}
                  title={formatDateTime(entry.createdAt)}
                >
                  {formatShortDate(entry.createdAt)} · {statusLabel(entry.status)}
                </button>
              ))}
            </div>
          ) : null}
          {active ? <PipelineReceipt pipeline={active} pattern={pattern} /> : null}
        </>
      )}
    </section>
  );
}

/**
 * 流水线收据：按 position 顺序的步骤卡 + 整体状态与取消入口。
 *
 * 只有一条流水线可能在途（worker 串行推进），所以进度只轮询当前那一步的任务；其余步骤的状态
 * 由流水线自身的 1.5s 轮询带回来。
 */
function PipelineReceipt({ pipeline, pattern }: { pipeline: PatternPipeline; pattern: Pattern }) {
  const { message } = App.useApp();
  const retryStep = useRetryPatternPipelineStep(pattern.id);
  const continuePipeline = useContinuePatternPipeline(pattern.id);
  const cancelPipeline = useCancelPatternPipeline(pattern.id);
  const ordered = useMemo(() => [...pipeline.steps].sort((left, right) => left.position - right.position), [pipeline.steps]);
  const currentName = currentStepName(ordered);
  const activeStep = ordered.find((step) => step.status === "QUEUED" || step.status === "RUNNING") ?? null;
  const activeJob = useJobStatus(activeStep?.jobId ?? undefined);
  const terminal = pipeline.status === "SUCCEEDED" || pipeline.status === "FAILED" || pipeline.status === "CANCELLED";
  const busy = retryStep.isPending || continuePipeline.isPending || cancelPipeline.isPending;

  // AWAITING_INPUT 已由收据卡内的两个出口按钮承担；这里只负责把重跑失败如实说出来。
  const onRetry = (step: PatternPipelineStepName) => {
    retryStep.mutate(
      { pipelineId: pipeline.id, step },
      { onError: (error) => message.error(errorText(error)) },
    );
  };
  const onResolve = (resolution: PatternPipelineResolution) => {
    continuePipeline.mutate(
      { pipelineId: pipeline.id, resolution },
      { onError: (error) => message.error(errorText(error)) },
    );
  };

  return (
    <div className={styles.pipelineBlock}>
      {/* 整体状态已经在节标题的徽标上；收据头只留时间与取消入口，不重复一遍同样的徽标。 */}
      <div className={styles.pipelineHead}>
        <span className={styles.wsHint}>开始于 {formatDateTime(pipeline.createdAt)}</span>
        {!terminal ? (
          <Button
            size="small"
            type="text"
            className={styles.pipelineCancel}
            disabled={busy}
            onClick={() =>
              cancelPipeline.mutate(pipeline.id, {
                onSuccess: () => message.success("流水线已取消"),
                onError: (error) => message.error(errorText(error)),
              })
            }
          >
            取消
          </Button>
        ) : null}
      </div>

      {ordered.map((step) => (
        <PipelineStepCard
          key={step.step}
          step={step}
          pattern={pattern}
          pipeline={pipeline}
          current={step.step === currentName}
          running={step.step === activeStep?.step}
          jobProgress={activeJob.data?.progress ?? 0}
          jobStatus={activeStep?.step === step.step ? activeJob.data?.status ?? null : null}
          busy={busy}
          onRetry={() => onRetry(step.step)}
          onResolve={onResolve}
        />
      ))}
    </div>
  );
}

/**
 * 单步卡：步骤名 + 状态 + 进度/错误原文 + 该步产物 + 重跑按钮。
 *
 * 三种情况刻意不给出重跑入口：
 * - SOURCE：它的任务由来源入口创建，重跑要走那条路；
 * - 尚未跑过的步骤（PENDING）：没有东西可"重"跑，而给出这个入口就等于在 AWAITING_INPUT 时
 *   绕过裁决直接出满印——唯一的放行方式是那三颗明确的出口按钮；
 * - 在途步骤与已取消的流水线：前者会与正在执行的 worker 争抢同一份领域记录，后者是终态。
 * 服务端同样拒绝这些情况，这里只是不给出注定失败的入口。
 */
function PipelineStepCard({
  step,
  pattern,
  pipeline,
  current,
  running,
  jobProgress,
  jobStatus,
  busy,
  onRetry,
  onResolve,
}: {
  step: PatternPipelineStep;
  pattern: Pattern;
  pipeline: PatternPipeline;
  current: boolean;
  running: boolean;
  jobProgress: number;
  jobStatus: string | null;
  busy: boolean;
  onRetry: () => void;
  onResolve: (resolution: PatternPipelineResolution) => void;
}) {
  const settled = step.status === "SUCCEEDED" || step.status === "FAILED" || step.status === "CANCELLED";
  const retryable = settled && step.step !== "SOURCE" && pipeline.status !== "AWAITING_INPUT" && pipeline.status !== "CANCELLED";
  const percent = running ? jobProgress : step.status === "SUCCEEDED" ? 100 : 0;
  const errorDetail = step.error ? String(step.error.message ?? JSON.stringify(step.error)) : null;
  // 验缝步骤的接缝风险写在 detail.warning：它没有让步骤失败，但会拦住整条流水线。
  const warning = typeof step.detail?.warning === "string" ? step.detail.warning : null;
  const tileableScore = typeof step.detail?.tileableScore === "number" ? step.detail.tileableScore : null;

  return (
    <div className={current ? `${styles.pipelineStep} ${styles.pipelineStepCurrent}` : styles.pipelineStep}>
      <div className={styles.pipelineStepHead}>
        <span className={styles.pipelineStepName}>{PATTERN_PIPELINE_STEP_LABELS[step.step]}</span>
        <StatusPill tone={statusTone(step.status)}>{statusLabel(step.status)}</StatusPill>
        {retryable ? (
          <Button size="small" type="text" className={styles.pipelineCancel} icon={<RotateCcw size={12} strokeWidth={2} />} disabled={busy} onClick={onRetry}>
            重跑
          </Button>
        ) : null}
      </div>

      {running ? (
        <div className={styles.pipelineStepBody}>
          <Progress size="small" percent={percent} status="active" showInfo={false} />
          <span className={styles.wsHint}>{stepStageText(step.step, percent)}</span>
        </div>
      ) : null}
      {!running && step.status === "SUCCEEDED" ? <Progress size="small" percent={percent} showInfo={false} /> : null}

      {errorDetail ? <p className={styles.pipelineError}>{errorDetail}</p> : null}
      {warning ? <p className={styles.pipelineWarning}>{warning}</p> : null}
      {step.step === "TILE_CHECK" && tileableScore !== null ? (
        <span className={styles.wsHint}>中缝相似度 {Math.round(tileableScore * 100)}%</span>
      ) : null}

      {/* AWAITING_INPUT 的三个出口就地给出：用户的裁决只对这一条流水线有意义，跳去别处做决定只会丢失上下文。 */}
      {pipeline.status === "AWAITING_INPUT" && pipeline.blockReason === "SEAM_RISK" && step.step === "TILE_CHECK" ? (
        <div className={styles.pipelineExits}>
          <Button size="small" type="primary" disabled={busy} onClick={() => onResolve("USE_CENTERED")}>
            改为居中继续
          </Button>
          <Button size="small" disabled={busy} onClick={() => onResolve("USE_MIRROR")}>
            换镜像出满印
          </Button>
          <Button size="small" disabled={busy} onClick={() => onResolve("ALLOW_SEAM")}>
            仍出满印
          </Button>
        </div>
      ) : null}

      {step.step === "PRINT_PACK" && step.jobId ? <PackArtifacts patternId={pattern.id} jobId={step.jobId} /> : null}
      {step.jobId ? <JobErrorText jobId={step.jobId} enabled={step.status !== "SUCCEEDED" && jobStatus === null} /> : null}
      {step.step === "LISTING" && step.status === "SUCCEEDED" && step.jobId ? <ListingArtifacts patternId={pattern.id} jobId={step.jobId} /> : null}
    </div>
  );
}

/** 规格包步骤的产物：三件套下载，与规格包舞台同一份数据（共享 query key）。 */
function PackArtifacts({ patternId, jobId }: { patternId: string; jobId: string }) {
  const packsQuery = usePatternPrintPacks(patternId);
  const pack = (packsQuery.data?.items ?? []).find((entry) => entry.jobId === jobId);
  if (!pack) return null;
  if (pack.status === "FAILED") return <p className={styles.pipelineError}>{typeof pack.error?.message === "string" ? pack.error.message : "规格包生成失败"}</p>;
  if (pack.status !== "SUCCEEDED") return null;
  return (
    <div className={styles.pipelineArtifacts}>
      {pack.files.map((file) => (
        <Button key={file.name} size="small" type="link" title={file.name} icon={<Download size={12} strokeWidth={2} />} href={file.url} target="_blank">
          <span className={styles.artifactName}>{file.name}</span>
        </Button>
      ))}
    </div>
  );
}

/**
 * 步骤任务的错误原文：任务可能早于本页渲染就已失败，此时步骤卡上没有 error 字段的详情，
 * 直接读任务拿真实报错，而不是只显示"失败"两个字。
 */
function JobErrorText({ jobId, enabled }: { jobId: string; enabled: boolean }) {
  const job = useJobStatus(enabled ? jobId : undefined);
  if (!enabled || !job.data || (job.data.status !== "FAILED" && job.data.status !== "CANCELLED")) return null;
  return <p className={styles.pipelineError}>{jobErrorText(job.data) ?? "任务未成功完成"}</p>;
}

/** Listing 步骤的产物：复用交付节的复制行，标题/tags/要点/描述逐行可复制。 */
function ListingArtifacts({ patternId, jobId }: { patternId: string; jobId: string }) {
  const result = usePatternListingResult(patternId, jobId, true);
  if (!result.data) return null;
  const { copy } = result.data;
  return (
    <div className={styles.copyBlock}>
      <CopyRow label="标题" value={copy.title} />
      {copy.tags.length > 0 ? <CopyRow label="Tags" value={copy.tags.join(", ")} /> : null}
      {copy.bullets.length > 0 ? <CopyRow label="要点" value={copy.bullets.map((bullet, index) => `${index + 1}. ${bullet}`).join("\n")} /> : null}
      <CopyRow label="描述" value={copy.description} />
    </div>
  );
}
