/**
 * 跨应用共享的容量与范围约束。
 *
 * API 校验、TypeBox 契约与前端表单必须引用同一份数值，否则双端硬编码会各自漂移
 * （改一侧忘另一侧，用户要等到上传失败才发现限制变了）。
 *
 * 单独成文件而非并入 index 常量区，是因为 api-requests 需要引用这些值构造 schema，
 * 而 index 又需要转发 api-requests，同文件会形成循环导入。
 */

/** 套图反推单次可上传的源图张数上限。 */
export const MAX_SUITE_FORGE_SOURCES = 12;

/** 套图反推目标分镜数的下限：低于该值无法覆盖完整的转化漏斗。 */
export const MIN_SUITE_FORGE_SHOTS = 5;

/** 套图反推目标分镜数的上限，同时是 EcomSuiteFile.shots 的容量上限。 */
export const MAX_SUITE_FORGE_SHOTS = 12;

/** 单个上传文件的体积上限（字节）。 */
export const MAX_UPLOAD_FILE_BYTES = 30 * 1024 * 1024;

/** 套图名称长度上限；multipart 字段没有 schema 校验，API 需按同一数值自行约束。 */
export const MAX_SUITE_FORGE_NAME_LENGTH = 60;

/** 额外反推要求长度上限；同上，避免前端已截断、后端却静默接受超长输入。 */
export const MAX_SUITE_FORGE_INSTRUCTION_LENGTH = 4000;

/** 模特名称长度上限。 */
export const MAX_MODEL_NAME_LENGTH = 40;

/** 模特补充描述长度上限；进入定妆照 prompt 的 "Additional requirements" 段。 */
export const MAX_MODEL_NOTES_LENGTH = 2000;

/** 模特特色标记多选上限：超过两条会把「 memorable but not distracting 」的人脸推向猎奇。 */
export const MODEL_MARKS_MAX = 2;

/** 气质关键词多选上限：表达层段落超载会让模型注意力稀释。 */
export const MODEL_AURA_MAX = 3;

/** 单次选角生成的候选张数上限，与项目生成批次语义一致。 */
export const MODEL_CAST_CANDIDATES_MAX = 4;

// ---- 花型工坊（POD）----

/** 花型名称长度上限。 */
export const MAX_PATTERN_NAME_LENGTH = 60;

/** 花型标签数量与单条长度上限；标签进入资产库筛选与 listing 生成上下文。 */
export const PATTERN_TAGS_MAX = 8;
export const MAX_PATTERN_TAG_LENGTH = 24;

/** 提取补充描述 / 起稿主题描述长度上限；进入分割提示或起稿 prompt 编译。 */
export const MAX_PATTERN_BRIEF_LENGTH = 2000;

/** 单次 AI 起稿的候选张数上限，与选角、生成批次语义一致。 */
export const PATTERN_FORGE_CANDIDATES_MAX = 4;

/** 起稿可选风格画种数量上限；风格词表在 pod-schemas 维护，这里只约束引用长度。 */
export const MAX_PATTERN_STYLE_LENGTH = 60;

/**
 * 单次生成式衍生（画风 / 构图）的候选张数上限。
 * 与起稿分开命名：两者是付费生图，但成本口径不同——衍生会带上源花型作为参考图。
 */
export const PATTERN_VARIANT_CANDIDATES_MAX = 4;

// ---- Listing 文案平台硬约束（首版跨境三平台）----
// 数值来自平台官方规范（见 docs/reference/pod-domain-research.md 第 3 节），
// 生成与校验共用同一份数值，改平台规则时只动这里。

export const LISTING_PLATFORMS = ["ETSY", "AMAZON", "TIKTOK_SHOP"] as const;

/** Etsy：标题 ≤140 字符，13 个 tags 每个 ≤20 字符。 */
export const ETSY_TITLE_MAX = 140;
export const ETSY_TAGS_MAX = 13;
export const ETSY_TAG_MAX_LENGTH = 20;

/** Amazon Merch：标题上限 75 字符（平台正收紧至该值）。 */
export const AMAZON_TITLE_MAX = 75;

/** TikTok Shop：标题 25–200 字符。 */
export const TIKTOK_TITLE_MIN = 25;
export const TIKTOK_TITLE_MAX = 200;

/** Listing 卖点补充、必含词与禁用词输入的长度上限。 */
export const MAX_LISTING_SELLING_POINTS_LENGTH = 2000;
export const MAX_LISTING_KEYWORDS_LENGTH = 500;
