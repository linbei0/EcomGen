import { useEffect, useRef, useState } from "react";
import { App, Modal } from "antd";
import type { ImageAspectRatio } from "@ecomgen/contracts";
import { resolveImageSize } from "@ecomgen/contracts";
import { DrawSurface, type DrawSurfaceHandle } from "./DrawSurface";

/**
 * 草图板：手绘的位置与比例参考图（对标 GPT Image 2.5 的 @Sketch 交互）。
 *
 * 草图以普通参考图身份进入草稿，靠备注表达"约束构图"这层语义；新建时由调用方预填备注。
 * 画布尺寸跟随当前出图比例：草图约束的是位置关系，比例与出图不一致时这个约束本身就失效了。
 * 导出永远是白底笔迹，底图（从已有参考图进入时）只用于对齐——把底图像素一起交出去，
 * 模型会去复制底图的内容，而不是照着标记排布。
 */

/**
 * 笔色给一组高对比度取值：模型需要把手绘标记与画面内容区分开。
 *
 * 取满一圈色相而不是三四个颜色：一张草图里常常要同时标出多个元素（主体、留白、方向、尺寸），
 * 只靠形状与位置容易在密集处糊成一团，颜色是给用户自己看的分隔手段。灰与黑同族，
 * 用来画次要标记，不与主体抢注意力。设成白底画布上不可见的白不值得占一格。
 */
const SKETCH_COLORS = [
  "#111111", // 黑
  "#8c8c8c", // 灰
  "#a8071a", // 深红
  "#f5222d", // 红
  "#fa8c16", // 橙
  "#faad14", // 琥珀
  "#52c41a", // 绿
  "#13c2c2", // 青
  "#1890ff", // 蓝
  "#2f54eb", // 靛
  "#722ed1", // 紫
  "#eb2f96", // 品红
] as const;

function canvasSizeFor(aspectRatio: ImageAspectRatio): { width: number; height: number } {
  const [width, height] = resolveImageSize("1K", aspectRatio, "1024x1024").split("x").map(Number);
  return { width: width ?? 1024, height: height ?? 1024 };
}

export function SketchDialog({ open, aspectRatio, baseImageUrl, busy, onCancel, onSubmit }: {
  open: boolean;
  aspectRatio: ImageAspectRatio;
  /** 非空表示"在这张已有参考图上绘制"；底图只用于对齐。 */
  baseImageUrl: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (blob: Blob) => Promise<void> | void;
}) {
  const { message } = App.useApp();
  const surfaceRef = useRef<DrawSurfaceHandle | null>(null);
  const [hasMarks, setHasMarks] = useState(false);
  // 比例只取数值：这个对象会一路传到 DrawSurface 的 size，尺寸判定按数值而不是身份，内联构造是安全的。
  const size = canvasSizeFor(aspectRatio);

  useEffect(() => { if (open) setHasMarks(false); }, [open, baseImageUrl]);

  const submit = async (): Promise<void> => {
    const blob = await surfaceRef.current?.exportPng();
    if (!blob) {
      message.error("草图上还没有任何笔迹");
      return;
    }
    await onSubmit(blob);
  };

  return (
    <Modal
      open={open}
      title={baseImageUrl ? "在参考图上画草图" : "画一张草图"}
      width={760}
      centered
      // 点遮罩关掉等于丢掉整张草图，绘制类弹窗不该有这个陷阱。
      maskClosable={false}
      okText="作为参考图加入"
      cancelText="取消"
      confirmLoading={busy}
      okButtonProps={{ disabled: !hasMarks }}
      onCancel={onCancel}
      onOk={() => void submit()}
      destroyOnHidden
    >
      <DrawSurface
        ref={surfaceRef}
        size={size}
        imageUrl={baseImageUrl}
        background="#ffffff"
        brushColors={SKETCH_COLORS}
        tools={["brush", "rect", "ellipse", "arrow", "erase"]}
        stageHeight="min(58vh, 540px)"
        onDirtyChange={setHasMarks}
      />
    </Modal>
  );
}
