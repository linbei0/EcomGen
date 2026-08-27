import { MAX_GENERATION_REFERENCE_IMAGES, MAX_PRODUCT_IMAGE_ASSETS, MAX_REFERENCE_IMAGE_ASSETS } from "@ecomgen/contracts";

export interface VisualAssetRecord {
  id: string;
  role: string;
  mimeType: string;
  createdAt: string;
  name?: string;
}

export interface GenerationAssetSelection {
  mode: string;
  referencedAssets: string[];
}

/** 规划和文案共用的稳定视觉输入：商品真值优先，其次是参考素材。 */
export function selectVisionAssets<T extends VisualAssetRecord>(assets: T[]): T[] {
  const images = assets
    .filter((asset) => asset.mimeType.startsWith("image/"))
    .slice()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  return [
    ...images.filter((asset) => asset.role === "PRODUCT_TRUTH").slice(0, MAX_PRODUCT_IMAGE_ASSETS),
    ...images.filter((asset) => asset.role !== "PRODUCT_TRUTH").slice(0, MAX_REFERENCE_IMAGE_ASSETS),
  ];
}

/** 生图只使用分镜引用的素材；像素保护模式额外携带全部商品真值图。 */
export function selectGenerationAssets<T extends VisualAssetRecord>(assets: T[], selection: GenerationAssetSelection): T[] {
  const images = assets.filter((asset) => asset.mimeType.startsWith("image/"));
  const byId = new Map(images.map((asset) => [asset.id, asset]));
  const selected: T[] = [];
  const seen = new Set<string>();
  for (const id of selection.referencedAssets) {
    const asset = byId.get(id);
    if (asset && !seen.has(asset.id)) {
      seen.add(asset.id);
      selected.push(asset);
    }
  }
  const products = selected.filter((asset) => asset.role === "PRODUCT_TRUTH");
  const references = selected.filter((asset) => asset.role !== "PRODUCT_TRUTH").slice(0, MAX_GENERATION_REFERENCE_IMAGES);
  if (selection.mode === "PIXEL_PROTECTED") {
    const allProducts = images.filter((asset) => asset.role === "PRODUCT_TRUTH").slice(0, MAX_PRODUCT_IMAGE_ASSETS);
    return [...allProducts, ...references];
  }
  return [...products, ...references];
}

/** 像素保护必须有真实商品图作为图像模型输入，参考图不能替代商品真值。 */
export function assertPixelProtectedInputs<T extends VisualAssetRecord>(assets: T[]): void {
  if (!assets.some((asset) => asset.role === "PRODUCT_TRUTH")) {
    throw new Error("PIXEL_PROTECTED generation requires at least one PRODUCT_TRUTH image input");
  }
}

/** 按 Provider 实际收到的顺序声明每张图的角色，避免参考素材被误认作商品。 */
export function withGenerationAssetRoles<T extends VisualAssetRecord>(prompt: string, assets: T[]): string {
  const finalPrompt = prompt.trim();
  if (assets.length === 0) return finalPrompt;
  const roles = assets.map((asset, index) => `- Image ${index + 1}: ${generationRoleInstruction(asset.role)}`);
  return [
    "Input image roles (follow strictly):",
    ...roles,
    "Never use a non-product reference as the product or merge it into the product identity.",
    "",
    finalPrompt,
  ].join("\n");
}

export function visionAttachmentMetadata<T extends VisualAssetRecord>(assets: T[]): Array<{ attachmentIndex: number; assetId: string; role: string; name: string; mimeType: string }> {
  return assets.map((asset, index) => ({ attachmentIndex: index + 1, assetId: asset.id, role: asset.role, name: asset.name ?? asset.id, mimeType: asset.mimeType }));
}

function generationRoleInstruction(role: string): string {
  if (role === "PRODUCT_TRUTH") return "PRODUCT TRUTH. This is the actual product; preserve its visible shape, proportions, colors, materials, labels, logos, and details.";
  if (role === "PACKAGING") return "PACKAGING REFERENCE ONLY. Use only visible packaging and label details when requested; do not replace the product.";
  if (role === "LAYOUT_REFERENCE") return "LAYOUT REFERENCE ONLY. Use only composition, hierarchy, and placement; do not copy its product, branding, or text.";
  return "STYLE REFERENCE ONLY. Use only palette, lighting, composition, texture, and atmosphere; do not copy its product, branding, or text.";
}
