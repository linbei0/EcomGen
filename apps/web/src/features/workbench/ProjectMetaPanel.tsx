import { App, Input } from "antd";
import { ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import type { ProjectDetail, UpdateProjectInput } from "../../api/adapters/projectDetail";
import { useUpdateProject } from "../../api/hooks/useProjects";
import { errorText } from "../../lib/errorText";
import styles from "./workbench.module.css";

type Mode = ProjectDetail["defaultMode"];
type Platform = ProjectDetail["platformTargets"][number];

/** 左栏 SPU 元数据：文本失焦保存，点选类即时保存；失败 toast 不回写假成功。 */
export function ProjectMetaPanel({ detail }: { detail: ProjectDetail }) {
  const { notification } = App.useApp();
  const updateProject = useUpdateProject(detail.id);
  const [name, setName] = useState(detail.name);

  useEffect(() => setName(detail.name), [detail.name]);

  const save = async (body: UpdateProjectInput, failureTitle: string) => {
    try {
      await updateProject.mutateAsync(body);
    } catch (error) {
      notification.error({ title: failureTitle, description: errorText(error) });
    }
  };

  const commitName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === detail.name) {
      setName(detail.name);
      return;
    }
    await save({ name: trimmed }, "保存名称失败");
  };

  const togglePlatform = (platform: Platform) => {
    const exists = detail.platformTargets.includes(platform);
    const next = exists
      ? detail.platformTargets.filter((item) => item !== platform)
      : [...detail.platformTargets, platform];
    if (next.length === 0) return;
    void save({ platformTargets: next }, "保存平台失败");
  };

  const setMode = (mode: Mode) => {
    if (mode === detail.defaultMode) return;
    void save({ defaultMode: mode }, "保存模式失败");
  };

  return (
    <div>
      <p className={styles.sectionTitle}>SPU</p>
      <Input
        aria-label="项目名称"
        className={styles.nameInput}
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void commitName()}
      />
      <div className={styles.platformRow} role="group" aria-label="目标平台">
        <button
          type="button"
          data-active={detail.platformTargets.includes("DOMESTIC")}
          onClick={() => togglePlatform("DOMESTIC")}
        >
          国内平台
        </button>
        <button
          type="button"
          data-active={detail.platformTargets.includes("AMAZON")}
          onClick={() => togglePlatform("AMAZON")}
        >
          Amazon
        </button>
      </div>
      <div className={styles.modeRow} role="group" aria-label="默认模式">
        <button type="button" data-active={detail.defaultMode === "CREATIVE"} onClick={() => setMode("CREATIVE")}>
          <Sparkles size={16} strokeWidth={1.75} aria-hidden />
          <strong>创意模式</strong>
          <span>语义一致，允许场景创作</span>
        </button>
        <button
          type="button"
          data-active={detail.defaultMode === "PIXEL_PROTECTED"}
          onClick={() => setMode("PIXEL_PROTECTED")}
        >
          <ShieldCheck size={16} strokeWidth={1.75} aria-hidden />
          <strong>像素保护</strong>
          <span>保留主体像素，仅生成外部</span>
        </button>
      </div>
    </div>
  );
}
