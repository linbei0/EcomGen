import { App, Button, Input, Progress, Switch } from "antd";
import { ListTree, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { Job, ProjectDetail } from "../../api/adapters/projectDetail";
import { useCreatePlanningJob } from "../../api/hooks/usePlanning";
import { useJob, useRetryJob } from "../../api/hooks/useJobs";
import { useTemplates } from "../../api/hooks/useTemplates";
import { errorText } from "../../lib/errorText";
import { loadImageTypes, saveImageTypes } from "../../lib/imageTypes";
import { jobErrorText } from "../../lib/jobError";
import { canResubmitPlan, isActiveJob, latestPlanJob } from "../../lib/planJob";
import styles from "./workbench.module.css";

const INSTRUCTION_MAX = 4000;

const JOB_STATUS_LABEL = {
  QUEUED: "排队中",
  RUNNING: "规划中",
  SUCCEEDED: "规划完成",
  FAILED: "规划失败",
  CANCELLED: "已取消",
} as const;

export function PlanStage({ detail }: { detail: ProjectDetail }) {
  const { notification } = App.useApp();
  const templates = useTemplates();
  const createPlan = useCreatePlanningJob(detail.id);
  const retryJob = useRetryJob(detail.id);
  const stored = useMemo(() => loadImageTypes(detail.id), [detail.id]);
  const catalog = templates.data ?? [];
  const [selected, setSelected] = useState<string[]>(stored);
  const [instruction, setInstruction] = useState("");
  const [allowAgent, setAllowAgent] = useState(true);
  const [activeJobId, setActiveJobId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (selected.length > 0 || catalog.length === 0 || stored.length > 0) return;
    setSelected([catalog[0]!.id]);
  }, [catalog, selected.length, stored.length]);

  const seedJob = latestPlanJob(detail.jobs);
  const trackedId = activeJobId ?? seedJob?.id;
  const liveJob = useJob(trackedId);
  const job = liveJob.data ?? seedJob;
  const locked = Boolean(job) && !canResubmitPlan(job);
  const noAssets = detail.assets.length === 0;
  const names = new Map(catalog.map((item) => [item.id, item.name]));

  const toggle = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) {
        return current.length === 1 ? current : current.filter((item) => item !== id);
      }
      return [...current, id];
    });
  };

  const submit = async () => {
    if (selected.length === 0) {
      notification.error({ title: "至少选择一种图片类型" });
      return;
    }
    try {
      const created = await createPlan.mutateAsync({
        imageTypes: selected,
        allowAgentRecommendations: allowAgent,
        userInstruction: instruction.trim() || undefined,
      });
      saveImageTypes(detail.id, selected);
      setActiveJobId(created.id);
    } catch (error) {
      notification.error({ title: "规划提交失败", description: errorText(error) });
    }
  };

  const retry = async () => {
    if (!job) return;
    try {
      const next = await retryJob.mutateAsync(job.id);
      setActiveJobId(next.id);
    } catch (error) {
      notification.error({ title: "重试失败", description: errorText(error) });
    }
  };

  return (
    <div className={styles.planLayout}>
      {noAssets ? (
        <p className={styles.banner}>
          未上传素材也可以规划，但像素保护分镜需要 PRODUCT_TRUTH 素材才能生成。
        </p>
      ) : null}

      <div className={styles.planSplit}>
        <section className={styles.intent} aria-label="规划意图">
          <p className={styles.sectionTitle}>规划意图</p>
          {locked ? (
            <PlanSummary
              selected={selected}
              names={names}
              instruction={instruction}
              allowAgent={allowAgent}
            />
          ) : (
            <>
              <p className={styles.fieldLabel}>图片类型</p>
              <div className={styles.chipRow}>
                {catalog.map((item) => {
                  const on = selected.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={styles.chip}
                      data-on={on}
                      aria-pressed={on}
                      onClick={() => toggle(item.id)}
                    >
                      {item.name}
                    </button>
                  );
                })}
              </div>
              {selected.length === 0 ? <p className={styles.hint}>至少选择一种图片类型。</p> : null}

              <label className={styles.fieldLabel} htmlFor="plan-instruction">
                补充说明
              </label>
              <Input.TextArea
                id="plan-instruction"
                value={instruction}
                maxLength={INSTRUCTION_MAX}
                rows={6}
                placeholder="风格、卖点或不要出现的内容"
                onChange={(event) => setInstruction(event.target.value)}
              />
              <p className={styles.counter}>
                {instruction.length} / {INSTRUCTION_MAX}
              </p>

              <label className={styles.switchRow}>
                <Switch checked={allowAgent} onChange={setAllowAgent} />
                允许 Pi 补充推荐分镜
              </label>

              <Button
                type="primary"
                loading={createPlan.isPending}
                disabled={selected.length === 0}
                onClick={() => void submit()}
              >
                开始规划
              </Button>
            </>
          )}
        </section>

        <PlanJobCard job={job} onRetry={() => void retry()} retrying={retryJob.isPending} />
      </div>
    </div>
  );
}

function PlanSummary({
  selected,
  names,
  instruction,
  allowAgent,
}: {
  selected: string[];
  names: Map<string, string>;
  instruction: string;
  allowAgent: boolean;
}) {
  return (
    <div className={styles.summary}>
      <p className={styles.summaryLine}>
        {selected.map((id) => names.get(id) ?? id).join(" · ") || "未选择类型"}
      </p>
      <p className={styles.summaryLine}>{instruction.trim() || "无补充说明"}</p>
      <p className={styles.summaryLine}>{allowAgent ? "允许 Pi 补充推荐分镜" : "仅按所选类型规划"}</p>
    </div>
  );
}

function PlanJobCard({
  job,
  onRetry,
  retrying,
}: {
  job: Job | undefined;
  onRetry: () => void;
  retrying: boolean;
}) {
  if (!job) {
    return (
      <aside className={styles.jobCard} aria-label="规划进度">
        <ListTree size={18} strokeWidth={1.75} aria-hidden />
        <h2>等待提交</h2>
        <p>确认图片类型后开始规划。Agent 只产出分镜计划，不会自动生图。</p>
      </aside>
    );
  }

  const active = isActiveJob(job);
  const failed = job.status === "FAILED";
  const error = jobErrorText(job);

  return (
    <aside className={styles.jobCard} data-status={job.status} aria-label="规划进度">
      <p className={styles.jobStatus}>{JOB_STATUS_LABEL[job.status]}</p>
      <h2>{active ? "Pi 正在规划分镜" : JOB_STATUS_LABEL[job.status]}</h2>
      {active ? <Progress percent={job.progress} showInfo /> : null}
      {failed && error ? <p className={styles.jobError}>{error}</p> : null}
      {job.status === "SUCCEEDED" ? <p>分镜已写入项目，可到分镜阶段核对后再确认。</p> : null}
      {failed && job.retryable ? (
        <Button icon={<RotateCcw size={14} strokeWidth={1.75} />} loading={retrying} onClick={onRetry}>
          重试规划
        </Button>
      ) : null}
    </aside>
  );
}
