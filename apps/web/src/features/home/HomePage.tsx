import { App, Button, Drawer } from "antd";
import { Aperture, Archive, Images, Plus, Settings2, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { useArchiveProject, useCreateProject, useDeleteProject, useProjects } from "../../api/hooks/useProjects";
import { useProviders } from "../../api/hooks/useProviders";
import { HealthBadge } from "../../components/HealthBadge";
import { fadeUp, staggerContainer } from "../../design/motion";
import { errorText } from "../../lib/errorText";
import { pickDefaultModels } from "../../lib/modelOptions";
import { ProjectCard } from "../projects/ProjectCard";
import { SettingsDrawer } from "../providers/SettingsDrawer";
import styles from "./HomePage.module.css";

export function HomePage() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const { modal, notification } = App.useApp();
  const navigate = useNavigate();
  const projects = useProjects();
  const archivedProjects = useProjects({ archived: true });
  const providers = useProviders();
  const createProject = useCreateProject();
  const archiveProject = useArchiveProject();
  const deleteProject = useDeleteProject();
  const items = projects.data?.items ?? [];
  const empty = !projects.isPending && items.length === 0;
  const archivedItems = archivedProjects.data?.items ?? [];

  const changeArchive = async (projectId: string, archived: boolean) => {
    try {
      await archiveProject.mutateAsync({ projectId, archived });
      notification.success({ title: archived ? "项目已归档" : "项目已恢复" });
    } catch (error) {
      notification.error({ title: archived ? "归档失败" : "恢复失败", description: errorText(error) });
    }
  };

  const confirmDelete = (projectId: string, projectName: string) => {
    modal.confirm({
      title: "永久删除项目？",
      icon: <Trash2 size={20} strokeWidth={1.75} color="var(--danger)" />,
      content: `“${projectName}”的素材、生成结果、编辑记录和导出文件都将被永久删除，且无法恢复。`,
      okText: "永久删除",
      okType: "danger",
      cancelText: "取消",
      async onOk() {
        try {
          await deleteProject.mutateAsync(projectId);
          notification.success({ title: "项目已删除" });
        } catch (error) {
          notification.error({ title: "删除失败", description: errorText(error) });
          throw error;
        }
      },
    });
  };

  /** 一键创建：凑齐一对模型才 POST，缺一对就引导去设置，不产生建不出来的项目。 */
  const create = async () => {
    const pair = pickDefaultModels(providers.data?.items ?? []);
    if (!pair) {
      notification.warning({ title: "请先配置 Provider", description: "需要至少一个推理模型和一个生图模型。" });
      setSettingsOpen(true);
      return;
    }
    try {
      const project = await createProject.mutateAsync({
        name: "未命名项目",
        category: null,
        productDescription: null,
        verifiedFacts: [],
        prohibitedClaims: [],
        platformTargets: [],
        targetMarket: null,
        copyLanguage: null,
        defaultMode: "CREATIVE",
        ...pair,
      });
      void navigate(`/projects/${project.id}?view=setup`);
    } catch (error) {
      notification.error({ title: "创建失败", description: errorText(error) });
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Aperture size={20} strokeWidth={1.75} aria-hidden />
          <span className={styles.brandName}>EcomGen</span>
        </div>
        <div className={styles.topActions}>
          <HealthBadge />
          <Button icon={<Settings2 size={16} strokeWidth={1.75} />} onClick={() => setSettingsOpen(true)}>
            设置
          </Button>
        </div>
      </header>

      <motion.main className={styles.main} variants={staggerContainer} initial="hidden" animate="visible">
        <motion.section className={styles.hero} variants={fadeUp}>
          <p className={styles.eyebrow}>本地优先 · 电商套图</p>
          <h1 className={styles.headline}>
            上传一张商品图，
            <br />
            显影一套详情页。
          </h1>
          <p className={styles.lede}>
            分镜可编辑、SKU 变体隔离、像素保护与事实约束——由 Agent 规划，由你确认。
          </p>
          <div className={styles.ctaRow}>
            <Button
              type="primary"
              size="large"
              icon={<Plus size={16} strokeWidth={1.75} />}
              loading={createProject.isPending}
              disabled={providers.isPending}
              onClick={() => void create()}
            >
              新建项目
            </Button>
          </div>
        </motion.section>

        <motion.section className={styles.gallery} variants={fadeUp} aria-label="项目画廊">
          <div className={styles.galleryHeader}>
            <div>
              <p className={styles.galleryTitle}>项目画廊</p>
              <p className={styles.galleryHint}>{projects.isPending ? "正在加载项目…" : `${items.length} 个活跃项目`}</p>
            </div>
            <Button
              type="text"
              icon={<Archive size={15} strokeWidth={1.75} />}
              onClick={() => setArchiveOpen(true)}
            >
              已归档{archivedItems.length > 0 ? ` ${archivedItems.length}` : ""}
            </Button>
          </div>
          {projects.isError ? (
            <div className={styles.galleryInner}>
              <p className={styles.galleryTitle}>项目列表加载失败</p>
              <p className={styles.galleryHint}>{errorText(projects.error)}</p>
              <Button onClick={() => void projects.refetch()}>重试</Button>
            </div>
          ) : empty ? (
            <div className={styles.galleryInner}>
              <Images size={20} strokeWidth={1.5} aria-hidden className={styles.galleryIcon} />
              <p className={styles.galleryTitle}>项目画廊 · 暂无项目</p>
              <p className={styles.galleryHint}>配置 Provider 后，从第一个商品款（SPU）开始。</p>
            </div>
          ) : (
            <div className={styles.grid}>
              {items.map((project) => (
                <ProjectCard key={project.id} project={project} onArchiveChange={(archived) => void changeArchive(project.id, archived)} />
              ))}
            </div>
          )}
        </motion.section>
      </motion.main>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Drawer
        title="已归档项目"
        placement="right"
        size={420}
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        rootClassName={styles.archiveDrawer}
      >
        {archivedProjects.isError ? (
          <div className={styles.galleryInner}>
            <p className={styles.galleryTitle}>归档列表加载失败</p>
            <p className={styles.galleryHint}>{errorText(archivedProjects.error)}</p>
            <Button onClick={() => void archivedProjects.refetch()}>重试</Button>
          </div>
        ) : archivedProjects.isPending ? (
          <div className={styles.galleryInner}><p className={styles.galleryHint}>正在加载归档项目…</p></div>
        ) : archivedItems.length === 0 ? (
          <div className={styles.galleryInner}>
            <Archive size={20} strokeWidth={1.5} aria-hidden className={styles.galleryIcon} />
            <p className={styles.galleryTitle}>暂无归档项目</p>
            <p className={styles.galleryHint}>从项目卡片的更多菜单归档不常用项目。</p>
          </div>
        ) : (
          <div className={styles.archiveGrid}>
            {archivedItems.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onArchiveChange={(archived) => void changeArchive(project.id, archived)}
                onDeleteRequest={() => confirmDelete(project.id, project.name)}
              />
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}
