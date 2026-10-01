/**
 * 规格包的确定性排版运算：contain-fit 进安全区后居中。
 *
 * 这是 PRINT_PACK 的全部"智能"——刻意保持纯函数：同输入恒同输出，单元测试直接锁数学，
 * Worker 执行器只负责读写文件与元数据。放大允许（印刷文件需要图案铺满可印区），
 * 重采样核固定 lanczos3 并随 manifest 声明，不虚构"无损放大"。
 */

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

export interface PrintPackTileLayout {
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  /** 首枚 tile 左上角；铺满语义下允许负坐标（居中铺贴时越界由行列数吸收）。 */
  left: number;
  top: number;
}

/**
 * TILE 满印版式：花型长边缩放到画布短边一半（保证至少 2×2 重复），保纵横比，
 * repeat 铺满整幅画布——满印无安全边距。列/行向上取整保证覆盖，居中铺贴的
 * 对称越界让四边裁切均匀。
 */
export function computePrintPackTileLayout(
  canvasWidthPx: number,
  canvasHeightPx: number,
  sourceWidth: number,
  sourceHeight: number,
): PrintPackTileLayout {
  if (canvasWidthPx <= 0 || canvasHeightPx <= 0) throw new Error("Print canvas dimensions must be positive");
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error("Pattern source dimensions must be positive");
  const target = Math.min(canvasWidthPx, canvasHeightPx) / 2;
  const scale = target / Math.max(sourceWidth, sourceHeight);
  const tileWidth = Math.max(1, Math.round(sourceWidth * scale));
  const tileHeight = Math.max(1, Math.round(sourceHeight * scale));
  const columns = Math.ceil(canvasWidthPx / tileWidth);
  const rows = Math.ceil(canvasHeightPx / tileHeight);
  const left = Math.round((canvasWidthPx - columns * tileWidth) / 2);
  const top = Math.round((canvasHeightPx - rows * tileHeight) / 2);
  return { tileWidth, tileHeight, columns, rows, left, top };
}
