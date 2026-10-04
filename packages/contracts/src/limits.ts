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

// ---- AI 起稿工作台（创作草稿）----

/** 创作草稿名称长度上限；未命名时由服务端生成默认名。 */
export const MAX_PATTERN_DRAFT_NAME_LENGTH = 60;

/** 单批创作的候选张数上限（生成与改稿共用）。 */
export const PATTERN_DRAFT_CANDIDATES_MAX = 4;

/**
 * 一个草稿可保留的参考图数量上限。上传与下发共用同一数值：
 * 上传上限一旦高于下发上限，攒够的参考图会让每一次起稿都在提交时才失败。
 */
export const PATTERN_DRAFT_REFERENCES_MAX = 6;

/**
 * 一个草稿可保留的改稿笔迹数量上限。
 *
 * 每次带笔迹的改稿都会新增一张，且只要它的批次还可能重试失败槽位，文件就必须留在磁盘上，
 * 所以它按创作历史的长短单独给额度，不与参考图共用计数。
 *
 * 上传时会先收掉再也不会被读到的旧笔迹（见 API 的 pruneDraftAnnotations），所以这个上限
 * 只用来挡住真正失控的增长；撞上它意味着同一草稿里有一大堆批次还挂着失败槽位。
 */
export const PATTERN_DRAFT_ANNOTATIONS_MAX = 24;

/** 改稿指令（整图/按笔迹/接缝）长度上限。 */
export const MAX_DRAFT_INSTRUCTION_LENGTH = 2000;

/**
 * 参考图备注长度上限。
 *
 * 备注会逐条写进提示词，与改稿指令同属"要进模型上下文"的文本，所以同样有界：
 * 六张参考图都不设限，单次起稿的提示词长度就无法预估。600 字足够写清一张图的用途
 * （草图预填的那句约 110 字），也仍在一个能读完的长度里。
 */
export const MAX_DRAFT_MEDIA_NOTES_LENGTH = 600;

/** 接缝改稿的跨边带宽（像素）上限；超宽会把整图变成重绘，失去定向修缝语义。 */
export const DRAFT_SEAM_BAND_MAX = 256;

// ---- Listing 文案平台硬约束（首版跨境三平台）----
// 数值来自平台官方规范，
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
