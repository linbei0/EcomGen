import { useState } from "react";
import { Dropdown } from "antd";
import { Link } from "react-router";
import { Archive, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";

import type { Project } from "../../api/adapters/projectDetail";
import { assetPreviewUrl, outputPreviewUrl } from "../../lib/assetUrl";
import styles from "./ProjectCard.module.css";

function coverMedia(cover: Project["cover"]) {
  const productAssetId = cover?.productAssetId ?? null;
  const coverOutputId = cover?.coverOutputId ?? null;
  const heroUrl = coverOutputId
    ? outputPreviewUrl({ id: coverOutputId })
    : productAssetId
      ? assetPreviewUrl({ id: productAssetId })
      : null;
  const originalUrl = coverOutputId && productAssetId ? assetPreviewUrl({ id: productAssetId }) : null;
  return {
    heroUrl,
    originalUrl,
    previewUrls: (cover?.previewOutputIds ?? []).map((id) => outputPreviewUrl({ id })),
    outputCount: cover?.outputCount ?? 0,
  };
}

interface ProjectCardProps {
  project: Project;
  onArchiveChange?: (archived: boolean) => void;
  onDeleteRequest?: () => void;
}

export function ProjectCard({ project, onArchiveChange, onDeleteRequest }: ProjectCardProps) {
  const media = coverMedia(project.cover);
  const [brokenUrls, setBrokenUrls] = useState<ReadonlySet<string>>(() => new Set());
  const markBroken = (url: string) => {
    setBrokenUrls((current) => {
      if (current.has(url)) return current;
      const next = new Set(current);
      next.add(url);
      return next;
    });
  };
  const heroUrl = media.heroUrl && !brokenUrls.has(media.heroUrl) ? media.heroUrl : null;
  const originalUrl = media.originalUrl && !brokenUrls.has(media.originalUrl) ? media.originalUrl : null;

  const archived = Boolean(project.archivedAt);
  const menuItems = [
    {
      key: archived ? "restore" : "archive",
      icon: archived ? <RotateCcw size={14} strokeWidth={1.75} /> : <Archive size={14} strokeWidth={1.75} />,
      label: archived ? "恢复项目" : "归档项目",
    },
    ...(archived && onDeleteRequest
      ? [{ key: "delete", icon: <Trash2 size={14} strokeWidth={1.75} />, label: "删除项目" }]
      : []),
  ];

  return (
    <article className={styles.card}>
      <div className={styles.cover}>
        <Link to={`/projects/${project.id}?view=setup`} className={styles.coverLink} aria-hidden tabIndex={-1} />
        {heroUrl ? (
          <img
            src={heroUrl}
            alt=""
            className={styles.hero}
            loading="lazy"
            decoding="async"
            onError={() => markBroken(heroUrl)}
          />
        ) : (
          <span className={styles.coverMark} aria-hidden>
            {project.name.slice(0, 1)}
          </span>
        )}
        {originalUrl ? (
          <div className={styles.original}>
            <img
              src={originalUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => markBroken(originalUrl)}
            />
            <span className={styles.originalLabel}>原图</span>
          </div>
        ) : null}
        {media.outputCount > 0 ? (
          <div className={styles.cluster}>
            {media.previewUrls.some((url) => !brokenUrls.has(url)) ? (
              <div className={styles.stack}>
                {media.previewUrls.map((url) =>
                  brokenUrls.has(url) ? null : (
                    <img
                      key={url}
                      src={url}
                      alt=""
                      className={styles.stackThumb}
                      loading="lazy"
                      decoding="async"
                      onError={() => markBroken(url)}
                    />
                  ),
                )}
              </div>
            ) : null}
            <span className={styles.count}>生成 {media.outputCount} 张套图</span>
          </div>
        ) : null}
        {onArchiveChange ? (
          <Dropdown
            menu={{
              items: menuItems,
              onClick: ({ key }) => key === "delete" ? onDeleteRequest?.() : onArchiveChange(!archived),
            }}
            trigger={["click"]}
            placement="bottomRight"
          >
            <button
              type="button"
              className={styles.menuButton}
              aria-label={archived && onDeleteRequest ? "项目操作：恢复或删除" : archived ? "项目操作：恢复" : "项目操作：归档"}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </Dropdown>
        ) : null}
      </div>
      <Link to={`/projects/${project.id}?view=setup`} className={styles.bodyLink}>
        <div className={styles.body}>
        {project.category ? <p className={styles.category}>{project.category}</p> : null}
        <h2 className={styles.name}>{project.name}</h2>
        </div>
      </Link>
    </article>
  );
}
