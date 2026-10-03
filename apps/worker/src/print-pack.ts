/**
 * 规格包的确定性排版运算：contain-fit 进安全区居中，以及满印的平铺排列几何。
 *
 * 这是 PRINT_PACK 的全部"智能"——刻意保持纯函数：同输入恒同输出，单元测试直接锁数学，
 * Worker 执行器只负责读写文件与元数据。放大允许（印刷文件需要图案铺满可印区），
 * 重采样核固定 lanczos3 并随 manifest 声明，不虚构"无损放大"。
 */
import { REPEAT_UNIT_PLACEMENTS, type PodRepeatLayout, type RepeatUnitPlacement } from "@ecomgen/contracts";
import type { RepeatUnitPlacementPixels } from "./repeat-unit.js";

export interface PrintPackPlacement {
  /** 重采样后的图稿尺寸（像素）。 */
  width: number;
  height: number;
  /** 图稿在画布上的左上角位置（像素），已取整并保证不越界。 */
  left: number;
  top: number;
}

/** 画布尺寸、安全边距百分比与源图尺寸 → 居中放置参数。非法输入（非正数）抛错而不是产出负尺寸。 */
export function computePrintPackPlacement(
  canvasWidthPx: number,
  canvasHeightPx: number,
  safeMarginPct: number,
  sourceWidth: number,
  sourceHeight: number,
): PrintPackPlacement {
  if (canvasWidthPx <= 0 || canvasHeightPx <= 0) throw new Error("Print canvas dimensions must be positive");
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error("Pattern source dimensions must be positive");
  const margin = Math.round((Math.min(canvasWidthPx, canvasHeightPx) * Math.min(Math.max(safeMarginPct, 0), 50)) / 100);
  const boxWidth = canvasWidthPx - margin * 2;
  const boxHeight = canvasHeightPx - margin * 2;
  if (boxWidth <= 0 || boxHeight <= 0) throw new Error("Safe margin consumes the entire print canvas");
  // contain-fit：取两个方向的缩放比较小值，保证图稿完整落在安全区内。
  const scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const left = Math.min(Math.round((canvasWidthPx - width) / 2), Math.max(0, canvasWidthPx - width));
  const top = Math.min(Math.round((canvasHeightPx - height) / 2), Math.max(0, canvasHeightPx - height));
  return { width, height, left, top };
}

/** 该枚花型在重复单元内的左上角（像素）；就是合成端消费的摆放位，不另立一份定义。 */
export type PrintPackTilePlacement = RepeatUnitPlacementPixels;

/** 把契约里的单元摆放（dx/dy 为花型边长的倍数）折算成像素：两处几何只差一个基准尺寸。 */
function placementPixels(placements: readonly RepeatUnitPlacement[], tileWidth: number, tileHeight: number): PrintPackTilePlacement[] {
  return placements.map((placement) => ({
    left: Math.round(placement.dx * tileWidth),
    top: Math.round(placement.dy * tileHeight),
    flipX: placement.flipX,
    flipY: placement.flipY,
  }));
}

export interface PrintPackTileLayout {
  /** 重采样后的基础花型尺寸。 */
  tileWidth: number;
  tileHeight: number;
  /** 重复单元的像素尺寸（= 基础花型 × 单元花型位数）。 */
  unitWidth: number;
  unitHeight: number;
  /** 重复单元在画布上的行列数。 */
  columns: number;
  rows: number;
  /** 首个单元左上角；铺满语义下允许负坐标（居中铺贴时越界由行列数吸收）。 */
  left: number;
  top: number;
  repeat: PodRepeatLayout;
  /** 单元内每枚花型的摆放（print 缩放下）；越界位由合成方环绕补画。 */
  placements: PrintPackTilePlacement[];
}

/**
 * TILE 满印版式：花型长边缩放到画布短边一半（保证至少 2×2 重复），保纵横比，
 * repeat 铺满整幅画布——满印无安全边距。列/行向上取整保证覆盖，居中铺贴的
 * 对称越界让四边裁切均匀。
 *
 * 平铺排列改变"重复单元"而非缩放：直排单元=花型本身（与历史行为逐字节一致）；
 * 半落/三落/错砖的单元含 2–3 个错位花型位，单元允许 1×——错落感由单元内部的错位给出，
 * 花型视觉尺寸与密度和直排一致；镜像强制单元 ≥2×2（缩放目标减半），否则一个四象限
 * 铺满画布退化成万花筒而非满印（ADR-0001）。
 */
export function computePrintPackTileLayout(
  canvasWidthPx: number,
  canvasHeightPx: number,
  sourceWidth: number,
  sourceHeight: number,
  repeat: PodRepeatLayout = "STRAIGHT",
): PrintPackTileLayout {
  if (canvasWidthPx <= 0 || canvasHeightPx <= 0) throw new Error("Print canvas dimensions must be positive");
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error("Pattern source dimensions must be positive");
  const unit = REPEAT_UNIT_PLACEMENTS[repeat];
  const target = Math.min(canvasWidthPx, canvasHeightPx) / (repeat === "MIRROR" ? 4 : 2);
  const scale = target / Math.max(sourceWidth, sourceHeight);
  const tileWidth = Math.max(1, Math.round(sourceWidth * scale));
  const tileHeight = Math.max(1, Math.round(sourceHeight * scale));
  const unitWidth = Math.max(1, Math.round(tileWidth * unit.columns));
  const unitHeight = Math.max(1, Math.round(tileHeight * unit.rows));
  const placements = placementPixels(unit.placements, tileWidth, tileHeight);
  const columns = Math.ceil(canvasWidthPx / unitWidth);
  const rows = Math.ceil(canvasHeightPx / unitHeight);
  const left = Math.round((canvasWidthPx - columns * unitWidth) / 2);
  const top = Math.round((canvasHeightPx - rows * unitHeight) / 2);
  return { tileWidth, tileHeight, unitWidth, unitHeight, columns, rows, left, top, repeat, placements };
}

export interface RepeatUnitGeometry {
  unitWidth: number;
  unitHeight: number;
  placements: PrintPackTilePlacement[];
}

/**
 * 源图原生分辨率下的重复单元几何——无缝单元（SEAMLESS_TILE 产物）用。
 * 印刷排版允许 lanczos 放大，无缝单元不放大：第三方平台拿它自己再平铺，尺寸虚增没有意义。
 */
export function computeRepeatUnitGeometry(sourceWidth: number, sourceHeight: number, repeat: PodRepeatLayout): RepeatUnitGeometry {
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error("Pattern source dimensions must be positive");
  const unit = REPEAT_UNIT_PLACEMENTS[repeat];
  return {
    unitWidth: Math.max(1, Math.round(sourceWidth * unit.columns)),
    unitHeight: Math.max(1, Math.round(sourceHeight * unit.rows)),
    placements: placementPixels(unit.placements, sourceWidth, sourceHeight),
  };
}
