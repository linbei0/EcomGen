import { Tooltip } from "antd";

import { useHealth } from "../api/hooks/useHealth";
import { API_BASE_URL } from "../config/env";
import styles from "./HealthBadge.module.css";

type HealthState = "up" | "down" | "connecting";

const STATE_TEXT: Record<HealthState, string> = {
  up: "API 已连接",
  down: "API 不可达",
  connecting: "连接中",
};

/** 顶栏 API 连接指示；仅表达 GET /health 结果，不承载业务状态。 */
export function HealthBadge() {
  const query = useHealth();
  const state: HealthState = query.isLoading
    ? "connecting"
    : query.isError || query.data?.status !== "ok"
      ? "down"
      : "up";

  return (
    <Tooltip title={API_BASE_URL}>
      <span className={`${styles.badge} ${styles[state]}`} data-testid="health-badge">
        <span className={styles.dot} aria-hidden />
        {STATE_TEXT[state]}
      </span>
    </Tooltip>
  );
}
