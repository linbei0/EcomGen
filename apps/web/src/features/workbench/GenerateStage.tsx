import { App, Button, Checkbox, Input, Modal, Progress } from "antd";
import { motion } from "motion/react";
import { RotateCcw, TriangleAlert, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

import type { Job, Output, ProjectDetail, StoryboardItem, Variant } from "../../api/adapters/projectDetail";
import { useCreateGenerationJobs } from "../../api/hooks/useGeneration";
import { useCancelJob, useRetryJob } from "../../api/hooks/useJobs";
import { useProviders } from "../../api/hooks/useProviders";
import { useStoryboard } from "../../api/hooks/useStoryboard";
import { CostHint } from "../../components/CostHint";
import { ModeBadge } from "../../components/ModeBadge";
import { develop } from "../../design/motion";
import { errorText } from "../../lib/errorText";
import { ITEM_STATUS_LABEL, scopeLabel } from "../../lib/factClaims";
import {
  activeGenerateJobs,
  hasGeneratedItem,
  isSelectableItem,
  latestGenerateJobs,
  modeCounts,
  ungeneratedItems,
} from "../../lib/generateSelection";
import { jobErrorText } from "../../lib/jobError";
import styles from "./workbench.module.css";

const JOB_STATUS_LABEL = {
  QUEUED: "排队中",
  RUNNING: "生成中",
  SUCCEEDED: "已完成",
  FAILED: "生成失败",
  CANCELLED: "已取消",
} as const;

export function GenerateStage({
  detail,
  preselectedItemId,
}: {
  detail: ProjectDetail;
  preselectedItemId?: string | null;
}) {
  const { notification } = App.useApp();
  const board = useStoryboard(detail.id);
  const providers = useProviders();
  const createJobs = useCreateGenerationJobs(detail.id);
  const retryJob = useRetryJob(detail.id);
  const cancelJob = useCancelJob(detail.id);
  const items = board.data?.items ?? detail.items;
  const storyboard = board.data?.storyboard ?? detail.storyboard;
  const [picked, setPicked] = useState<string[]>(preselectedItemId ? [preselectedItemId] : []);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [asRevision, setAsRevision] = useState(false);
  const [revision, setRevision] = useState("");

  const selected = useMemo(
    () => items.filter((item) => picked.includes(item.id)),
    [items, picked],
  );
  const counts = modeCounts(selected);
  const generateJobs = latestGenerateJobs(detail.jobs);
  const active = activeGenerateJobs(detail.jobs);
  const failed = generateJobs.filter((job) => job.status === "FAILED");
  const providerName =
    providers.data?.items.find((item) => item.id === detail.imageProviderId)?.name ?? "生图 Provider";
  const modelLabel = `${providerName} / ${detail.imageModelId}`;

  const toggle = (id: string) => {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const selectUngenerated = () => {
    setPicked(ungeneratedItems(items).map((item) => item.id));
  };

  const submit = async () => {
    if (selected.length === 0) return;
    try {
      await createJobs.mutateAsync({
        storyboardItemIds: selected.map((item) => item.id),
        revision: asRevision ? revision : undefined,
      });
      setConfirmOpen(false);
      setAsRevision(false);
      setRevision("");
      setPicked([]);
    } catch (error) {
      notification.error({ title: "生成提交失败", description: errorText(error) });
    }
  };

  if (!storyboard || storyboard.status !== "CONFIRMED") {
    return (
      <div className={styles.placeholder}>
        <h2>先确认分镜</h2>
        <p>Agent 不会自动生图。确认分镜后再显式勾选目标分镜。</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.placeholder}>
        <h2>还没有可生成的分镜</h2>
        <p>回到规划阶段生成分镜计划。</p>
      </div>
    );
  }

  return (
    <div className={styles.generateWrap}>
      {failed.map((job) => (
        <FailedJobCard
          key={job.id}
          job={job}
          retrying={retryJob.isPending}
          onRetry={() => {
            void retryJob.mutateAsync(job.id).catch((error: unknown) => {
              notification.error({ title: "重试失败", description: errorText(error) });
            });
          }}
        />
      ))}

      {active.length > 0 ? (
        <TaskView
          jobs={active}
          items={items}
          outputs={detail.outputs}
          variants={detail.variants}
          modelLabel={modelLabel}
          cancelling={cancelJob.isPending}
          onCancel={(jobId) => {
            void cancelJob.mutateAsync(jobId).catch((error: unknown) => {
              notification.error({ title: "取消失败", description: errorText(error) });
            });
          }}
        />
      ) : (
        <>
          <div className={styles.boardToolbar}>
            <Button onClick={selectUngenerated}>全选未生成</Button>
          </div>
          <div className={styles.board}>
            {items.map((item) => (
              <GenerateCard
                key={item.id}
                item={item}
                variants={detail.variants}
                checked={picked.includes(item.id)}
                disabled={!isSelectableItem(item)}
                onToggle={() => toggle(item.id)}
              />
            ))}
          </div>
        </>
      )}

      {active.length === 0 && selected.length > 0 ? (
        <div className={styles.confirmBar}>
          <p>
            创意 {counts.creative} / 像素保护 {counts.protected}
            {" · "}
            <CostHint />
          </p>
          <Button type="primary" icon={<Wand2 size={14} strokeWidth={1.75} />} onClick={() => setConfirmOpen(true)}>
            生成 {selected.length} 张
          </Button>
        </div>
      ) : null}

      <Modal
        open={confirmOpen}
        title="生成确认"
        onCancel={() => setConfirmOpen(false)}
        footer={
          <Button type="primary" loading={createJobs.isPending} onClick={() => void submit()}>
            确认生成 {selected.length} 张
          </Button>
        }
      >
        <table className={styles.confirmTable}>
          <thead>
            <tr>
              <th>分镜</th>
              <th>模式</th>
              <th>变体范围</th>
            </tr>
          </thead>
          <tbody>
            {selected.map((item) => (
              <tr key={item.id}>
                <td>{item.assetType}</td>
                <td>{item.mode === "PIXEL_PROTECTED" ? "像素保护" : "创意"}</td>
                <td>{scopeLabel(item.variantScope, detail.variants)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.summaryLine}>共 {selected.length} 张 · {modelLabel}</p>
        <p className={styles.summaryLine}>
          <CostHint />
        </p>
        {hasGeneratedItem(selected) ? (
          <label className={styles.switchRow}>
            <Checkbox
              checked={asRevision}
              onChange={(event) => setAsRevision(event.target.checked)}
              aria-label="作为修订重新出图"
            />
            作为修订重新出图
          </label>
        ) : null}
        {asRevision ? (
          <>
            <label className={styles.fieldLabel} htmlFor="revision-note">
              修订说明
            </label>
            <Input.TextArea
              id="revision-note"
              aria-label="修订说明"
              value={revision}
              rows={3}
              onChange={(event) => setRevision(event.target.value)}
            />
          </>
        ) : null}
      </Modal>
    </div>
  );
}

function GenerateCard({
  item,
  variants,
  checked,
  disabled,
  onToggle,
}: {
  item: StoryboardItem;
  variants: Variant[];
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={styles.shotCard} data-selected={checked} data-disabled={disabled}>
      <div className={styles.shotHero} data-mode={item.mode}>
        <span className={styles.shotType}>{item.assetType}</span>
        {item.riskFlags.length > 0 ? (
          <span className={styles.riskMark}>
            <TriangleAlert size={14} strokeWidth={1.75} aria-hidden />
            {item.riskFlags.length}
          </span>
        ) : null}
      </div>
      <div className={styles.shotMeta}>
        <Checkbox
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`选择 ${item.assetType}`}
        />
        <span className={styles.scopeChip}>{scopeLabel(item.variantScope, variants)}</span>
        <ModeBadge mode={item.mode} />
        <span className={styles.statusPill}>{ITEM_STATUS_LABEL[item.status]}</span>
      </div>
    </article>
  );
}

function FailedJobCard({
  job,
  onRetry,
  retrying,
}: {
  job: Job;
  onRetry: () => void;
  retrying: boolean;
}) {
  const error = jobErrorText(job);
  return (
    <aside className={styles.jobCard} data-status="FAILED">
      <p className={styles.jobStatus}>{JOB_STATUS_LABEL.FAILED}</p>
      {error ? <p className={styles.jobError}>{error}</p> : null}
      {job.retryable ? (
        <Button icon={<RotateCcw size={14} strokeWidth={1.75} />} loading={retrying} onClick={onRetry}>
          重试生成
        </Button>
      ) : null}
    </aside>
  );
}

function TaskView({
  jobs,
  items,
  outputs,
  variants,
  modelLabel,
  onCancel,
  cancelling,
}: {
  jobs: Job[];
  items: StoryboardItem[];
  outputs: Output[];
  variants: Variant[];
  modelLabel: string;
  onCancel: (jobId: string) => void;
  cancelling: boolean;
}) {
  const lead = jobs[0];
  if (!lead) return null;
  const progress = Math.round(jobs.reduce((sum, job) => sum + job.progress, 0) / jobs.length);
  return (
    <div>
      <aside className={styles.jobCard} data-status={lead.status}>
        <p className={styles.jobStatus}>{JOB_STATUS_LABEL[lead.status]}</p>
        <h2>{jobs.length} 张生成中</h2>
        <p>{modelLabel}</p>
        <Progress percent={progress} showInfo />
        <Button
          disabled={lead.cancelRequested || cancelling}
          onClick={() => onCancel(lead.id)}
        >
          {lead.cancelRequested ? "取消中" : "取消"}
        </Button>
      </aside>
      <div className={styles.outputGrid}>
        {items.map((item) => {
          const output = outputs.find((entry) => entry.storyboardItemId === item.id);
          return (
            <div key={item.id} className={styles.outputSlot}>
              {output ? (
                <motion.img
                  src={output.url}
                  alt={item.assetType}
                  className={styles.outputImage}
                  variants={develop}
                  initial="hidden"
                  animate="visible"
                />
              ) : (
                <div className={styles.shotHero}>
                  <span className={styles.shotType}>{item.assetType}</span>
                  <span className={styles.scopeChip}>{scopeLabel(item.variantScope, variants)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
