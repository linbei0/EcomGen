import { App, Button, Modal, Segmented, Slider, Space, Tooltip } from "antd";
import { Eraser, Paintbrush, Redo2, Square, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 选区蒙版编辑器：画笔 / 矩形 / 擦除、反选、撤销重做与笔径控制。
 *
 * 蒙版以不透明灰度导出（黑=未选，白=选中）：服务端用 greyscale().removeAlpha() 读取选区，
 * 若用透明画布，去 alpha 会把白色边缘重新读成"全选"。因此画布先铺满黑底，再以白色绘制、
 * 以黑色擦除，软边自然变成灰阶。选区坐标始终相对原图像素，缩放只改变显示，不改变导出数据。
 */

type Tool = "brush" | "rect" | "erase";

export function MaskEditorDialog({ open, imageUrl, onCancel, onSubmit }: {
  open: boolean;
  imageUrl: string | null;
  onCancel: () => void;
  onSubmit: (blob: Blob) => Promise<void> | void;
}) {
  const { message } = App.useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(48);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const historyRef = useRef<ImageData[]>([]);
  const redoRef = useRef<ImageData[]>([]);
  const drawingRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number; snapshot: ImageData | null } | null>(null);
  const [historyDepth, setHistoryDepth] = useState(0);

  const pushHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    historyRef.current = [...historyRef.current.slice(-19), context.getImageData(0, 0, canvas.width, canvas.height)];
    redoRef.current = [];
    setHistoryDepth(historyRef.current.length);
  }, []);

  const resetCanvas = useCallback(async (url: string) => {
    const response = await fetch(url);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    setDimensions({ width: bitmap.width, height: bitmap.height });
    historyRef.current = [];
    redoRef.current = [];
    setHistoryDepth(0);
    bitmap.close();
  }, []);

  useEffect(() => {
    if (!open || !imageUrl) return;
    void resetCanvas(imageUrl).catch(() => message.error("候选图加载失败，无法编辑选区"));
  }, [open, imageUrl, resetCanvas, message]);

  const pointFor = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    return { x: Math.max(0, Math.min(canvas.width, x)), y: Math.max(0, Math.min(canvas.height, y)) };
  };

  const paint = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.globalCompositeOperation = "source-over";
    context.strokeStyle = tool === "erase" ? "#000" : "#fff";
    context.fillStyle = tool === "erase" ? "#000" : "#fff";
    context.lineWidth = brushSize;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.beginPath();
    context.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
    context.fill();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.setPointerCapture(event.pointerId);
    const point = pointFor(event);
    pushHistory();
    if (tool === "rect") {
      drawingRef.current = { startX: point.x, startY: point.y, lastX: point.x, lastY: point.y, snapshot: context.getImageData(0, 0, canvas.width, canvas.height) };
      return;
    }
    drawingRef.current = { startX: point.x, startY: point.y, lastX: point.x, lastY: point.y, snapshot: null };
    paint(point, point);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drawing = drawingRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!drawing || !canvas || !context) return;
    const point = pointFor(event);
    if (tool === "rect" && drawing.snapshot) {
      context.putImageData(drawing.snapshot, 0, 0);
      context.globalCompositeOperation = "source-over";
      context.fillStyle = "#fff";
      context.fillRect(Math.min(drawing.startX, point.x), Math.min(drawing.startY, point.y), Math.abs(point.x - drawing.startX), Math.abs(point.y - drawing.startY));
    } else {
      paint({ x: drawing.lastX, y: drawing.lastY }, point);
    }
    drawing.lastX = point.x;
    drawing.lastY = point.y;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    canvasRef.current?.releasePointerCapture(event.pointerId);
    drawingRef.current = null;
  };

  const invert = (): void => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    pushHistory();
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const value = 255 - image.data[index]!;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  };

  const restore = (from: React.RefObject<ImageData[]>, to: React.RefObject<ImageData[]>): void => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !from.current.length) return;
    const image = from.current[from.current.length - 1]!;
    to.current = [...to.current.slice(-19), context.getImageData(0, 0, canvas.width, canvas.height)];
    from.current = from.current.slice(0, -1);
    context.putImageData(image, 0, 0);
    setHistoryDepth(historyRef.current.length);
  };

  const submit = async (): Promise<void> => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), "image/png"));
    if (!blob) {
      message.error("选区导出失败");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(blob);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} title="圈选局部修改区域" width={880} onCancel={onCancel} okText="提交选区" cancelText="取消" confirmLoading={submitting} onOk={() => void submit()}>
      <Space direction="vertical" style={{ width: "100%" }} size="small">
        <Space wrap>
          <Segmented
            value={tool}
            onChange={(value) => setTool(value as Tool)}
            options={[
              { value: "brush", label: <Tooltip title="画笔"><span><Paintbrush size={14} /> 画笔</span></Tooltip> },
              { value: "rect", label: <Tooltip title="矩形"><span><Square size={14} /> 矩形</span></Tooltip> },
              { value: "erase", label: <Tooltip title="擦除"><span><Eraser size={14} /> 擦除</span></Tooltip> },
            ]}
          />
          <span style={{ fontSize: 12 }}>笔径</span>
          <Slider style={{ width: 140 }} min={4} max={200} value={brushSize} onChange={setBrushSize} />
          <Button size="small" icon={<Undo2 size={14} />} disabled={!historyDepth} onClick={() => restore(historyRef, redoRef)}>撤销</Button>
          <Button size="small" icon={<Redo2 size={14} />} disabled={!redoRef.current.length} onClick={() => restore(redoRef, historyRef)}>重做</Button>
          <Button size="small" onClick={invert}>反选</Button>
          <Button size="small" icon={<Trash2 size={14} />} onClick={() => { pushHistory(); const canvas = canvasRef.current; const context = canvas?.getContext("2d"); if (canvas && context) { context.globalCompositeOperation = "source-over"; context.fillStyle = "#000"; context.fillRect(0, 0, canvas.width, canvas.height); } }}>清除选区</Button>
        </Space>
        <div ref={frameRef} style={{ position: "relative", maxHeight: "62vh", overflow: "auto", background: "#111", borderRadius: 8, padding: 8 }}>
          {imageUrl ? <img src={imageUrl} alt="待编辑候选" style={{ position: "absolute", inset: 8, width: "calc(100% - 16px)", height: "calc(100% - 16px)", objectFit: "contain", pointerEvents: "none", userSelect: "none" }} /> : null}
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{ position: "relative", display: "block", margin: "0 auto", maxWidth: "100%", maxHeight: "60vh", opacity: 0.55, cursor: "crosshair", touchAction: "none" }}
          />
        </div>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{dimensions ? `选区将按原图 ${dimensions.width}×${dimensions.height} 像素提交；选区外像素在合成时保持不变。` : "正在加载候选图…"}</span>
      </Space>
    </Modal>
  );
}
