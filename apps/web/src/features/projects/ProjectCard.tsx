import { Link } from "react-router";

import type { Project } from "../../api/adapters/projectDetail";
import { ModeBadge } from "../../components/ModeBadge";
import { formatShortDate } from "../../lib/format";
import { PLATFORM_LABEL } from "../../lib/roles";
import styles from "./ProjectCard.module.css";

export function ProjectCard({ project }: { project: Project }) {
  const platforms = project.platformTargets.map((item) => PLATFORM_LABEL[item]).join(" / ");
  return (
    <Link to={`/projects/${project.id}?view=setup`} className={styles.card}>
      <div className={styles.cover} aria-hidden>
        <span className={styles.coverMark}>{project.name.slice(0, 1)}</span>
      </div>
      <div className={styles.body}>
        <h2 className={styles.name}>{project.name}</h2>
        <p className={styles.meta}>
          {platforms}
          {project.category ? ` · ${project.category}` : ""}
        </p>
        <div className={styles.footer}>
          <ModeBadge mode={project.defaultMode} />
          <time dateTime={project.updatedAt}>{formatShortDate(project.updatedAt)}</time>
        </div>
      </div>
    </Link>
  );
}
