import { App, Button, Progress, Switch } from "antd";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";

import { exportDownloadUrl, type Job, type ProjectDetail } from "../../api/adapters/projectDetail";
import { useCreateExportJob, useExport } from "../../api/hooks/useExport";
import { errorText } from "../../lib/errorText";
import { exportableOutputs, isActiveExport, latestExportJob } from "../../lib/exportJob";
import { jobErrorText } from "../../lib/jobError";
import { PLATFORM_LABEL } from "../../lib/roles";
import styles from "./workbench.module.css";

const EXPORT_STATUS = {
  QUEUED: "排队中",
  RUNNING: "打包中",
  SUCCEEDED: "可下载",
  FAILED: "导出失败",
  CANCELLED: "已取消",
} as const;

export function ExportStage({ detail }: { detail: ProjectDetail }) {
  const { notification } = App.useApp();
  const createExport = useCreateExportJob(detail.id);
  const selectedIds = useMemo(() => exportableOutputs(detail.outputs), [detail.outputs]);
  const [platforms, setPlatforms] = useState<("DOMESTIC" | "AMAZON")[]>(detail.platformTargets);
  const [slices, setSlices] = useState(false);
  const [activeExportId, setActiveExportId] = useState<string | undefined>(undefined);
  const seedJob = latestExportJob(detail.jobs);
  const liveExport = useExport(activeExportId);
  const job = seedJob;
  const record = liveExport.data;

  const submit = async () => {
    if (selectedIds.length === 0) {
      notification.error({ title: "没有可导出的成图", description: "先在审核阶段选入。" });
      return;
    }
    if (platforms.length === 0) {
      notification.error({ title: "至少选择一个平台" });
      return;
    }
    try {
      const bundle = await createExport.mutateAsync({
        outputIds: selectedIds,
        platformTargets: platforms,
        includeDetailPageSlices: slices,
      });
      if (bundle.export) setActiveExportId(bundle.export.id);
    } catch (error) {
      notification.error({ title: "导出提交失败", description: errorText(error) });
    }
  };

  const togglePlatform = (value: "DOMESTIC" | "AMAZON") => {
    setPlatforms((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  };

  const history = detail.jobs.filter((entry) => entry.type === "EXPORT");

  return (
    <div className={styles.exportWrap}>
      {selectedIds.length === 0 ? (
        <p className={styles.banner}>只有已选入的成图可以导出。待审和淘汰不计入。</p>
      ) : (
        <p className={styles.summaryLine}>可导出 {selectedIds.length} 张</p>
      )}

      <div className={styles.exportPanel}>
        <p className={styles.fieldLabel}>平台</p>
        <div className={styles.chipRow}>
          {(["DOMESTIC", "AMAZON"] as const).map((platform) => (
            <button
              key={platform}
              type="button"
              className={styles.chip}
              data-on={platforms.includes(platform)}
              onClick={() => togglePlatform(platform)}
            >
              {PLATFORM_LABEL[platform]}
            </button>
          ))}
        </div>
        <label className={styles.switchRow}>
          <Switch checked={slices} onChange={setSlices} />
          包含详情页切片
        </label>
        <p className={styles.hint}>费用与体积由本机打包决定，此处不预估。</p>
        <Button type="primary" loading={createExport.isPending} disabled={selectedIds.length === 0} onClick={() => void submit()}>
          导出 ZIP
        </Button>
      </div>

      <ExportProgress job={job} recordId={record?.id ?? activeExportId} />

      {history.length > 0 ? (
        <ul className={styles.exportHistory}>
          {history.map((entry) => (
            <li key={entry.id}>
              <span>{EXPORT_STATUS[entry.status]}</span>
              <span>{entry.progress}%</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ExportProgress({ job, recordId }: { job: Job | undefined; recordId: string | undefined }) {
  const live = useExport(recordId);
  const record = live.data;
  if (!job && !record) return null;
  const status = record?.status ?? job?.status ?? "QUEUED";
  const failed = job?.status === "FAILED";
  const error = job ? jobErrorText(job) : null;
  const href = record ? exportDownloadUrl(record) : undefined;

  return (
    <aside className={styles.jobCard} data-status={status}>
      <p className={styles.jobStatus}>{EXPORT_STATUS[status as keyof typeof EXPORT_STATUS] ?? status}</p>
      {isActiveExport(job) || status === "QUEUED" || status === "RUNNING" ? (
        <Progress percent={job?.progress ?? 0} showInfo />
      ) : null}
      {failed && error ? <p className={styles.jobError}>{error}</p> : null}
      {status === "SUCCEEDED" && href ? (
        <a className={styles.downloadLink} href={href} download>
          <Download size={14} strokeWidth={1.75} aria-hidden />
          下载 ZIP
        </a>
      ) : null}
    </aside>
  );
}
