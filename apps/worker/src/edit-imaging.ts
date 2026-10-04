import sharp from "sharp";
import { EDIT_OPERATION_CAPABILITIES } from "@ecomgen/contracts";
import type { EditExecutionMode, EditOperation } from "@ecomgen/contracts";

export function assertEditCapabilities(capabilities: { supportsMaskEdit: boolean; supportsUnmaskedEdit: boolean; supportsMultiReference: boolean; supportsOutpaint: boolean; supportsNaturalBlend: boolean }, operation: EditOperation, executionMode: EditExecutionMode, hasMask: boolean, referenceCount: number): void {
  if ((executionMode === "MASKED" || hasMask) && !capabilities.supportsMaskEdit) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持遮罩编辑");
  if (executionMode === "MODEL_DIRECTED" && !capabilities.supportsUnmaskedEdit) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持无蒙版编辑");
  if (referenceCount > 1 && !capabilities.supportsMultiReference) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持多参考图编辑");
  if (operation === "OUTPAINT" && !capabilities.supportsOutpaint) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持扩展画布");
  if (executionMode !== "MODEL_DIRECTED" && EDIT_OPERATION_CAPABILITIES[operation].requiresNaturalBlend && !capabilities.supportsNaturalBlend) throw new Error("CAPABILITY_UNSUPPORTED: 当前模型不支持自然融合编辑");
}

export async function createOutpaintCanvas(source: Buffer, expansion: { top: number; right: number; bottom: number; left: number }): Promise<{ image: Buffer; mask: Buffer; width: number; height: number; left: number; top: number }> {
  const meta = await sharp(source).metadata(); if (!meta.width || !meta.height) throw new Error("Source image dimensions are unavailable");
  const width = meta.width + expansion.left + expansion.right; const height = meta.height + expansion.top + expansion.bottom;
  const original = await sharp(source).ensureAlpha().png().toBuffer();
  const image = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: original, left: expansion.left, top: expansion.top }]).png().toBuffer();
  const protectedOriginal = await sharp({ create: { width: meta.width, height: meta.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  const mask = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: protectedOriginal, left: expansion.left, top: expansion.top }]).png().toBuffer();
  return { image, mask, width, height, left: expansion.left, top: expansion.top };
}

/** 叠加层必须与底图同尺寸：错位的标注会以"看起来生效了"的方式改错地方。 */
export async function assertSameDimensions(source: Buffer, overlay: Buffer): Promise<void> {
  const [sourceMeta, overlayMeta] = await Promise.all([sharp(source).metadata(), sharp(overlay).metadata()]);
  if (!sourceMeta.width || !sourceMeta.height || sourceMeta.width !== overlayMeta.width || sourceMeta.height !== overlayMeta.height) throw new Error("IMAGE_DIMENSION_MISMATCH");
}

/**
 * 生成图的透明度必须被保留，而不是被选区蒙版顶替。
 *
 * 旧实现用 `removeAlpha().joinChannel(mask)` 把生成图 alpha 换成了选区：生成式改稿若返回透明区域
 * （透明底花型、去底结果），这些像素会被当作不透明 RGB 贴回源图，破坏真实 alpha。这里把选区
 * 当作「合成权重」乘进生成图自身的 alpha，再按 source-over 叠到源图；源图不透明时结果与旧实现一致，
 * 源图透明时也不再把生成图的透明区域烧成不透明。
 */
async function compositeAlphaAware(source: Buffer, generated: Buffer, width: number, height: number, maskPixels: Buffer): Promise<Buffer> {
  const [sourceRgba, generatedRgba] = await Promise.all([
    sharp(source).ensureAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer(),
    sharp(generated).ensureAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer(),
  ]);
  const output = Buffer.alloc(width * height * 4, 0);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const selected = (maskPixels[index] ?? 0) / 255;
    const sourceAlpha = sourceRgba[offset + 3]! / 255;
    const generatedAlpha = (generatedRgba[offset + 3]! / 255) * selected;
    const outAlpha = generatedAlpha + sourceAlpha * (1 - generatedAlpha);
    output[offset + 3] = Math.round(outAlpha * 255);
    if (outAlpha === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      output[offset + channel] = Math.round((generatedRgba[offset + channel]! * generatedAlpha + sourceRgba[offset + channel]! * sourceAlpha * (1 - generatedAlpha)) / outAlpha);
    }
  }
  return sharp(output, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * 解析选区灰度并按 protectMask 扣除保留区；返回与目标尺寸一致的 1 通道像素。
 *
 * blur 大于 0 时做对称模糊：边界外也被影响，这正是自然融合需要的过渡；
 * blur 为 0（硬边界合成）时跳过模糊，选区外逐像素不变。
 */
async function resolvedMaskPixels(editMask: Buffer, protectMask: Buffer | undefined, width: number, height: number, blur = 0): Promise<Buffer> {
  // 单独成函数是为了在需要两份时各起一条流水线：同一个 sharp 实例派生出的两个分支互相干扰。
  const mask = () => sharp(editMask).greyscale().removeAlpha().resize(width, height, { fit: "fill" });
  const pixels = await (blur > 0 ? mask().blur(blur) : mask()).raw().toBuffer();
  if (!protectMask) return pixels;
  const protect = await sharp(protectMask).greyscale().removeAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer();
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = Math.max(0, pixels[index]! - protect[index]!);
  return pixels;
}

export async function compositeMaskedEdit(source: Buffer, generated: Buffer, editMask: Buffer, protectMask?: Buffer): Promise<Buffer> {
  const sourceMeta = await sharp(source).metadata(); if (!sourceMeta.width || !sourceMeta.height) throw new Error("Source image dimensions are unavailable");
  const maskPixels = await resolvedMaskPixels(editMask, protectMask, sourceMeta.width, sourceMeta.height);
  return compositeAlphaAware(source, generated, sourceMeta.width, sourceMeta.height, maskPixels);
}

export async function compositeNaturalBlend(source: Buffer, generated: Buffer, editMask?: Buffer, protectMask?: Buffer): Promise<Buffer> {
  const meta = await sharp(source).metadata(); if (!meta.width || !meta.height) throw new Error("Source image dimensions are unavailable");
  const radius = Math.min(48, Math.max(4, Math.round(Math.min(meta.width, meta.height) * 0.01)));
  // 无选区时默认全图可编辑；仍要在模糊前扣除保留区，使 PIXEL_PROTECTED 区域逐像素不变。
  const base = editMask ?? await sharp({ create: { width: meta.width, height: meta.height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
  const maskPixels = editMask || protectMask
    ? await resolvedMaskPixels(base, protectMask, meta.width, meta.height, editMask ? radius : 0)
    : Buffer.alloc(meta.width * meta.height, 255);
  return compositeAlphaAware(source, generated, meta.width, meta.height, maskPixels);
}

export async function compositeOutpaint(source: Buffer, generated: Buffer, canvas: { width: number; height: number; left: number; top: number }): Promise<Buffer> {
  return sharp(generated).resize(canvas.width, canvas.height, { fit: "fill" }).composite([{ input: await sharp(source).png().toBuffer(), left: canvas.left, top: canvas.top }]).png().toBuffer();
}

export async function providerMaskFor(source: Buffer, editMask: Buffer, protectMask?: Buffer): Promise<Buffer> {
  const meta = await sharp(source).metadata(); if (!meta.width || !meta.height) throw new Error("Source image dimensions are unavailable");
  const edit = await sharp(editMask).greyscale().removeAlpha().resize(meta.width, meta.height, { fit: "fill" }).raw().toBuffer();
  const protect = protectMask ? await sharp(protectMask).greyscale().removeAlpha().resize(meta.width, meta.height, { fit: "fill" }).raw().toBuffer() : undefined;
  const rgba = Buffer.alloc(edit.length * 4);
  for (let index = 0; index < edit.length; index += 1) {
    const editable = Math.max(0, edit[index]! - (protect?.[index] ?? 0));
    const target = index * 4; rgba[target] = 0; rgba[target + 1] = 0; rgba[target + 2] = 0; rgba[target + 3] = 255 - editable;
  }
  return sharp(rgba, { raw: { width: meta.width, height: meta.height, channels: 4 } }).png().toBuffer();
}

/**
 * 用户画在候选图上的笔迹 → 交给模型的改稿源图。
 *
 * 合成而不是把两张图分别下发：模型要改的是"这一张画面上的这一块"，分成两路下发时，笔迹落在
 * 哪个坐标只能靠模型自己对上，位置只能靠猜。叠成一张，位置就是像素本身。
 *
 * 笔迹的不透明度按原样保留：用户画下的浓淡就是他要表达的指示强度，这里不替他加重或减弱。
 * 两侧都显式补 alpha：透明底花型要能承载笔迹，输出也必须把原有的透明原样带出来。
 */
export async function paintOverImage(source: Buffer, annotation: Buffer): Promise<Buffer> {
  await assertSameDimensions(source, annotation);
  // 笔迹在上传时已归一化为 PNG，composite 直接吃原 buffer，不再完整编码一遍。
  return sharp(source).ensureAlpha().composite([{ input: await sharp(annotation).ensureAlpha().toBuffer(), blend: "over" }]).png().toBuffer();
}
