import { App, Button, Tooltip } from "antd";
import { Download, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { exportDownloadUrl, type ProjectDetail } from "../../api/adapters/projectDetail";
import { useCreateExportJob, useExport } from "../../api/hooks/useExport";
import { useCreateGenerationJobs } from "../../api/hooks/useGeneration";
import { useCancelJob, useRetryJob } from "../../api/hooks/useJobs";
import { errorText } from "../../lib/errorText";
import { exportableOutputs } from "../../lib/exportJob";
import { JOB_STATUS_LABEL } from "../../lib/factClaims";
import { activeGenerateJobs } from "../../lib/generateSelection";
import { jobErrorText } from "../../lib/jobError";
import { ReviewStage } from "./ReviewStage";
import styles from "./workbench.module.css";

export function ResultsWorkspace({
  detail,
}: {
  detail: ProjectDetail;
}) {
  const { notification } = App.useApp();
  const generate = useCreateGenerationJobs(detail.id);
  const retryJob = useRetryJob(detail.id);
  const cancelJob = useCancelJob(detail.id);
  const createExport = useCreateExportJob(detail.id);
  const [activeExportId, setActiveExportId] = useState<string | undefined>(undefined);
  const liveExport = useExport(activeExportId);
  const selectedIds = useMemo(() => exportableOutputs(detail.outputs), [detail.outputs]);
  const active = activeGenerateJobs(detail.jobs);
  const failed = detail.jobs.filter((job) => job.type === "GENERATE" && job.status === "FAILED");
  const record = liveExport.data;
  const packing = createExport.isPending || record?.status === "QUEUED" || record?.status === "RUNNING";
  const readyUrl = record?.status === "SUCCEEDED" ? exportDownloadUrl(record) : null;

  useEffect(() => {
    if (record?.status === "FAILED") notification.error({ title: "打包失败，请重新下载" });
  }, [record?.status, notification]);

  const download = async (ids: string[]) => {
    if (ids.length === 0) {
      notification.error({ title: "没有可下载的成图" });
      return;
    }
    try {
      const bundle = await createExport.mutateAsync({
        outputIds: ids,
        platformTargets: detail.platformTargets,
        includeDetailPageSlices: false,
      });
      if (bundle.export) setActiveExportId(bundle.export.id);
    } catch (error) {
      notification.error({ title: "导出失败", description: errorText(error) });
    }
  };

  return (
    <div className={styles.results}>
      {active.length > 0 ? (
        <aside className={styles.jobCard} aria-live="polite">
          <p className={styles.jobStatus}>{JOB_STATUS_LABEL[active[0]!.status]}</p>
          <h2>{active.length} 张正在出图</h2>
          <p>只显示真实状态，不估算百分比。</p>
          <Button
            disabled={active[0]!.cancelRequested || cancelJob.isPending}
            onClick={() => void cancelJob.mutateAsync(active[0]!.id)}
          >
            {active[0]!.cancelRequested ? "取消中" : "取消"}
          </Button>
        </aside>
      ) : null}

      {failed.map((job) => (
        <aside key={job.id} className={styles.jobCard} data-status="FAILED">
          <p className={styles.jobStatus}>{JOB_STATUS_LABEL.FAILED}</p>
          {jobErrorText(job) ? <p className={styles.jobError}>{jobErrorText(job)}</p> : null}
          <div className={styles.jobActions}>
            {job.retryable ? (
              <Button loading={retryJob.isPending} onClick={() => void retryJob.mutateAsync(job.id)}>
                重试生成
              </Button>
            ) : null}
          </div>
          <Tooltip title="关闭失败提示">
            <Button
              className={styles.jobDismiss}
              type="text"
              size="small"
              icon={<X size={16} strokeWidth={1.75} />}
              loading={cancelJob.isPending}
              aria-label="关闭失败提示"
              onClick={() => void cancelJob.mutateAsync(job.id)}
            />
          </Tooltip>
        </aside>
      ))}

      <div className={styles.resultsToolbar}>
        {packing ? <span className={styles.hint}>打包中…</span> : null}
        {readyUrl ? (
          <a className={styles.downloadLink} href={readyUrl}>
            打开 ZIP
          </a>
        ) : null}
        <Button loading={packing} onClick={() => void download(detail.outputs.map((output) => output.id))}>
          全部下载
        </Button>
        <Button
          type="primary"
          icon={<Download size={14} strokeWidth={1.75} />}
          loading={packing}
          disabled={selectedIds.length === 0}
          onClick={() => void download(selectedIds)}
        >
          下载已选入 {selectedIds.length > 0 ? selectedIds.length : ""}
        </Button>
      </div>

      <ReviewStage
        detail={detail}
        onRetryItem={(itemId) => {
          void generate.mutateAsync({ storyboardItemIds: [itemId], revision: "retry" }).catch((error: unknown) => {
            notification.error({ title: "重新生成失败", description: errorText(error) });
          });
        }}
      />
    </div>
  );
}
