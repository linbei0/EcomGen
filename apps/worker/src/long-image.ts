/**
 * 详情页长图合成：排序、几何与切片全部是纯函数（同输入恒同输出，单测直接锁数学）；
 * renderLongImage 是唯一做 IO 的入口。像素全部来自既有输出文件，不经过生成模型。
 * 合成细节（divider 高度/颜色、jpeg 质量）是固定实现口径而非配置项，随 manifest 声明。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp, { type Sharp } from "sharp";
import type { LongImageExportConfig } from "@ecomgen/contracts";

/** 平台建议上限（淘宝详情页总高 ≤30000px）；同时约束合成画布的内存占用。 */
export const MAX_LONG_IMAGE_HEIGHT = 30_000;
/** 屏间纯色过渡条：行业惯例 24–48px 的中值。 */
export const LONG_IMAGE_DIVIDER_HEIGHT = 32;
export const LONG_IMAGE_DIVIDER_COLOR = "#FFFFFF";
export const LONG_IMAGE_ENCODING_QUALITY = 85;

export interface ResolvedLongImageConfig {
  targetWidth: number;
  sliceHeight: number | null;
}

export interface LongImageLayout {
  targetWidth: number;
  totalHeight: number;
  screens: Array<{ outputId: string; yTop: number; height: number }>;
}

export interface LongImageSlice {
  yTop: number;
  height: number;
}

export interface LongImageFile {
  name: string;
  path: string;
}

export interface LongImageRender {
  config: ResolvedLongImageConfig;
  layout: LongImageLayout;
  /** 切片几何；文件名以 render.files[1..] 为准（files[0] 是整图），manifest 从它派生。 */
  slices: LongImageSlice[];
  files: LongImageFile[];
  cleanup: () => Promise<void>;
}

export function resolveLongImageConfig(config: LongImageExportConfig): ResolvedLongImageConfig {
  return { targetWidth: config.targetWidth, sliceHeight: config.sliceHeight ?? null };
}

export interface LongImageOrderable {
  id: string;
  storyboardItemId: string;
  candidateIndex?: number;
  createdAt: string;
}

/**
 * 拼接顺序：请求显式给出 outputIds 时，数组顺序即拼接顺序（用户在导出弹窗可调整），
 * itemRank 被忽略；全量导出（未给 outputIds）回退「分镜 sort_order → candidateIndex
 * → createdAt → id」的全序，itemRank 由分镜列表顺序（sort_order）派生。
 */
export function orderLongImageScreens<T extends LongImageOrderable>(screens: readonly T[], itemRank?: ReadonlyMap<string, number>, explicitOrder?: readonly string[]): T[] {
  const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  if (explicitOrder) {
    // 调用方已把 outputs 过滤到 explicitOrder，键必然存在
    const position = new Map(explicitOrder.map((id, index) => [id, index] as const));
    return screens.slice().sort((a, b) => position.get(a.id)! - position.get(b.id)!);
  }
  const rankOf = (item: T) => itemRank?.get(item.storyboardItemId) ?? Number.MAX_SAFE_INTEGER;
  return screens.slice().sort((a, b) =>
    rankOf(a) - rankOf(b)
    || (a.candidateIndex ?? 0) - (b.candidateIndex ?? 0)
    || compareText(a.createdAt, b.createdAt)
    || compareText(a.id, b.id));
}

/** 各屏等比缩放到 targetWidth（lanczos3，在 renderLongImage 内下发）后纵向堆叠；屏间留固定 divider。 */
export function computeLongImageLayout(screens: ReadonlyArray<{ outputId: string; width: number; height: number }>, config: ResolvedLongImageConfig): LongImageLayout {
  if (screens.length === 0) throw new Error("Long image requires at least one screen");
  const laid: LongImageLayout["screens"] = [];
  let cursor = 0;
  screens.forEach((screen, index) => {
    if (screen.width <= 0 || screen.height <= 0) throw new Error(`Screen ${screen.outputId} has invalid dimensions ${screen.width}x${screen.height}`);
    const height = Math.max(1, Math.round((screen.height * config.targetWidth) / screen.width));
    laid.push({ outputId: screen.outputId, yTop: cursor, height });
    cursor += height + (index < screens.length - 1 ? LONG_IMAGE_DIVIDER_HEIGHT : 0);
  });
  if (cursor > MAX_LONG_IMAGE_HEIGHT) throw new Error(`Long image would be ${cursor}px tall (limit ${MAX_LONG_IMAGE_HEIGHT}px); reduce the number of screens`);
  return { targetWidth: config.targetWidth, totalHeight: cursor, screens: laid };
}

/**
 * 屏边界是唯一合法切点：切片永不裁穿单屏内容。从当前位置贪心取不超过 sliceHeight 的
 * 最远边界；取不到说明下一屏本身高于切片上限，显式失败而不是切进内容。
 * 整图不超过 sliceHeight 时返回空——唯一的"切片"会与整图完全相同，没有产出价值。
 */
export function computeLongImageSlices(layout: LongImageLayout, sliceHeight: number): LongImageSlice[] {
  if (layout.totalHeight <= sliceHeight) return [];
  const boundaries = layout.screens.map((screen) => screen.yTop + screen.height);
  const slices: LongImageSlice[] = [];
  let yTop = 0;
  while (yTop < layout.totalHeight) {
    let cut = yTop;
    for (const boundary of boundaries) if (boundary > cut && boundary <= yTop + sliceHeight) cut = boundary;
    if (cut === yTop) {
      const next = boundaries.find((boundary) => boundary > yTop) ?? layout.totalHeight;
      throw new Error(`A screen is ${next - yTop}px tall, exceeding sliceHeight ${sliceHeight}px; increase sliceHeight or export fewer screens per slice`);
    }
    slices.push({ yTop, height: cut - yTop });
    yTop = cut;
  }
  return slices;
}

export async function renderLongImage(params: {
  /** 已按 orderLongImageScreens 排序的输出。 */
  screens: ReadonlyArray<{ outputId: string; absolutePath: string }>;
  config: LongImageExportConfig;
  nameStem: string;
}): Promise<LongImageRender> {
  const config = resolveLongImageConfig(params.config);
  const dimensions = await Promise.all(params.screens.map(async (screen) => {
    const meta = await sharp(screen.absolutePath).metadata();
    if (!meta.width || !meta.height) throw new Error(`Screen ${screen.outputId} has unreadable dimensions`);
    return { outputId: screen.outputId, width: meta.width, height: meta.height };
  }));
  const layout = computeLongImageLayout(dimensions, config);
  const slices = config.sliceHeight ? computeLongImageSlices(layout, config.sliceHeight) : [];
  const encode = (image: Sharp) => image.jpeg({ quality: LONG_IMAGE_ENCODING_QUALITY });
  const dir = await mkdtemp(join(tmpdir(), "ecomgen-long-image-"));
  try {
    // 每屏先缩放成 PNG 中间 buffer 再 composite（print-pack 同款模式）：压缩态中间体把峰值内存
    // 压在画布一份 raw 上；不用 sharp 实例直接作 composite 输入——0.35.x 会把实例选项里的
    // autoOrient 方法误当布尔序列化，直接报参数错误。画布 3 通道 + 纯色背景即 divider 区域。
    const screens = await Promise.all(params.screens.map(async (screen, index) => {
      const resized = await sharp(screen.absolutePath).autoOrient().resize({ width: layout.targetWidth, kernel: "lanczos3" }).png().toBuffer();
      return { input: resized, left: 0, top: layout.screens[index]!.yTop };
    }));
    const canvas = sharp({ create: { width: layout.targetWidth, height: layout.totalHeight, channels: 3, background: LONG_IMAGE_DIVIDER_COLOR } });
    const files: LongImageFile[] = [];
    const longImageName = `${params.nameStem}_长图_${layout.targetWidth}w.jpg`;
    await encode(canvas.composite(screens)).toFile(join(dir, longImageName));
    files.push({ name: longImageName, path: join(dir, longImageName) });
    // 切片从已编码的长图文件逐片 extract：顺序解码、内存有界，代价是每片一次解码。
    for (const [index, slice] of slices.entries()) {
      const name = `${params.nameStem}_切片_${String(index + 1).padStart(2, "0")}.jpg`;
      await encode(sharp(files[0]!.path).extract({ left: 0, top: slice.yTop, width: layout.targetWidth, height: slice.height })).toFile(join(dir, name));
      files.push({ name, path: join(dir, name) });
    }
    return { config, layout, slices, files, cleanup: () => rm(dir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
