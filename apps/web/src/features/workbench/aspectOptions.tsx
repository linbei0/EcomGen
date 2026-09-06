import type { SelectProps } from "antd";
import type { CSSProperties } from "react";

import type { ImageAspectRatio } from "../../api/adapters/projectDetail";
import { ASPECT_LABEL } from "../../lib/roles";
import styles from "./workbench.module.css";

export const ASPECT_SELECT_OPTIONS: Array<{ value: ImageAspectRatio; label: string }> = Object.entries(ASPECT_LABEL).map(([value, label]) => ({ value: value as ImageAspectRatio, label }));

/** 示意框按 w:h 等比缩放进 14px 视觉盒，竖/横/方一眼可辨；非比例值回退为小方块。 */
function aspectGlyphStyle(ratio: string): CSSProperties {
  const [width = NaN, height = NaN] = ratio.split(":").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 12, height: 12 };
  }
  const scale = 14 / Math.max(width, height);
  return { width: Math.max(4, Math.round(width * scale)), height: Math.max(4, Math.round(height * scale)) };
}

/** 下拉选项渲染：比例示意框 + 等宽比例值 + 弱化描述；示意框放在固定宽度槽位内，保证比例值纵向对齐。 */
export const renderAspectOption: NonNullable<SelectProps["optionRender"]> = (oriOption) => {
  const ratio = String(oriOption.data.value ?? "");
  const label = ASPECT_LABEL[ratio as ImageAspectRatio] ?? ratio;
  const separator = label.indexOf(" ");
  const ratioText = separator === -1 ? label : label.slice(0, separator);
  const description = separator === -1 ? "" : label.slice(separator + 1);
  return (
    <div className={styles.aspectOption}>
      <span className={styles.aspectGlyphBox} aria-hidden>
        <span
          className={ratio === "AUTO" ? styles.aspectGlyphAuto : styles.aspectGlyph}
          style={aspectGlyphStyle(ratio)}
        />
      </span>
      <span className={styles.aspectRatioText}>{ratioText}</span>
      {description ? <span className={styles.aspectDesc}>{description}</span> : null}
    </div>
  );
};
