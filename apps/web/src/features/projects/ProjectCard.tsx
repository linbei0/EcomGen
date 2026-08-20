import { useState } from "react";
import { Link } from "react-router";

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

export function ProjectCard({ project }: { project: Project }) {
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

  return (
    <Link to={`/projects/${project.id}?view=setup`} className={styles.card}>
      <div className={styles.cover}>
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
      </div>
      <div className={styles.body}>
        {project.category ? <p className={styles.category}>{project.category}</p> : null}
        <h2 className={styles.name}>{project.name}</h2>
      </div>
    </Link>
  );
}
