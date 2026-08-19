import { motion } from "motion/react";

import { VIEW_META, VIEWS, type WorkbenchView } from "../lib/stages";
import styles from "./StageBar.module.css";

interface Props {
  current: WorkbenchView;
  completed: ReadonlySet<WorkbenchView>;
  onChange: (view: WorkbenchView) => void;
}

export function StageBar({ current, completed, onChange }: Props) {
  return (
    <nav className={styles.bar} aria-label="工作阶段">
      {VIEWS.map((view) => {
        const active = view === current;
        const done = completed.has(view);
        return (
          <button
            key={view}
            type="button"
            className={styles.item}
            data-active={active}
            data-done={done}
            aria-current={active ? "step" : undefined}
            onClick={() => onChange(view)}
          >
            {active ? <motion.span layoutId="stage-indicator" className={styles.indicator} /> : null}
            <span className={styles.index}>{VIEW_META[view].index + 1}</span>
            <span className={styles.label}>{VIEW_META[view].label}</span>
          </button>
        );
      })}
    </nav>
  );
}
