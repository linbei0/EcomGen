import { Button, Result, Skeleton, Tooltip } from "antd";
import { Aperture, PanelLeftClose, PanelLeftOpen, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { useProjectEvents } from "../../api/hooks/useProjectEvents";
import { useProject } from "../../api/hooks/useProjects";
import { HealthBadge } from "../../components/HealthBadge";
import { StageBar } from "../../components/StageBar";
import { completedViews, deriveView, parseView, type WorkbenchView } from "../../lib/stages";
import { errorText } from "../../lib/errorText";
import { loadSidebarCollapsed, saveSidebarCollapsed } from "../../lib/panelState";
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);
  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    saveSidebarCollapsed(next);
    setSidebarCollapsed(next);
  };
  const sidebarToggleLabel = sidebarCollapsed ? "展开配置面板" : "收起配置面板";
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
        <div className={styles.topLeft}>
          <Link to="/" className={styles.brandLink}>
            <Aperture size={18} strokeWidth={1.75} aria-hidden />
            <span className={styles.projectName}>{detail.name}</span>
          </Link>
          <Tooltip title={sidebarToggleLabel}>
            <button
              type="button"
              className={styles.panelToggle}
              aria-label={sidebarToggleLabel}
              aria-expanded={!sidebarCollapsed}
              aria-controls="config-sidebar"
              onClick={toggleSidebar}
            >
              {sidebarCollapsed
                ? <PanelLeftOpen size={16} strokeWidth={1.75} aria-hidden />
                : <PanelLeftClose size={16} strokeWidth={1.75} aria-hidden />}
            </button>
          </Tooltip>
        </div>
        <StageBar current={view} completed={done} onChange={setView} />
        <div className={styles.topActions}>
          <HealthBadge />
          <Button icon={<Settings2 size={16} strokeWidth={1.75} />} onClick={() => setSettingsOpen(true)}>
            设置
          </Button>
        </div>
      </header>

      <div className={styles.shell} data-collapsed={sidebarCollapsed}>
        <aside id="config-sidebar" className={styles.left} data-collapsed={sidebarCollapsed}>
          {sidebarCollapsed ? (
            <div className={styles.rail}>
              <button
                type="button"
                className={styles.railExpand}
                aria-label={sidebarToggleLabel}
                onClick={toggleSidebar}
              >
                <PanelLeftOpen size={16} strokeWidth={1.75} aria-hidden />
              </button>
              <span className={styles.railLabel}>配置面板</span>
            </div>
          ) : (
            <SetupPanel detail={detail} />
          )}
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
