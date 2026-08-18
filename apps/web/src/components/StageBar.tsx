import { motion } from "motion/react";

import { STAGE_META, STAGES, type Stage } from "../lib/stages";
import styles from "./StageBar.module.css";

interface Props {
  current: Stage;
  completed: ReadonlySet<Stage>;
  onChange: (stage: Stage) => void;
}

export function StageBar({ current, completed, onChange }: Props) {
  return (
    <nav className={styles.bar} aria-label="工作阶段">
      {STAGES.map((stage) => {
        const active = stage === current;
        const done = completed.has(stage);
        return (
          <button
            key={stage}
            type="button"
            className={styles.item}
            data-active={active}
            data-done={done}
            aria-current={active ? "step" : undefined}
            onClick={() => onChange(stage)}
          >
            {active ? <motion.span layoutId="stage-indicator" className={styles.indicator} /> : null}
            <span className={styles.index}>{STAGE_META[stage].index + 1}</span>
            <span className={styles.label}>{STAGE_META[stage].label}</span>
          </button>
        );
      })}
    </nav>
  );
}
