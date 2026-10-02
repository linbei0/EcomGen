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

export async function assertMaskDimensions(source: Buffer, mask: Buffer): Promise<void> { const [sourceMeta, maskMeta] = await Promise.all([sharp(source).metadata(), sharp(mask).metadata()]); if (!sourceMeta.width || !sourceMeta.height || sourceMeta.width !== maskMeta.width || sourceMeta.height !== maskMeta.height) throw new Error("MASK_DIMENSION_MISMATCH"); }

export async function compositeMaskedEdit(source: Buffer, generated: Buffer, editMask: Buffer, protectMask?: Buffer): Promise<Buffer> {
  const sourceMeta = await sharp(source).metadata(); if (!sourceMeta.width || !sourceMeta.height) throw new Error("Source image dimensions are unavailable");
  let mask = sharp(editMask).greyscale().removeAlpha().resize(sourceMeta.width, sourceMeta.height, { fit: "fill" });
  if (protectMask) {
    const [editPixels, protectPixels] = await Promise.all([mask.raw().toBuffer(), sharp(protectMask).greyscale().removeAlpha().resize(sourceMeta.width, sourceMeta.height, { fit: "fill" }).raw().toBuffer()]);
    for (let index = 0; index < editPixels.length; index += 1) editPixels[index] = Math.max(0, editPixels[index]! - protectPixels[index]!);
    mask = sharp(editPixels, { raw: { width: sourceMeta.width, height: sourceMeta.height, channels: 1 } });
  }
  const alphaMask = await mask.png().toBuffer();
  const resized = await sharp(generated).resize(sourceMeta.width, sourceMeta.height, { fit: "fill" }).png().toBuffer();
  const foreground = await sharp(resized).removeAlpha().joinChannel(alphaMask).png().toBuffer();
  return sharp(source).resize(sourceMeta.width, sourceMeta.height, { fit: "fill" }).composite([{ input: foreground }]).png().toBuffer();
}

export async function compositeNaturalBlend(source: Buffer, generated: Buffer, editMask?: Buffer, protectMask?: Buffer): Promise<Buffer> {
  const meta = await sharp(source).metadata(); if (!meta.width || !meta.height) throw new Error("Source image dimensions are unavailable");
  let pixels = editMask
    ? await sharp(editMask).greyscale().removeAlpha().resize(meta.width, meta.height, { fit: "fill" }).raw().toBuffer()
    : Buffer.alloc(meta.width * meta.height, 255);
  if (protectMask) {
    const protect = await sharp(protectMask).greyscale().removeAlpha().resize(meta.width, meta.height, { fit: "fill" }).raw().toBuffer();
    pixels = Buffer.from(pixels);
    for (let index = 0; index < pixels.length; index += 1) pixels[index] = Math.max(0, pixels[index]! - protect[index]!);
  }
  const radius = Math.min(48, Math.max(4, Math.round(Math.min(meta.width, meta.height) * 0.01)));
  const alphaMask = await sharp(pixels, { raw: { width: meta.width, height: meta.height, channels: 1 } }).blur(radius).png().toBuffer();
  const resized = await sharp(generated).resize(meta.width, meta.height, { fit: "fill" }).removeAlpha().joinChannel(alphaMask).png().toBuffer();
  return sharp(source).resize(meta.width, meta.height, { fit: "fill" }).composite([{ input: resized }]).png().toBuffer();
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
