import { ShieldCheck, Sparkles } from "lucide-react";

import styles from "./ModeBadge.module.css";

export function ModeBadge({ mode }: { mode: "CREATIVE" | "PIXEL_PROTECTED" }) {
  const protectedMode = mode === "PIXEL_PROTECTED";
  const Icon = protectedMode ? ShieldCheck : Sparkles;
  return (
    <span className={styles.badge} data-mode={mode}>
      <Icon size={14} strokeWidth={1.75} aria-hidden />
      {protectedMode ? "像素保护" : "创意"}
    </span>
  );
}
