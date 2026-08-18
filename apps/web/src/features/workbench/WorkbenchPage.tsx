import { Button, Result, Skeleton } from "antd";
import { Aperture, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { useProjectEvents } from "../../api/hooks/useProjectEvents";
import { useProject } from "../../api/hooks/useProjects";
import { selectedStoryboardItem, useStoryboard } from "../../api/hooks/useStoryboard";
import { useTemplates } from "../../api/hooks/useTemplates";
import { HealthBadge } from "../../components/HealthBadge";
import { ModeBadge } from "../../components/ModeBadge";
import { StageBar } from "../../components/StageBar";
import { completedStages, deriveStage, parseStage, type Stage } from "../../lib/stages";
import { errorText } from "../../lib/errorText";
import { SettingsDrawer } from "../providers/SettingsDrawer";
import { AssetsStage } from "./AssetsStage";
import { ExportStage } from "./ExportStage";
import { GenerateStage } from "./GenerateStage";
import { PlanStage } from "./PlanStage";
import { ProjectInspector } from "./ProjectInspector";
import { ProjectMetaPanel } from "./ProjectMetaPanel";
import { ReviewStage } from "./ReviewStage";
import { StoryboardInspector } from "./StoryboardInspector";
import { StoryboardStage } from "./StoryboardStage";
import { VariantPanel } from "./VariantPanel";
import styles from "./workbench.module.css";

export function WorkbenchPage() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const project = useProject(projectId);
  useProjectEvents(projectId);
  const board = useStoryboard(projectId);
  const templates = useTemplates();
  const derived = project.data ? deriveStage(project.data) : "assets";
  const stage = parseStage(searchParams.get("stage"), derived);
  const done = useMemo(
    () => (project.data ? completedStages(project.data) : new Set<Stage>()),
    [project.data],
  );
  const items = board.data?.items ?? project.data?.items ?? [];
  const selectedId = searchParams.get("item");
  const selected = selectedStoryboardItem(items, selectedId);
  const locked = (board.data?.storyboard ?? project.data?.storyboard)?.status === "CONFIRMED";

  const setStage = (next: Stage) => {
    if (!projectId) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("stage", next);
    void navigate(`/projects/${projectId}?${nextParams.toString()}`, { replace: true });
  };

  const setItem = (id: string) => {
    if (!projectId) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("stage", "storyboard");
    nextParams.set("item", id);
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
        <StageBar current={stage} completed={done} onChange={setStage} />
        <div className={styles.topActions}>
          <ModeBadge mode={detail.defaultMode} />
          <HealthBadge />
          <Button icon={<Settings2 size={16} strokeWidth={1.75} />} onClick={() => setSettingsOpen(true)}>
            设置
          </Button>
        </div>
      </header>

      <div className={styles.shell}>
        <aside className={styles.left}>
          <ProjectMetaPanel detail={detail} />
          <VariantPanel projectId={detail.id} variants={detail.variants} />
        </aside>

        <main className={styles.center}>
          {stage === "assets" ? <AssetsStage detail={detail} /> : null}
          {stage === "plan" ? <PlanStage detail={detail} /> : null}
          {stage === "storyboard" ? (
            <StoryboardStage detail={detail} selectedItemId={selected?.id ?? null} onSelectItem={setItem} />
          ) : null}
          {stage === "generate" ? (
            <GenerateStage detail={detail} preselectedItemId={searchParams.get("item")} />
          ) : null}
          {stage === "review" ? (
            <ReviewStage
              detail={detail}
              onRetryItem={(itemId) => {
                const nextParams = new URLSearchParams(searchParams);
                nextParams.set("stage", "generate");
                nextParams.set("item", itemId);
                void navigate(`/projects/${detail.id}?${nextParams.toString()}`, { replace: true });
              }}
            />
          ) : null}
          {stage === "export" ? <ExportStage detail={detail} /> : null}
        </main>

        <aside className={styles.right}>
          {stage === "storyboard" && selected ? (
            <StoryboardInspector
              projectId={detail.id}
              item={selected}
              templates={templates.data ?? []}
              variants={detail.variants}
              locked={Boolean(locked)}
            />
          ) : (
            <ProjectInspector detail={detail} />
          )}
        </aside>
      </div>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}


