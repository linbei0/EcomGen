import sharp from "sharp";

/** Seedream 一次调用拆分全部元素：手动框选换算为 0-1000 归一化 bbox 标签，识别与提示词元素用语义名称。 */
export function seedreamLayerizePrompt(elements: Array<{ id: string; name: string; source: "auto" | "manual" | "prompt"; bbox: { x: number; y: number; width: number; height: number } | null }>): string {
  return elements.map((element) => {
    if (element.source !== "manual" || !element.bbox) return element.name;
    const x1 = Math.round(element.bbox.x * 1000);
    const y1 = Math.round(element.bbox.y * 1000);
    const x2 = Math.round((element.bbox.x + element.bbox.width) * 1000);
    const y2 = Math.round((element.bbox.y + element.bbox.height) * 1000);
    return `${element.name}<bbox>${x1} ${y1} ${x2} ${y2}</bbox>`;
  }).join("、");
}

/** Seedream 图层 alpha 只作选区回贴：图层与原图同尺寸直接取 alpha，局部图按 bbox 贴回全幅画布。 */
export async function seedreamLayerMask(layerPng: Buffer, bbox: { x: number; y: number; width: number; height: number } | null, width: number, height: number): Promise<Buffer> {
  const meta = await sharp(layerPng).metadata();
  if (!meta.width || !meta.height) throw new Error("Seedream layer image dimensions are unavailable");
  if (meta.width === width && meta.height === height) return sharp(layerPng).ensureAlpha().extractChannel(3).raw().toBuffer();
  const box = bbox ?? { x: 0, y: 0, width: 1, height: 1 };
  const bx = Math.max(0, Math.min(width - 1, Math.round(box.x * width)));
  const by = Math.max(0, Math.min(height - 1, Math.round(box.y * height)));
  const bw = Math.max(1, Math.min(width - bx, Math.round(box.width * width)));
  const bh = Math.max(1, Math.min(height - by, Math.round(box.height * height)));
  const region = await sharp(layerPng).ensureAlpha().extractChannel(3).resize(bw, bh, { fit: "fill" }).raw().toBuffer();
  const canvas = Buffer.alloc(width * height, 0);
  for (let row = 0; row < bh; row += 1) region.copy(canvas, (by + row) * width + bx, row * bw, (row + 1) * bw);
  return canvas;
}

/** 图层与请求元素对齐：manual 按归一化 bbox 重叠（IoU），其余按名称互含；未匹配时保留模型标签。 */
export function seedreamMatches(elements: Array<{ id: string; name: string; source: "auto" | "manual" | "prompt"; bbox: { x: number; y: number; width: number; height: number } | null }>, layer: { name: string | null; bbox: { x: number; y: number; width: number; height: number } | null }) {
  for (const element of elements) {
    if (element.source === "manual" && element.bbox && layer.bbox && normalizedIou(element.bbox, layer.bbox) >= 0.4) return element;
  }
  if (layer.name) {
    for (const element of elements) {
      if (element.source === "auto" && (layer.name.includes(element.name) || element.name.includes(layer.name))) return element;
    }
  }
  return null;
}

function normalizedIou(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const x1 = Math.max(a.x, b.x); const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width); const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}
