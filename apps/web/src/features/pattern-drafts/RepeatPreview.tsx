import type { DraftCandidateTileable, PodRepeatLayout } from "@ecomgen/contracts";
import { Segmented, Slider } from "antd";
import { useState } from "react";

import { TileVerdict, TiledPatternStage } from "../patterns/shared";

/** 接缝视图里单元的渲染尺寸：比平铺预览大，让接缝处的图案流向看得清。 */
const SEAM_UNIT = 260;
/** 接缝标记线：细到不遮图案，又足以指出该看哪里。 */
const SEAM_MARKER = "rgba(217, 164, 65, 0.85)";

/**
 * 连续花型预览：单元平铺与接缝检查。
 *
 * 预览只改变显示、不写入任何像素，也不能据此宣称"已无缝"——能否算可平铺由确定性验缝算法判定，
 * 这里把两个轴的分数和结论并排展示，是为了让人眼能顺着数字去找那条接不上的边。
 *
 * 四条布局约束（都踩过坑）：
 * - 平铺模式铺满整个舞台：预览是有边界的图，留白不表达信息，铺满才能一眼看出重复节奏。
 *   铺法复用 `TiledPatternStage`，与成包几何同源，所以下拉里选的排列（错位、镜像）在这里就
 *   能看见——CSS background-repeat 只能直排，表达不了错位与翻转。
 * - 接缝检查用「半单元错位」：把图案整体位移半个单元并标出接缝，接缝就落在画面中部，
 *   图案以连续图像呈现。之前裁两条边缘窄带并排，深色繁复的花型看起来就是一条深色带子，
 *   根本判断不出接缝——错位法才是判断四方连续的常用做法（等价于 Photoshop 的位移滤镜）。
 * - 图案层一律透明，透明衬底只由舞台（.viewer 的预览底色）提供一层。预览区若自己再画一遍
 *   棋盘，两层各自的 `background-position: 50% 50%` 是相对各自盒子算的，会错位叠在一起，
 *   看起来就是"两层底色"。
 * - 控件与文字一律落在应用自己的面板底色上，且显式指定颜色，不继承链接色、不直接压在
 *   用户选的预览底色上——白底/黑底会让深色主题的文字失去对比度。
 */
export function RepeatPreview({ imageUrl, layout, tileable, onTileCheck, checking }: { imageUrl: string; layout: PodRepeatLayout; tileable: DraftCandidateTileable; onTileCheck?: () => void; checking?: boolean }) {
  const [mode, setMode] = useState<"tile" | "seam">("tile");
  const [unitSize, setUnitSize] = useState(160);

  return (
    <div style={{ alignSelf: "stretch", width: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--bg-2)" }}>
        <Segmented
          size="small"
          value={mode}
          onChange={(value) => setMode(value as "tile" | "seam")}
          options={[{ value: "tile", label: "重复预览" }, { value: "seam", label: "接缝放大" }]}
        />
        {mode === "tile" ? (
          <>
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>花型尺寸</span>
            <Slider style={{ width: 120 }} min={80} max={360} value={unitSize} onChange={setUnitSize} aria-label="花型尺寸" />
          </>
        ) : null}
        {onTileCheck ? (
          // 显式给链接色：这里不继承主题链接色，避免在面板底色上偏暗。
          <a onClick={onTileCheck} style={{ fontSize: 12, color: "var(--accent)", cursor: "pointer" }}>
            {checking ? "检测中…" : "重新检测接缝"}
          </a>
        ) : null}
        <TileVerdict tileable={tileable} />
        {mode === "seam" ? (
          <span style={{ flexBasis: "100%", fontSize: 12, color: "var(--text-2)" }}>
            已按半个单元错位，接缝移到画面中部，黄线即接缝位置；图案在此处错位或断开就是接不上。这只是人眼辅助，合格与否以「验缝」算法的分轴结论为准。
          </span>
        ) : null}
      </div>

      {mode === "tile" ? (
        <div aria-label="重复预览" style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", borderRadius: 8 }}>
          {/* 绝对定位铺满，不依赖父级 flex 高度能否解析出百分比高度——旧实现也是 absolute inset:0。 */}
          <TiledPatternStage imageUrl={imageUrl} layout={layout} tileSize={unitSize} ariaLabel="重复预览" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
        </div>
      ) : (
        // 三层分开挂：错位图案 + 两条接缝标记线。透明像素直接透出舞台的预览底色，这里不再画衬底。
        <div aria-label="接缝放大" style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", borderRadius: 8, border: "1px solid var(--line-1)" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${imageUrl})`, backgroundRepeat: "repeat", backgroundSize: `${SEAM_UNIT}px ${SEAM_UNIT}px`, backgroundPosition: `${-SEAM_UNIT / 2}px ${-SEAM_UNIT / 2}px` }} />
          <div style={{ position: "absolute", inset: 0, backgroundImage: `repeating-linear-gradient(to right, ${SEAM_MARKER} 0 1px, transparent 1px ${SEAM_UNIT}px)`, backgroundPosition: `${-SEAM_UNIT / 2}px 0` }} />
          <div style={{ position: "absolute", inset: 0, backgroundImage: `repeating-linear-gradient(to bottom, ${SEAM_MARKER} 0 1px, transparent 1px ${SEAM_UNIT}px)`, backgroundPosition: `0 ${-SEAM_UNIT / 2}px` }} />
        </div>
      )}
    </div>
  );
}

