import { IMAGE_RESOLUTIONS, type ImageAspectRatio, type ImageResolution } from "./enums.js";

export type ImageQualityTier = "auto" | "low" | "medium" | "high";
export type ImageOutputFormatValue = "png" | "jpeg" | "webp";

/**
 * 缺省值刻意与历史硬编码一致（quality=high、不指定格式）：新增参数不配置时，
 * 请求形状与存量行为逐字节相同，已有模型与产物不受影响。
 */
export const DEFAULT_IMAGE_QUALITY: ImageQualityTier = "high";
export const DEFAULT_IMAGE_OUTPUT_FORMAT: ImageOutputFormatValue = "png";

/**
 * OpenAI Images 协议下「分辨率 / 质量 / 格式」按模型分流的单一真相源。
 *
 * 三类上游语义不同：gpt-image 没有更高分辨率档（size 只有 1024 家族），但支持 quality 与
 * output_format；Seedream（火山方舟）相反——`size` 直接接受 1K/2K/4K 关键词或精确像素
 * （4.0 不认识 quality/output_format，4.5/5.x 认识 output_format）；Gemini 走自己的
 * imageConfig，由 gemini 适配器消化。模型判定沿用 input_fidelity 的前缀启发先例：
 * 未知模型一律走最保守路径，不认识的一律不下发，请求形状与旧行为等价。
 *
 * Seedream 推荐尺寸表与像素约束来自火山方舟《图片生成 API》文档（多镜像核对，2026-10）：
 * 显式像素的总像素区间 4.0 为 [1280x720, 4096x4096]、4.5/5.0-lite 下限抬到 2560x1440、
 * 5.0-pro 上限约 4624220；比例允许 [1/16, 16]。官方未给 4:5/5:4 推荐值，按档位像素
 * 预算现算并夹紧进区间。
 */

export type SeedreamAspect = Exclude<ImageAspectRatio, "AUTO">;

interface SeedreamProfile {
  /** 显式像素的总像素允许区间（官方约束）；越界请求会被上游拒绝。 */
  minTotalPixels: number;
  maxTotalPixels: number;
  /** 支持的关键词档位；AUTO 比例直接透传该档位关键词。 */
  tiers: readonly ImageResolution[];
  supportsOutputFormat: boolean;
  /** 官方推荐尺寸表：档位 × 比例 → 精确像素。缺项比例走 seedreamCustomSize 现算。 */
  recommended: Record<ImageResolution, Partial<Record<SeedreamAspect, string>>>;
}

const SEEDREAM_40_RECOMMENDED: Record<ImageResolution, Partial<Record<SeedreamAspect, string>>> = {
  "1K": { "1:1": "1024x1024", "4:3": "1152x864", "3:4": "864x1152", "3:2": "1248x832", "2:3": "832x1248", "16:9": "1280x720", "9:16": "720x1280", "21:9": "1512x648" },
  "2K": { "1:1": "2048x2048", "4:3": "2304x1728", "3:4": "1728x2304", "3:2": "2496x1664", "2:3": "1664x2496", "16:9": "2848x1600", "9:16": "1600x2848", "21:9": "3136x1344" },
  "4K": { "1:1": "4096x4096", "4:3": "4704x3520", "3:4": "3520x4704", "3:2": "4992x3328", "2:3": "3328x4992", "16:9": "5504x3040", "9:16": "3040x5504", "21:9": "6240x2656" },
};

// 4.5 官方推荐列表的 16:9 / 21:9 与 4.0 不同（2560x1440 / 3024x1296）；4K 行沿用 4.0 表
//（同上限 4096x4096，官方未为 4.5 单列 4K 推荐值，全部落在其像素区间内）。
const SEEDREAM_45_RECOMMENDED: Record<ImageResolution, Partial<Record<SeedreamAspect, string>>> = {
  ...SEEDREAM_40_RECOMMENDED,
  "2K": { ...SEEDREAM_40_RECOMMENDED["2K"], "16:9": "2560x1440", "9:16": "1440x2560", "21:9": "3024x1296" },
};

const SEEDREAM_PROFILES: Array<{ pattern: RegExp; profile: SeedreamProfile }> = [
  {
    // 覆盖 doubao-seedream-5-0-pro、dola-seedream-5-0-pro 等；须先于 lite 家族判定。
    pattern: /seedream[-_.]?5[-_.]?0[-_.]?pro/i,
    profile: {
      minTotalPixels: 921_600,
      maxTotalPixels: 4_624_220,
      tiers: ["1K", "2K"],
      supportsOutputFormat: true,
      recommended: { "1K": SEEDREAM_40_RECOMMENDED["1K"], "2K": SEEDREAM_40_RECOMMENDED["2K"], "4K": {} },
    },
  },
  {
    // doubao-seedream-4.5、doubao-seedream-5-0(-lite)：无 1K 档，显式像素下限 2560x1440。
    pattern: /seedream[-_.]?(4[-_.]?5|5[-_.]?0(?!\d))/i,
    profile: {
      minTotalPixels: 3_686_400,
      maxTotalPixels: 16_777_216,
      tiers: ["2K", "4K"],
      supportsOutputFormat: true,
      recommended: SEEDREAM_45_RECOMMENDED,
    },
  },
  {
    // doubao-seedream-4-0-250828、seedream-4.0 等。
    pattern: /seedream[-_.]?4[-_.]?0(?!\d)/i,
    profile: {
      minTotalPixels: 921_600,
      maxTotalPixels: 16_777_216,
      tiers: ["1K", "2K", "4K"],
      supportsOutputFormat: false,
      recommended: SEEDREAM_40_RECOMMENDED,
    },
  },
];

const SEEDREAM_TIER_PIXELS: Record<ImageResolution, number> = { "1K": 1024 * 1024, "2K": 2048 * 2048, "4K": 4096 * 4096 };
/** 推荐表与现算值都以 16px 对齐：与官方推荐值的步长一致，也让现算结果稳定可复现。 */
const SEEDREAM_PIXEL_STEP = 16;

/** 识别 Seedream 家族模型；命中即按其档案分流 size / watermark / output_format 行为。 */
export function seedreamProfileFor(modelId: string): SeedreamProfile | null {
  const id = modelId.trim();
  if (!id) return null;
  return SEEDREAM_PROFILES.find((entry) => entry.pattern.test(id))?.profile ?? null;
}

export function isSeedreamImageModel(modelId: string): boolean {
  return seedreamProfileFor(modelId) !== null;
}

const GPT_IMAGE_FAMILY = /^gpt-image/i;

/** gpt-image 的代数；无版本号的命名（如裸 "gpt-image"）按 1 代保守处理。 */
function gptImageMajorVersion(modelId: string): number {
  const match = /^gpt-image-(\d+)/i.exec(modelId.trim());
  return match ? Number(match[1]) : 0;
}

/**
 * gpt-image-2 / 2.5 支持任意宽高的 size 字符串（OpenAI API Reference 原文）：
 * 宽高都必须被 16 整除，宽高比限 1:3..3:1，「超过 2560x1440 为实验性，最大支持分辨率 3840x2160」。
 * 各档位锚点（兼夹紧上限）由此取值：2K 对齐稳定边界 2560x1440，整档不越过实验性边界；
 * 4K 对齐官方上限 3840x2160；单边一律 ≤ 3840。预算不取 4096²。
 */
const GPT_IMAGE_TIER_PIXELS: Record<ImageResolution, number> = { "1K": 1024 * 1024, "2K": 2560 * 1440, "4K": 3840 * 2160 };
const GPT_IMAGE_MAX_SIDE_PIXELS = 3840;

/** 该模型的 size 字段接受档位化的显式像素（Seedream 全家 / gpt-image-2+）。 */
export function supportsArbitraryImageSize(modelId: string): boolean {
  return gptImageMajorVersion(modelId) >= 2 || isSeedreamImageModel(modelId);
}

/** GPT Image 系模型（gpt-image-1/1.5/2/2.5 及变体）。 */
export function isGptImageModel(modelId: string): boolean {
  return GPT_IMAGE_FAMILY.test(modelId.trim());
}

/** quality 档位只有 GPT image 模型认识（2.5 系还支持 xhigh/max）；Seedream/Gemini 及未知模型不下发。 */
export function supportsOpenAiImageQuality(modelId: string): boolean {
  return isGptImageModel(modelId);
}

export function supportsOpenAiImageOutputFormat(modelId: string): boolean {
  if (GPT_IMAGE_FAMILY.test(modelId.trim())) return true;
  return seedreamProfileFor(modelId)?.supportsOutputFormat ?? false;
}

/** 请求档位超出模型支持范围时收敛到最接近的受支持档位，而不是硬发一个会被拒绝的值。 */
function clampSeedreamTier(profile: SeedreamProfile, resolution: ImageResolution): ImageResolution {
  if (profile.tiers.includes(resolution)) return resolution;
  // 档位元组按 1K→4K 升序维护：低于下限取最低档（模型没有更小的画布），高于上限取最高档。
  return resolution === "1K" ? profile.tiers[0]! : profile.tiers[profile.tiers.length - 1]!;
}

function roundToStep(value: number): number {
  return Math.round(value / SEEDREAM_PIXEL_STEP) * SEEDREAM_PIXEL_STEP;
}

interface SizeBudget {
  minTotalPixels: number;
  maxTotalPixels: number;
  /** 单边像素上限；缺省不限制（Seedream 官方 4K 21:9 达 6240 宽，不能按单边夹）。 */
  maxSidePixels?: number;
}

function shrinkToStep(value: number): number {
  return Math.floor(value / SEEDREAM_PIXEL_STEP) * SEEDREAM_PIXEL_STEP;
}

/** 按比例与目标总像素现算尺寸：边长对齐 16px，迭代夹紧进总像素与单边预算。 */
function computedSize(ratioWidth: number, ratioHeight: number, targetTotalPixels: number, budget: SizeBudget): string {
  // 单边上限折算成总像素上限：取长短边中先到顶的那个（横版宽先到顶、竖版高先到顶）。
  const sideCapTotal = budget.maxSidePixels
    ? budget.maxSidePixels * budget.maxSidePixels * Math.min(ratioWidth / ratioHeight, ratioHeight / ratioWidth)
    : Number.POSITIVE_INFINITY;
  const maxTotal = Math.min(budget.maxTotalPixels, sideCapTotal);
  const minTotal = Math.min(budget.minTotalPixels, maxTotal);
  let height = roundToStep(Math.sqrt((targetTotalPixels * ratioHeight) / ratioWidth));
  let width = roundToStep((height * ratioWidth) / ratioHeight);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const total = width * height;
    if (total >= minTotal && total <= maxTotal) break;
    const factor = Math.sqrt(total > maxTotal ? maxTotal / total : minTotal / total);
    // 超上限向下取整、欠上限向上取整：舍入方向与修正方向一致，保证迭代单调收敛而不是在 16px 网格上打转。
    height = Math.max(SEEDREAM_PIXEL_STEP, total > maxTotal ? shrinkToStep(height * factor) : Math.ceil(height * factor / SEEDREAM_PIXEL_STEP) * SEEDREAM_PIXEL_STEP);
    width = Math.max(SEEDREAM_PIXEL_STEP, roundToStep((height * ratioWidth) / ratioHeight));
  }
  return `${width}x${height}`;
}

/** 官方推荐表缺项的比例（4:5 / 5:4）：按档位像素预算现算，对齐步长并夹紧进总像素区间。 */
function seedreamCustomSize(profile: SeedreamProfile, tier: ImageResolution, aspect: SeedreamAspect): string {
  const [ratioWidth, ratioHeight] = aspect.split(":").map(Number);
  return computedSize(ratioWidth, ratioHeight, SEEDREAM_TIER_PIXELS[tier], profile);
}

/**
 * 项目级允许值映射到当前 OpenAI-compatible Images 尺寸（gpt-image 及未知模型的缺省行为）。
 * 2K/4K 仍走 1024 家族，避免按模型名猜测更大尺寸；
 * 细分比例按方向折叠到 OpenAI 支持的三档尺寸，Gemini 则原生透传比例。
 */
export function resolveImageSize(
  resolution: ImageResolution,
  aspectRatio: ImageAspectRatio,
  templateDefault: string
): string {
  void resolution;
  if (aspectRatio === "AUTO") return templateDefault;
  if (aspectRatio === "1:1") return "1024x1024";
  const [width, height] = aspectRatio.split(":").map(Number);
  return width > height ? "1536x1024" : "1024x1536";
}

/**
 * OpenAI Images 协议的最终 `size` 值。Seedream 按官方推荐表给「档位 × 比例」的精确像素
 * （AUTO 退回档位关键词，画布交给模型）；gpt-image-2+ 支持任意宽高，1K 保持既有 1024 家族
 * 折叠值（旧行为逐字节一致），2K/4K 把同一比例等比放大并夹紧上限；其余模型没有分辨率语义，
 * 维持 1024 家族折叠（见 resolveImageSize）。
 */
export function resolveOpenAiImageSize(
  modelId: string,
  resolution: ImageResolution,
  aspectRatio: ImageAspectRatio,
  templateDefault: string
): string {
  const profile = seedreamProfileFor(modelId);
  if (profile) {
    const tier = clampSeedreamTier(profile, resolution);
    if (aspectRatio === "AUTO") return tier;
    return profile.recommended[tier]?.[aspectRatio] ?? seedreamCustomSize(profile, tier, aspectRatio);
  }
  const baseSize = resolveImageSize("1K", aspectRatio, templateDefault);
  if (!supportsArbitraryImageSize(modelId) || resolution === "1K") return baseSize;
  const tierPixels = GPT_IMAGE_TIER_PIXELS[resolution];
  // 夹紧上限取档位锚点而非模型总上限：2K 档结果整体不越过官方实验性边界，4K 锚点即官方上限。
  const tierBudget: SizeBudget = { minTotalPixels: 0, maxTotalPixels: tierPixels, maxSidePixels: GPT_IMAGE_MAX_SIDE_PIXELS };
  // 显式比例按真实比例放大：16:9 在 2K/4K 正好命中官方锚点 2560x1440 / 3840x2160，
  // 而从 1K 的折叠值（16:9 被折叠成 3:2 的 1536x1024）放大会把错误形状带进高档位。
  if (aspectRatio !== "AUTO") {
    const [ratioWidth, ratioHeight] = aspectRatio.split(":").map(Number);
    return computedSize(ratioWidth, ratioHeight, tierPixels, tierBudget);
  }
  // AUTO 没有显式比例可依，沿用模板缺省尺寸的形状放大。
  const [width, height] = baseSize.split("x").map(Number);
  if (!width || !height) return baseSize;
  return computedSize(width, height, tierPixels, tierBudget);
}

export interface OpenAiImageParamSupport {
  /** 该模型真实可分的分辨率档位；只有一个元素表示没有可调空间，UI 可隐藏选择器。 */
  resolutionTiers: readonly ImageResolution[];
  quality: boolean;
  outputFormat: boolean;
}

/** imageSize 只有 Gemini 3 生图模型真正消费（见 providers 的 gemini 适配器）。 */
const GEMINI_3_IMAGE_MODEL = /^gemini-3(?:\.\d+)?/i;

/** 前端按它渲染分辨率/质量/格式选择器：没有可调空间的维度直接不出现，不做假开关。 */
export function imageParamSupportFor(modelId: string, imageApiKind: "openai_images" | "gemini" | "custom" | null): OpenAiImageParamSupport {
  if (imageApiKind === "gemini") {
    return { resolutionTiers: GEMINI_3_IMAGE_MODEL.test(modelId.trim()) ? IMAGE_RESOLUTIONS : ["1K"], quality: false, outputFormat: false };
  }
  if (imageApiKind !== "openai_images") return { resolutionTiers: ["1K"], quality: false, outputFormat: false };
  const profile = seedreamProfileFor(modelId);
  if (profile) return { resolutionTiers: profile.tiers, quality: false, outputFormat: profile.supportsOutputFormat };
  if (GPT_IMAGE_FAMILY.test(modelId.trim())) {
    // gpt-image-2 起支持任意宽高，分辨率真实可调；1.x 仍只有 1024 家族。
    const arbitrary = gptImageMajorVersion(modelId) >= 2;
    return { resolutionTiers: arbitrary ? IMAGE_RESOLUTIONS : ["1K"], quality: true, outputFormat: true };
  }
  return { resolutionTiers: ["1K"], quality: false, outputFormat: false };
}
