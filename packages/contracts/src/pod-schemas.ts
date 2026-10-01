import { Type, type Static } from "@sinclair/typebox";
import { stringEnumSchema } from "./enums.js";
import { Job } from "./api-schemas.js";
import { schemaRef } from "./ref.js";
import { SEGMENTATION_PROTOCOLS } from "./segmentation.js";
import { PodRepeatLayout } from "./pod-repeat.js";
import {
  ETSY_TAGS_MAX, ETSY_TAG_MAX_LENGTH, ETSY_TITLE_MAX, AMAZON_TITLE_MAX, TIKTOK_TITLE_MAX, TIKTOK_TITLE_MIN,
  LISTING_PLATFORMS, MAX_LISTING_KEYWORDS_LENGTH, MAX_LISTING_SELLING_POINTS_LENGTH,
  MAX_PATTERN_BRIEF_LENGTH, MAX_PATTERN_NAME_LENGTH, MAX_PATTERN_STYLE_LENGTH, MAX_PATTERN_TAG_LENGTH,
  PATTERN_FORGE_CANDIDATES_MAX, PATTERN_TAGS_MAX, PATTERN_VARIANT_CANDIDATES_MAX,
} from "./limits.js";

/**
 * 花型工坊（POD）领域契约。
 *
 * 三个领域概念：花型（可复用的图案资产，全局实体）、规格包（花型 × 印刷规格的确定性合成产物）、
 * Listing 文案（花型 × 平台约束的文案包）。规格目录数据在 pod-print-specs.ts，
 * 与本文件的 PodPrintSpec schema 分离：schema 进 OpenAPI components，目录常量是纯数据不注册。
 */

export const PATTERN_SOURCES = ["EXTRACTED", "GENERATED", "UPLOADED", "DERIVED"] as const;
/** 花型来源：实拍图提取、AI 起稿、直接上传文件，或对既有花型做确定性衍生（改色）；衍生血缘见 parentPatternId。 */
export const PatternSource = stringEnumSchema(PATTERN_SOURCES, "#/components/schemas/PatternSource");
export type PatternSource = Static<typeof PatternSource>;

export const POD_PRINT_CATEGORIES = ["TSHIRT", "HOODIE", "MUG_11OZ", "POSTER", "TOTE_BAG", "PHONE_CASE"] as const;
/** 规格目录品类；取值与 pod-print-specs.ts 的目录条目一一对应。 */
export const PodPrintCategory = stringEnumSchema(POD_PRINT_CATEGORIES, "#/components/schemas/PodPrintCategory");
export type PodPrintCategory = Static<typeof PodPrintCategory>;

/** NONE：尚未校验（新入库花型的默认值）；VERIFIED/FAILED 只能由本地环绕位移验缝写入。 */
export const TILEABLE_STATUSES = ["NONE", "VERIFIED", "FAILED"] as const;
export const TileableStatus = stringEnumSchema(TILEABLE_STATUSES, "#/components/schemas/TileableStatus");
export type TileableStatus = Static<typeof TileableStatus>;

/** CENTERED：contain-fit 进安全区居中；TILE：满印平铺（repeat 铺满整幅可印区，无安全边距）。满印的摆放几何由平铺排列（pod-repeat.ts 的 repeatLayout）描述，与版式正交。 */
export const POD_PRINT_LAYOUTS = ["CENTERED", "TILE"] as const;
export const PodPrintLayout = stringEnumSchema(POD_PRINT_LAYOUTS, "#/components/schemas/PodPrintLayout");
export type PodPrintLayout = Static<typeof PodPrintLayout>;

/** 印刷规格：一条目录条目描述「某品类在 300DPI 下的可印画布与安全边距」。版式（居中/满印）是逐请求选择，与规格条目正交。 */
export const PodPrintSpec = Type.Object({
  id: Type.String({ minLength: 1, description: "稳定规格 ID（非 uuid），进入规格包 manifest；目录修订时保持不变。" }),
  category: schemaRef(PodPrintCategory),
  label: Type.String({ minLength: 1, description: "中文显示名。" }),
  widthPx: Type.Integer({ minimum: 1, description: "可印画布宽（像素）= 英寸 × dpi。" }),
  heightPx: Type.Integer({ minimum: 1, description: "可印画布高（像素）= 英寸 × dpi。" }),
  dpi: Type.Integer({ minimum: 72, description: "目标打印精度；同时写入产物 PNG 的 DPI 元数据。" }),
  safeMarginPct: Type.Integer({ minimum: 0, maximum: 50, description: "安全边距占画布短边的百分比；花型 contain-fit 后再内缩。" }),
  notes: Type.String({ description: "来源与适用性说明；含「以工厂模板为准」提示。" }),
}, { $id: "#/components/schemas/PodPrintSpec" });
export type PodPrintSpec = Static<typeof PodPrintSpec>;

export const PodPrintSpecList = Type.Object({ specVersion: Type.String(), items: Type.Array(schemaRef(PodPrintSpec)) }, { $id: "#/components/schemas/PodPrintSpecList" });
export type PodPrintSpecList = Static<typeof PodPrintSpecList>;

export const Pattern = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String(),
  source: schemaRef(PatternSource),
  tags: Type.Array(Type.String(), { maxItems: PATTERN_TAGS_MAX }),
  sourceJobId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()], { description: "来源任务 id；UPLOADED 为 null。前端用它把任务与其产物卡片关联（占位卡结算、复用定位）。" })),
  parentPatternId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()], { description: "衍生源花型 id；非 DERIVED 为 null。版本栈用它在前端从花型列表自行回溯血缘，不设专门端点。" })),
  tileable: schemaRef(TileableStatus, { description: "可平铺判定；只对整块连续印花的品类（满印服饰/全环绕马克杯/满版手机壳/织物）有意义，单区域印花无需。由本地验缝写入，不改动像素。" }),
  tileableScore: Type.Optional(Type.Union([Type.Number(), Type.Null()], { description: "验缝归一化相似度 0..1；未校验为 null。供人工判断，不参与徽标以外的判定。" })),
  tileableCheckedWith: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "写入该判定时的验缝算法版本；与当前 TILEABILITY_ALGORITHM_VERSION 不一致表示判定已过期需重算。" })),
  imageUrl: Type.Optional(Type.String({ description: "花型原图（透明底 PNG）访问地址。" })),
  thumbUrl: Type.Optional(Type.String()),
  width: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
}, { $id: "#/components/schemas/Pattern" });
export type Pattern = Static<typeof Pattern>;

export const PatternList = Type.Object({ items: Type.Array(schemaRef(Pattern)) }, { $id: "#/components/schemas/PatternList" });
export type PatternList = Static<typeof PatternList>;

export const UpdatePatternInput = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PATTERN_NAME_LENGTH })),
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: MAX_PATTERN_TAG_LENGTH }), { maxItems: PATTERN_TAGS_MAX })),
}, { $id: "#/components/schemas/UpdatePatternInput" });
export type UpdatePatternInput = Static<typeof UpdatePatternInput>;

export const PrintPackFile = Type.Object({
  name: Type.String(),
  kind: Type.Union([Type.Literal("PRINT_FILE"), Type.Literal("MOCKUP"), Type.Literal("MANIFEST"), Type.Literal("SEAMLESS_TILE")], { description: "PRINT_FILE 为印刷图稿 PNG，MOCKUP 为品类示意图 PNG（高级插画风场景渲染，非实拍），MANIFEST 为溯源清单 JSON，SEAMLESS_TILE 为满印重复单元的透明底 PNG（源图原生分辨率，供第三方平台二次平铺）；仅满印版式产出。" }),
  url: Type.String(),
  hash: Type.String(),
}, { $id: "#/components/schemas/PrintPackFile" });
export type PrintPackFile = Static<typeof PrintPackFile>;

export const PrintPackStatus = Type.Union([Type.Literal("QUEUED"), Type.Literal("RUNNING"), Type.Literal("SUCCEEDED"), Type.Literal("FAILED"), Type.Literal("CANCELLED")], { $id: "#/components/schemas/PrintPackStatus" });
export type PrintPackStatus = Static<typeof PrintPackStatus>;

export const PrintPack = Type.Object({
  id: Type.String({ format: "uuid" }),
  jobId: Type.String({ format: "uuid" }),
  patternId: Type.String({ format: "uuid" }),
  specId: Type.String(),
  specVersion: Type.String(),
  status: schemaRef(PrintPackStatus),
  files: Type.Array(schemaRef(PrintPackFile)),
  error: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
}, { $id: "#/components/schemas/PrintPack" });
export type PrintPack = Static<typeof PrintPack>;

export const PrintPackList = Type.Object({ items: Type.Array(schemaRef(PrintPack)) }, { $id: "#/components/schemas/PrintPackList" });
export type PrintPackList = Static<typeof PrintPackList>;

/** 规格包任务创建响应：任务与领域记录一起返回，前端立即有可轮询的 printPack。 */
export const CreatePrintPackJobResponse = Type.Object({ job: schemaRef(Job), printPack: Type.Union([schemaRef(PrintPack), Type.Null()]) }, { $id: "#/components/schemas/CreatePrintPackJobResponse" });
export type CreatePrintPackJobResponse = Static<typeof CreatePrintPackJobResponse>;

// ---- Listing 文案 ----

/** 首版跨境三平台；平台规则数值见 limits.ts，新增平台时同时补校验参数。 */
export const ListingPlatform = stringEnumSchema(LISTING_PLATFORMS, "#/components/schemas/ListingPlatform");
export type ListingPlatform = Static<typeof ListingPlatform>;

export const ListingCopy = Type.Object({
  platform: schemaRef(ListingPlatform),
  title: Type.String({ description: "平台标题；长度受平台硬约束（Etsy≤140 / Amazon≤75 / TikTok 25–200）。" }),
  tags: Type.Array(Type.String(), { description: "平台标签；Etsy 最多 13 个每个 ≤20 字符，其余平台可为空数组。" }),
  description: Type.String(),
  bullets: Type.Array(Type.String(), { description: "平台要点（Amazon 五点式）；不适用平台为空数组。" }),
}, { $id: "#/components/schemas/ListingCopy" });
export type ListingCopy = Static<typeof ListingCopy>;

/** 花型 Listing 文案结果；独立于 CopywritingResult（后者归属项目域且 project_id 非空）。 */
export const PatternListingResult = Type.Object({
  jobId: Type.String({ format: "uuid" }),
  patternId: Type.String({ format: "uuid" }),
  platform: schemaRef(ListingPlatform),
  copy: schemaRef(ListingCopy),
  createdAt: Type.String({ format: "date-time" }),
}, { $id: "#/components/schemas/PatternListingResult" });
export type PatternListingResult = Static<typeof PatternListingResult>;

// ---- 任务输入 ----

/**
 * 成包流水线的答案（后两问：做成什么品类、卖到哪个平台；第一问"图案从哪来"由发起入口回答）。
 *
 * 单独抽成一份属性表供两处复用：`POST /patterns/:patternId/pipelines`（从既有花型起链）与
 * 源入口的可选字段（提取/起稿/上传时顺带成包）。两处各写一份字段清单必然会漂移。
 */
const PATTERN_PIPELINE_ANSWERS_PROPERTIES = {
  specId: Type.String({ minLength: 1, description: "pod-print-specs 目录中的规格 ID。" }),
  layout: Type.Optional(schemaRef(PodPrintLayout, { description: "版式；缺省 CENTERED。" })),
  repeatLayout: Type.Optional(schemaRef(PodRepeatLayout, { description: "平铺排列（仅 layout=TILE 生效）；缺省直排。携带本字段而版式非 TILE 时拒绝。" })),
  listingPlatform: schemaRef(ListingPlatform),
  listingProviderId: Type.String({ format: "uuid", description: "文案用的推理 Provider（需支持视觉）。" }),
  listingModelId: Type.String({ minLength: 1 }),
  sellingPoints: Type.Optional(Type.String({ maxLength: MAX_LISTING_SELLING_POINTS_LENGTH, description: "卖点与受众补充描述。" })),
  bannedWords: Type.Optional(Type.String({ maxLength: MAX_LISTING_KEYWORDS_LENGTH, description: "禁用词；同时注入生成提示与结果校验。" })),
};

export const PatternPipelineAnswers = Type.Object({ ...PATTERN_PIPELINE_ANSWERS_PROPERTIES }, { $id: "#/components/schemas/PatternPipelineAnswers" });
export type PatternPipelineAnswers = Static<typeof PatternPipelineAnswers>;

/**
 * 生成花型时的底版要求（起稿与生成式衍生共用）。
 *
 * - `SOURCE`：跟随源图——源是透明底就保住透明底，源有底色就保留原底色。只有衍生有源图。
 * - `WHITE`：要纯白底。印在白 T 上时白底等于"一块白矩形压在图案下"，选它通常是因为后面要自己抠。
 * - `TRANSPARENT`：要带 alpha 的透明底。参数级能力，只有 `supportsTransparentBackground` 认得的
 *   模型家族能满足；其余模型只会照提示词画一块"看起来透明"的棋盘格，所以路由直接拒绝而不是硬发。
 *
 * 为什么不做"任意十六进制底色"：主流接口只有 transparent/opaque/auto 三值，自选颜色只能靠提示词
 * 求模型，而"求"与"保证"是两件事。要开放这一档，先想清楚怎么验证（边界取样？容差多少？），
 * 再往这个枚举里加值——不要只看模型能否"画出"目标色就承诺它。
 */
export const PATTERN_BACKGROUND_MODES = ["SOURCE", "WHITE", "TRANSPARENT"] as const;
export const PatternBackgroundMode = stringEnumSchema(PATTERN_BACKGROUND_MODES, "#/components/schemas/PatternBackgroundMode");
export type PatternBackgroundMode = Static<typeof PatternBackgroundMode>;

// 提取：源图以 multipart 随请求上传（同套图反推），源图同时作为来源血缘留痕；
// 分割 Provider 三元组必须显式提供——花型工坊是全局页，没有项目级分割配置可继承。
// seedream_layerize 面向多元素图层拆分，不适用单主体花型提取，协议集合在此收窄。
const PATTERN_EXTRACT_PROTOCOLS = SEGMENTATION_PROTOCOLS.filter((protocol) => protocol !== "seedream_layerize");
export const CreatePatternExtractJobInput = Type.Object({
  providerId: Type.String({ format: "uuid" }),
  modelId: Type.String({ minLength: 1 }),
  protocol: Type.Optional(Type.Union(PATTERN_EXTRACT_PROTOCOLS.map((value) => Type.Literal(value)), { description: "分割协议；与 Provider 声明矛盾时拒绝。" })),
  file: Type.String({ format: "binary", description: "带图案的商品实拍图。" }),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PATTERN_NAME_LENGTH })),
  brief: Type.Optional(Type.String({ maxLength: MAX_PATTERN_BRIEF_LENGTH, description: "补充描述，例如「只留杯壁图案、去掉杯把和底座」，进入分割文本提示。" })),
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: MAX_PATTERN_TAG_LENGTH }), { maxItems: PATTERN_TAGS_MAX })),
  pipeline: Type.Optional(schemaRef(PatternPipelineAnswers, { description: "可选：提取完成后接着跑成包流水线（图案来源即这次提取）。" })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
}, { $id: "#/components/schemas/CreatePatternExtractJobInput" });
export type CreatePatternExtractJobInput = Static<typeof CreatePatternExtractJobInput>;

// AI 起稿：theme 必填，prompt 由 ecom-skill 的固化编译函数派生（不经 LLM 改写）。
export const CreatePatternForgeJobInput = Type.Object({
  providerId: Type.String({ format: "uuid" }),
  imageModelId: Type.String({ minLength: 1 }),
  theme: Type.String({ minLength: 1, maxLength: MAX_PATTERN_BRIEF_LENGTH, description: "图案主题描述，例如「水彩野花束、奶油色底」。" }),
  style: Type.Optional(Type.String({ maxLength: MAX_PATTERN_STYLE_LENGTH, description: "风格画种，例如 watercolor / line art / geometric。" })),
  category: Type.Optional(schemaRef(PodPrintCategory, { description: "目标承印品类；只影响构图建议，不改变出图像素。" })),
  candidateCount: Type.Optional(Type.Integer({ minimum: 1, maximum: PATTERN_FORGE_CANDIDATES_MAX, default: 1 })),
  // 起稿没有源图，所以收窄掉 SOURCE：能选的只有白底与透明底。
  background: Type.Optional(Type.Union([Type.Literal("WHITE"), Type.Literal("TRANSPARENT")], { description: "底版；缺省 WHITE。TRANSPARENT 要求所选模型支持（见 supportsTransparentBackground），否则路由拒绝。" })),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PATTERN_NAME_LENGTH })),
  pipeline: Type.Optional(schemaRef(PatternPipelineAnswers, { description: "可选：起稿完成后接着跑成包流水线；多候选时从第一张有产物的候选起链。" })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
}, { $id: "#/components/schemas/CreatePatternForgeJobInput" });
export type CreatePatternForgeJobInput = Static<typeof CreatePatternForgeJobInput>;

// 规格包：花型已存在（路由携带 patternId），只需指定规格条目与版式。
export const CreatePrintPackJobInput = Type.Object({
  specId: Type.String({ minLength: 1, description: "pod-print-specs 目录中的规格 ID。" }),
  layout: Type.Optional(schemaRef(PodPrintLayout, { description: "版式；缺省 CENTERED。TILE 为满印平铺，未验缝的花型可能出现接缝。" })),
  repeatLayout: Type.Optional(schemaRef(PodRepeatLayout, { description: "平铺排列（仅 layout=TILE 生效）；缺省直排。排列只改摆放几何不改像素：镜像构造性无缝，错位类的接缝风险与直排相同。" })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
}, { $id: "#/components/schemas/CreatePrintPackJobInput" });
export type CreatePrintPackJobInput = Static<typeof CreatePrintPackJobInput>;

// ---- 花型衍生 ----

/** 花型改色：确定性本地 HSL 调制，无外部计费请求；产物是一张新花型（parentPatternId 指向源），源花型不变。 */
export const CreatePatternDeriveJobInput = Type.Object({
  hueShift: Type.Optional(Type.Integer({ minimum: -180, maximum: 180, description: "色相旋转角度。" })),
  saturationPct: Type.Optional(Type.Integer({ minimum: 0, maximum: 300, description: "饱和度百分比（100 为不变）。" })),
  brightnessPct: Type.Optional(Type.Integer({ minimum: 10, maximum: 300, description: "亮度百分比（100 为不变）。" })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
}, { $id: "#/components/schemas/CreatePatternDeriveJobInput" });
export type CreatePatternDeriveJobInput = Static<typeof CreatePatternDeriveJobInput>;

// ---- 生成式衍生（画风 / 构图）----

/** 衍生轴向：画风改画种与笔触，构图改图案的排布方式。 */
export const PATTERN_VARIANT_AXES = ["STYLE", "COMPOSITION"] as const;
export const PatternVariantAxis = stringEnumSchema(PATTERN_VARIANT_AXES, "#/components/schemas/PatternVariantAxis");
export type PatternVariantAxis = Static<typeof PatternVariantAxis>;

/**
 * 轴向预设的合法取值。契约层用扁平枚举 + 下面的轴向归属表做一致性校验，
 * 与"协议从模型声明派生、请求显式值只做校验"同一套路；提示词片段在 ecom-skill
 * 以 `Record<PatternVariantPreset, …>` 维护，缺项是编译期错误而不是运行期兜底。
 */
export const PATTERN_VARIANT_PRESET_IDS = ["WATERCOLOR", "LINE_ART", "FLAT_VECTOR", "GOUACHE", "PAPER_CUT", "SCATTER", "GRID", "BORDER", "CENTER_MOTIF", "REARRANGE_HALF_DROP"] as const;
export const PatternVariantPreset = stringEnumSchema(PATTERN_VARIANT_PRESET_IDS, "#/components/schemas/PatternVariantPreset");
export type PatternVariantPreset = Static<typeof PatternVariantPreset>;

/**
 * 每个轴向可用的预设——轴向归属的唯一真相源。web 按它渲染预设 chips；
 * ecom-skill 反转这张表得到归属判定（presetBelongsToAxis），路由与 worker 共用那个判定，
 * 不再各写一份归属清单。提示词片段在 ecom-skill 以 `Record<PatternVariantPreset, …>` 维护，
 * 契约新增预设而片段缺登记时是编译期错误而不是运行期兜底。
 */
export const PATTERN_VARIANT_PRESETS: Record<PatternVariantAxis, readonly PatternVariantPreset[]> = {
  STYLE: ["WATERCOLOR", "LINE_ART", "FLAT_VECTOR", "GOUACHE", "PAPER_CUT"],
  COMPOSITION: ["SCATTER", "GRID", "BORDER", "CENTER_MOTIF", "REARRANGE_HALF_DROP"],
};

// 生成式衍生：源花型作为参考图走 images/edits，prompt 由 ecom-skill 的固化模板派生（不经 LLM 改写）。
// 定位是"快速铺款筛选"：API 无法锁 seed/风格向量，因此不承诺风格一致，只提供候选供人选。
export const CreatePatternVariantJobInput = Type.Object({
  providerId: Type.String({ format: "uuid" }),
  imageModelId: Type.String({ minLength: 1 }),
  axis: schemaRef(PatternVariantAxis),
  preset: schemaRef(PatternVariantPreset, { description: "轴向预设；必须属于 axis 对应的预设集合，否则路由拒绝。" }),
  extra: Type.Optional(Type.String({ maxLength: MAX_PATTERN_STYLE_LENGTH, description: "补充描述，附加在固化模板之后。" })),
  background: Type.Optional(schemaRef(PatternBackgroundMode, { description: "底版；缺省 SOURCE（跟随源图）。TRANSPARENT 要求所选模型支持，否则路由拒绝。" })),
  candidateCount: Type.Optional(Type.Integer({ minimum: 1, maximum: PATTERN_VARIANT_CANDIDATES_MAX, default: 1 })),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PATTERN_NAME_LENGTH })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
}, { $id: "#/components/schemas/CreatePatternVariantJobInput" });
export type CreatePatternVariantJobInput = Static<typeof CreatePatternVariantJobInput>;

// Listing 文案：COPYWRITE 的全局扩展；同输入重复请求复用旧结果，重新生成需换 idempotencyKey。
export const CreatePatternListingJobInput = Type.Object({
  providerId: Type.String({ format: "uuid" }),
  modelId: Type.String({ minLength: 1 }),
  platform: schemaRef(ListingPlatform),
  sellingPoints: Type.Optional(Type.String({ maxLength: MAX_LISTING_SELLING_POINTS_LENGTH, description: "卖点与受众补充描述。" })),
  mustIncludeWords: Type.Optional(Type.String({ maxLength: MAX_LISTING_KEYWORDS_LENGTH })),
  bannedWords: Type.Optional(Type.String({ maxLength: MAX_LISTING_KEYWORDS_LENGTH, description: "禁用词；同时注入生成提示与结果校验。" })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
}, { $id: "#/components/schemas/CreatePatternListingJobInput" });
export type CreatePatternListingJobInput = Static<typeof CreatePatternListingJobInput>;

// ---- 成包流水线（"三问一跑"）----

/**
 * 流水线的停靠点。主图不是独立步骤：它已随 PRINT_PACK 一起产出（manifest + MOCKUP 文件），
 * 单独列一步只会在收据里制造一个没有独立任务的状态格。
 * SOURCE 只在"从花型墙的来源动作起链"时存在；从既有花型起链时跳过第一问，步骤表里就没有它。
 */
export const PATTERN_PIPELINE_STEPS = ["SOURCE", "TILE_CHECK", "PRINT_PACK", "LISTING"] as const;
export const PatternPipelineStepName = stringEnumSchema(PATTERN_PIPELINE_STEPS, "#/components/schemas/PatternPipelineStepName");
export type PatternPipelineStepName = Static<typeof PatternPipelineStepName>;

/** 步骤中文名：收据卡与进度文案都要用，与枚举同源放契约里，避免各端各写一份文案。 */
export const PATTERN_PIPELINE_STEP_LABELS: Record<PatternPipelineStepName, string> = {
  SOURCE: "图案获取",
  TILE_CHECK: "验缝",
  PRINT_PACK: "规格包",
  LISTING: "Listing 文案",
};

export const PATTERN_PIPELINE_STEP_STATUSES = ["PENDING", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export const PatternPipelineStepStatus = stringEnumSchema(PATTERN_PIPELINE_STEP_STATUSES, "#/components/schemas/PatternPipelineStepStatus");
export type PatternPipelineStepStatus = Static<typeof PatternPipelineStepStatus>;

/**
 * AWAITING_INPUT：流水线停在需要用户决策的地方，而不是自己猜。
 * 目前只有一种触发：满印版式的验缝未通过。
 */
export const PATTERN_PIPELINE_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "AWAITING_INPUT", "CANCELLED"] as const;
export const PatternPipelineStatus = stringEnumSchema(PATTERN_PIPELINE_STATUSES, "#/components/schemas/PatternPipelineStatus");
export type PatternPipelineStatus = Static<typeof PatternPipelineStatus>;

/** AWAITING_INPUT 的原因；SEAM_RISK = 满印版式的验缝未通过。 */
export const PATTERN_PIPELINE_BLOCK_REASONS = ["SEAM_RISK"] as const;
export const PatternPipelineBlockReason = stringEnumSchema(PATTERN_PIPELINE_BLOCK_REASONS, "#/components/schemas/PatternPipelineBlockReason");
export type PatternPipelineBlockReason = Static<typeof PatternPipelineBlockReason>;

/**
 * AWAITING_INPUT 的三个出口：改用居中版式继续；换镜像排列出满印（构造性无缝，无需验缝通过，
 * 见 pod-repeat.ts 与 ADR-0001）；或明知有接缝仍按原排列出满印。
 */
export const PATTERN_PIPELINE_RESOLUTIONS = ["USE_CENTERED", "USE_MIRROR", "ALLOW_SEAM"] as const;
export const PatternPipelineResolution = stringEnumSchema(PATTERN_PIPELINE_RESOLUTIONS, "#/components/schemas/PatternPipelineResolution");
export type PatternPipelineResolution = Static<typeof PatternPipelineResolution>;

export const PatternPipelineStep = Type.Object({
  step: schemaRef(PatternPipelineStepName),
  position: Type.Integer({ description: "执行顺序；推进按它取下一步，不靠枚举顺序。" }),
  status: schemaRef(PatternPipelineStepStatus),
  jobId: Type.Union([Type.String({ format: "uuid" }), Type.Null()], { description: "该步骤对应的任务；前端据此轮询进度与错误原文。" }),
  detail: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()], { description: "步骤补充事实（验缝分数、接缝风险提示等），不参与状态机。" }),
  error: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
}, { $id: "#/components/schemas/PatternPipelineStep" });
export type PatternPipelineStep = Static<typeof PatternPipelineStep>;

export const PatternPipeline = Type.Object({
  id: Type.String({ format: "uuid" }),
  patternId: Type.Union([Type.String({ format: "uuid" }), Type.Null()], { description: "SOURCE 步骤完成后回填；从既有花型起链时创建即有值。" }),
  specId: Type.String(),
  specVersion: Type.String(),
  layout: schemaRef(PodPrintLayout),
  repeatLayout: schemaRef(PodRepeatLayout, { description: "平铺排列（仅 layout=TILE 生效）；创建时缺省直排。裁决出口「换镜像出满印」会把它改写为 MIRROR。" }),
  listingPlatform: schemaRef(ListingPlatform),
  listingProviderId: Type.String({ format: "uuid" }),
  listingModelId: Type.String({ minLength: 1 }),
  status: schemaRef(PatternPipelineStatus),
  blockReason: Type.Optional(Type.Union([schemaRef(PatternPipelineBlockReason), Type.Null()], { description: "AWAITING_INPUT 的原因，其它状态为 null。" })),
  steps: Type.Array(schemaRef(PatternPipelineStep)),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
}, { $id: "#/components/schemas/PatternPipeline" });
export type PatternPipeline = Static<typeof PatternPipeline>;

export const PatternPipelineList = Type.Object({ items: Type.Array(schemaRef(PatternPipeline)) }, { $id: "#/components/schemas/PatternPipelineList" });
export type PatternPipelineList = Static<typeof PatternPipelineList>;

/** 三问里的后两问：做成什么品类、卖到哪个平台（加文案模型）。图案从哪来由入口决定。 */
export const CreatePatternPipelineInput = Type.Object({
  ...PATTERN_PIPELINE_ANSWERS_PROPERTIES,
  idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
}, { $id: "#/components/schemas/CreatePatternPipelineInput" });
export type CreatePatternPipelineInput = Static<typeof CreatePatternPipelineInput>;

/** 从 AWAITING_INPUT 继续；resolution 决定后续版式与排列（USE_MIRROR 改写 repeatLayout）及是否接受接缝风险。 */
export const ContinuePatternPipelineInput = Type.Object({
  resolution: schemaRef(PatternPipelineResolution),
}, { $id: "#/components/schemas/ContinuePatternPipelineInput" });
export type ContinuePatternPipelineInput = Static<typeof ContinuePatternPipelineInput>;

/** Etsy tags 的上限值单独导出：生成提示需要引用「最多 13 个、每个 ≤20 字符」。 */
export const LISTING_PLATFORM_LIMITS = {
  ETSY: { titleMax: ETSY_TITLE_MAX, tagsMax: ETSY_TAGS_MAX, tagMaxLength: ETSY_TAG_MAX_LENGTH },
  AMAZON: { titleMax: AMAZON_TITLE_MAX, tagsMax: 0, tagMaxLength: 0 },
  TIKTOK_SHOP: { titleMax: TIKTOK_TITLE_MAX, titleMin: TIKTOK_TITLE_MIN, tagsMax: 0, tagMaxLength: 0 },
} as const;
