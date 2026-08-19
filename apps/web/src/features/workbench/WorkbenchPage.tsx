import { Button, Result, Skeleton } from "antd";
import { Aperture, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { useProjectEvents } from "../../api/hooks/useProjectEvents";
import { useProject } from "../../api/hooks/useProjects";
import { HealthBadge } from "../../components/HealthBadge";
import { StageBar } from "../../components/StageBar";
import { completedViews, deriveView, parseView, type WorkbenchView } from "../../lib/stages";
import { errorText } from "../../lib/errorText";
import { SettingsDrawer } from "../providers/SettingsDrawer";
import { ResultsWorkspace } from "./ResultsWorkspace";
import { AssetsStage } from "./AssetsStage";
import { SetupPanel } from "./SetupPanel";
import { StoryboardStage } from "./StoryboardStage";
import styles from "./workbench.module.css";

export function WorkbenchPage() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const project = useProject(projectId);
  useProjectEvents(projectId);
  const derived = project.data ? deriveView(project.data) : "setup";
  const view = parseView(searchParams.get("view") ?? searchParams.get("stage"), derived);
  const done = useMemo(
    () => (project.data ? completedViews(project.data) : new Set<WorkbenchView>()),
    [project.data],
  );

  const setView = (next: WorkbenchView) => {
    if (!projectId) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("view", next);
    nextParams.delete("stage");
    nextParams.delete("item");
    void navigate(`/projects/${projectId}?${nextParams.toString()}`, { replace: true });
  };

  if (project.isPending) {
    return (
      <div className={styles.page}>
        <div className={styles.missing}>
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      </div>
    );
  }

  if (project.isError || !project.data) {
    return (
      <Result
        status="error"
        title="项目加载失败"
        subTitle={errorText(project.error)}
        extra={
          <Link to="/">
            <Button>返回项目画廊</Button>
          </Link>
        }
      />
    );
  }

  const detail = project.data;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link to="/" className={styles.brandLink}>
          <Aperture size={18} strokeWidth={1.75} aria-hidden />
          <span className={styles.projectName}>{detail.name}</span>
        </Link>
        <StageBar current={view} completed={done} onChange={setView} />
        <div className={styles.topActions}>
          <HealthBadge />
          <Button icon={<Settings2 size={16} strokeWidth={1.75} />} onClick={() => setSettingsOpen(true)}>
            设置
          </Button>
        </div>
      </header>

      <div className={styles.shell}>
        <aside className={styles.left}>
          <SetupPanel detail={detail} />
        </aside>
        <main className={styles.preview}>
          {view === "setup" ? (
            <div className={styles.setupPreview}>
              <div className={styles.previewHeader}>
                <p className={styles.eyebrow}>素材</p>
                <span className={styles.previewCount}>{detail.assets.length} 个素材</span>
              </div>
              <AssetsStage detail={detail} compact={false} />
            </div>
          ) : null}
          {view === "storyboard" ? <StoryboardStage detail={detail} onGenerated={() => setView("results")} /> : null}
          {view === "results" ? <ResultsWorkspace detail={detail} /> : null}
        </main>
      </div>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
