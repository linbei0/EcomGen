import { Type, type Static } from "@sinclair/typebox";
import { stringEnumSchema } from "./enums.js";

/**
 * 满印（TILE）版式下的平铺排列（repeat layout）。
 *
 * 排列是确定性的摆放几何：先按单元几何把基础花型拼成「重复单元」，再像直排一样把单元铺满画布。
 * 全部本地合成，不经生成式模型（ADR-0001）。接缝语义分两档：
 * - 直排 / 半落 / 三落 / 错砖：重复单元的缝就是源图的缝，验缝结果直接沿用；
 * - 镜像：单元每条接缝两侧像素恒等（一枚花型与它的镜像共享同一条边），对任意图片构造性无缝，
 *   因此豁免验缝闸门——这也是四向（而非单轴）镜像的原因：单轴只保证一个方向。
 *
 * 与衍生构图预设（PATTERN_VARIANT_PRESET_IDS 的 REARRANGE_HALF_DROP 等）是两个层：
 * 那边改花型本身（生成式重排），这边只改摆放（确定性合成）。
 */
export const POD_REPEAT_LAYOUTS = ["STRAIGHT", "HALF_DROP", "ONE_THIRD_DROP", "HALF_BRICK", "MIRROR"] as const;
export const PodRepeatLayout = stringEnumSchema(POD_REPEAT_LAYOUTS, "#/components/schemas/PodRepeatLayout");
export type PodRepeatLayout = Static<typeof PodRepeatLayout>;

/** 平铺排列的中文名：工作区 chips、流水线表单与收据共用这一份，避免各端各写文案。 */
export const POD_REPEAT_LAYOUT_LABELS: Record<PodRepeatLayout, string> = {
  STRAIGHT: "直排",
  HALF_DROP: "半落",
  ONE_THIRD_DROP: "三落",
  HALF_BRICK: "错砖",
  MIRROR: "镜像",
};

/** 重复单元内一枚基础花型的摆放：dx/dy 以花型位为单位（可为分数），flip 决定该位是否镜像翻转。 */
export interface RepeatUnitPlacement {
  dx: number;
  dy: number;
  flipX: boolean;
  flipY: boolean;
}

/**
 * 每种排列的重复单元几何——worker 合成与前端 SVG 预览共用的唯一真相源。
 *
 * columns/rows 是单元的宽高（花型位数）；placements 给出单元内每枚花型的左上角位置。
 * 越界的摆放（如半落第二列 dy=0.5，会伸出单元下缘）由渲染方环绕补画：这正是"单元无缝"的
 * 构造方式，也是镜像无需验缝的原因——环绕补画后每条接缝两侧都是同一枚花型的同一条边。
 */
export const REPEAT_UNIT_PLACEMENTS: Record<PodRepeatLayout, { columns: number; rows: number; placements: readonly RepeatUnitPlacement[] }> = {
  STRAIGHT: {
    columns: 1,
    rows: 1,
    placements: [{ dx: 0, dy: 0, flipX: false, flipY: false }],
  },
  HALF_DROP: {
    columns: 2,
    rows: 1,
    placements: [
      { dx: 0, dy: 0, flipX: false, flipY: false },
      { dx: 1, dy: 0.5, flipX: false, flipY: false },
    ],
  },
  ONE_THIRD_DROP: {
    columns: 3,
    rows: 1,
    placements: [
      { dx: 0, dy: 0, flipX: false, flipY: false },
      { dx: 1, dy: 1 / 3, flipX: false, flipY: false },
      { dx: 2, dy: 2 / 3, flipX: false, flipY: false },
    ],
  },
  HALF_BRICK: {
    columns: 1,
    rows: 2,
    placements: [
      { dx: 0, dy: 0, flipX: false, flipY: false },
      { dx: 0.5, dy: 1, flipX: false, flipY: false },
    ],
  },
  MIRROR: {
    columns: 2,
    rows: 2,
    placements: [
      { dx: 0, dy: 0, flipX: false, flipY: false },
      { dx: 1, dy: 0, flipX: true, flipY: false },
      { dx: 0, dy: 1, flipX: false, flipY: true },
      { dx: 1, dy: 1, flipX: true, flipY: true },
    ],
  },
};
