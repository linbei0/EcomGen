import type { Layer as PsdLayer } from "ag-psd";

// 这些纯像素函数从 worker 主流程拆出，便于在没有 Redis/数据库副作用的情况下验证 PSD 层序、合成与软边语义。

export function extractAlpha(rgba: Buffer): Buffer {
  const alpha = Buffer.alloc(rgba.length / 4);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[index * 4 + 3]!;
  return alpha;
}

/** 逐像素把选区乘进 alpha（0-255），保留原图透明度；mask 长度必须等于像素数。 */
export function multiplyAlpha(rgba: Buffer, mask: Buffer): Buffer {
  const output = Buffer.from(rgba);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4 + 3;
    output[offset] = Math.round((output[offset]! * mask[index]!) / 255);
  }
  return output;
}

export function invertMask(mask: Buffer): Buffer {
  const output = Buffer.alloc(mask.length);
  for (let index = 0; index < mask.length; index += 1) output[index] = 255 - mask[index]!;
  return output;
}

export function unionOfMasks(masks: Buffer[], width: number, height: number): Buffer {
  const union = Buffer.alloc(width * height, 0);
  for (const mask of masks) for (let index = 0; index < union.length; index += 1) union[index] = Math.max(union[index]!, mask[index]!);
  return union;
}

/** 标准 source-over 叠加，用于生成与真实图层一致的 PSD 合成预览。 */
export function compositeOver(target: Buffer, source: Buffer): void {
  for (let index = 0; index < target.length / 4; index += 1) {
    const offset = index * 4;
    const sourceAlpha = source[offset + 3]! / 255;
    if (sourceAlpha === 0) continue;
    const targetAlpha = target[offset + 3]! / 255;
    const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
    for (let channel = 0; channel < 3; channel += 1) {
      target[offset + channel] = Math.round((source[offset + channel]! * sourceAlpha + target[offset + channel]! * targetAlpha * (1 - sourceAlpha)) / outAlpha);
    }
    target[offset + 3] = Math.round(outAlpha * 255);
  }
}

/** 按 alpha 非空区域裁剪 PSD 图层并保留 left/top 坐标；独立 PNG 仍写全幅，二者尺寸语义各自成立。 */
export function psdLayerFromRgba(rgba: Buffer, width: number, height: number, name: string): PsdLayer | null {
  let left = width; let top = height; let right = 0; let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3]! === 0) continue;
      if (x < left) left = x;
      if (x + 1 > right) right = x + 1;
      if (y < top) top = y;
      if (y + 1 > bottom) bottom = y + 1;
    }
  }
  if (right <= left || bottom <= top) return null;
  const layerWidth = right - left; const layerHeight = bottom - top; const rowBytes = layerWidth * 4;
  const data = new Uint8ClampedArray(layerWidth * layerHeight * 4);
  const view = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  for (let y = 0; y < layerHeight; y += 1) rgba.copy(view, y * rowBytes, ((top + y) * width + left) * 4, ((top + y) * width + left) * 4 + rowBytes);
  return { name, left, top, right, bottom, imageData: { width: layerWidth, height: layerHeight, data } };
}

export interface PsdLayerInput { name: string; rgba: Buffer; }

/**
 * 累积式组装 PSD 图层与合成预览：调用方逐层 append，每层全幅 RGBA 在落盘与 append 后即可释放，
 * 累积器只保留裁剪副本与一份合成预览，避免所有全幅图层同时驻留内存。
 * ag-psd 的 children[0] 是最底层，因此背景必须先于元素 append。
 */
export function createPsdLayerAccumulator(width: number, height: number) {
  const children: PsdLayer[] = [];
  const composite = Buffer.alloc(width * height * 4, 0);
  return {
    children,
    composite,
    /** 按真实图层顺序 source-over 叠加到合成预览，并存下裁剪后的 PSD 图层。 */
    append(input: PsdLayerInput): void {
      compositeOver(composite, input.rgba);
      const layer = psdLayerFromRgba(input.rgba, width, height, input.name);
      if (layer) children.push(layer);
    },
  };
}
