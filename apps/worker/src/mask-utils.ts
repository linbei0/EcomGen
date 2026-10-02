import sharp from "sharp";

/**
 * SAM 返回的 mask 可能是编码图片（fal PNG）或裸 8-bit 灰度（Gitee RLE 解码，自带尺寸）：
 * 统一缩放到原图尺寸的灰度选区（亮度=前景）。花型提取与图层导出两条分割链路共用。
 */
export async function normalizeMask(mask: { data: Buffer; mimeType: string; width: number | null; height: number | null }, width: number, height: number): Promise<Buffer> {
  const rawWidth = mask.width ?? width;
  const rawHeight = mask.height ?? height;
  const image = mask.mimeType === "raw/gray8" ? sharp(mask.data, { raw: { width: rawWidth, height: rawHeight, channels: 1 } }) : sharp(mask.data);
  return image.greyscale().removeAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer();
}
export function maskHasForeground(mask: Buffer): boolean { return mask.some((value) => value > 8); }

// joinChannel 对 Buffer 输入在部分平台触发 libpng 读错误；直接改写 raw RGBA 的 alpha 字节更稳。
export async function decodeRgba(image: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(image).ensureAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer();
}
export async function pngFromRgba(rgba: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
