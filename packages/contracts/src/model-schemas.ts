import { Type, type Static } from "@sinclair/typebox";
import { ImageAspectRatio } from "./enums.js";
import { schemaRef } from "./ref.js";
import { MAX_MODEL_NAME_LENGTH, MAX_MODEL_NOTES_LENGTH, MODEL_AURA_MAX, MODEL_CAST_CANDIDATES_MAX, MODEL_MARKS_MAX } from "./limits.js";

/**
 * 模特选角（model cast）领域契约。
 *
 * ModelSpec 是「spec 即合约」的载体：选项组合持久化存储，定妆照 prompt 是 spec 的纯函数
 * 派生（编译器在 packages/ecom-skill）。每维取值元组在此单源维护，ecom-skill 的选项映射表
 * 与前端渲染都以这些元组为键，保证契约、编译与 UI 三方不漂移。
 */

// ---- 层 1 身份内核：决定「这是谁」，全站复用时不可漂移的部分 ----
export const MODEL_GENDERS = ["FEMALE", "MALE", "ANDROGYNOUS"] as const;
export const MODEL_AGES = ["CHILD_7", "PRETEEN_11", "TEEN_16", "EARLY_20S", "LATE_20S", "EARLY_30S", "MID_30S", "MID_40S", "SENIOR"] as const;
export const MODEL_HERITAGES = ["EAST_ASIAN", "SOUTHEAST_ASIAN", "SOUTH_ASIAN", "MIDDLE_EASTERN", "NORTHERN_EUROPEAN", "MEDITERRANEAN", "LATIN_AMERICAN", "AFRICAN", "MIXED"] as const;
export const MODEL_STATURES = ["PETITE_158", "STANDARD_165", "TALL_172", "RUNWAY_180"] as const;
export const MODEL_BUILDS = ["SLENDER", "BALANCED", "ATHLETIC", "MUSCULAR", "CURVY", "PLUS", "MATERNITY"] as const;

// ---- 层 2 容貌细节：五官、发型、肤质与特色标记 ----
export const MODEL_FACE_SHAPES = ["OVAL", "ROUND", "SQUARE_JAW", "HEART", "LONG", "DIAMOND"] as const;
export const MODEL_EYE_SHAPES = ["ALMOND", "ROUND", "MONOLID", "UPTURNED", "DOWNTURNED", "NARROW", "DEEP_SET", "PEACH_BLOSSOM", "INNER_DOUBLE"] as const;
export const MODEL_EYE_COLORS = ["DARK_BROWN", "AMBER", "HAZEL", "GREEN", "BLUE", "GREY"] as const;
export const MODEL_BROW_SHAPES = ["STRAIGHT_SOFT", "ARCED", "FEATHERED", "BOLD", "THIN_ARCHED", "WILLOW", "THICK_STRAIGHT"] as const;
export const MODEL_NOSE_SHAPES = ["DELICATE", "STRAIGHT", "SCULPTED", "BROAD", "UPTURNED", "AQUILINE", "BULBOUS"] as const;
export const MODEL_LIP_SHAPES = ["NATURAL", "FULL", "BOW", "WIDE", "THIN"] as const;
/** 发长自短到长的序：既是取值枚举，也是「这个发型需要多长头发」这类互斥判定的比较基准。 */
export const MODEL_HAIR_LENGTHS = ["CROP", "CHIN_BOB", "SHOULDER", "LONG", "WAIST"] as const;
/** 发型：无内在序，取值顺序仅决定界面 chip 的排列；「需要多长头发才成立」由 ecom-skill 的约束声明。 */
export const MODEL_HAIRSTYLES = ["SLEEK_STRAIGHT", "SOFT_WAVE", "DEEP_CURL", "HIGH_BUN", "PONYTAIL", "TEXTURED_FRINGE", "BRAIDED", "AFRO", "SHAVED", "PIXIE", "SLICKED_BACK", "LAYERED_LONG", "HIME_CUT", "HALF_UP", "TWIN_TAILS", "SPACE_BUNS", "LOW_BUN"] as const;
export const MODEL_HAIR_COLORS = ["INK_BLACK", "ESPRESSO", "CHESTNUT", "LIGHT_BROWN", "HONEY_BLONDE", "STRAWBERRY_BLONDE", "ASH_BROWN", "COPPER", "BURGUNDY", "PLATINUM", "SILVER", "MILK_TEA", "ASH_BLONDE"] as const;
export const MODEL_HAIR_TEXTURES = ["SLEEK_GLOSSY", "NATURAL_VOLUME", "TOUSLED", "WET_LOOK"] as const;
/** 发际线：正面定妆照里辨识度仅次于五官的身份线索，不锁定会让同一张脸换个角度就走形。 */
export const MODEL_HAIRLINES = ["ROUNDED", "SQUARE", "WIDOWS_PEAK", "RECEDING", "HIGH_FOREHEAD"] as const;
export const MODEL_COMPLEXIONS = ["PORCELAIN", "FAIR_WARM", "LIGHT_NEUTRAL", "MEDIUM_OLIVE", "HONEY", "CARAMEL", "DEEP", "DEEP_EBONY"] as const;
export const MODEL_SKIN_TEXTURES = ["NATURAL_PORES", "DEWY", "MATTE_FINE", "FRECKLED", "MATURE_LINES"] as const;
/** 胡须自无须到浓密的序：男性模特的身份锚点，也是「童模不得有胡须」这类约束的判定基准。 */
export const MODEL_FACIAL_HAIRS = ["NONE", "STUBBLE", "MUSTACHE", "GOATEE", "BEARD", "FULL_BEARD"] as const;
export const MODEL_MARKS = ["FRECKLES_NOSE", "FRECKLES_CHEEKS", "MOLE_CHEEK", "TEAR_MOLE", "DIMPLES", "BEAUTY_MARK_LIP", "BIRTHMARK", "SUBTLE_ASYMMETRY", "AEGYO_SAL", "BROW_SCAR"] as const;

// ---- 层 3 表达层：神态、气质、妆容与定妆基础穿搭 ----
export const MODEL_EXPRESSIONS = ["CALM_DIRECT", "SOFT_SMILE", "BRIGHT_GRIN", "WARM_LAUGH", "EDITORIAL_DISTANCE", "THOUGHTFUL", "TENDER", "SURPRISED"] as const;
export const MODEL_GAZES = ["DIRECT_TO_CAMERA", "OFF_CAMERA", "LOWERED_LIDS", "HALF_LID_IDLE"] as const;
export const MODEL_AURAS = ["WARM_APPROACHABLE", "QUIET_CONFIDENCE", "METROPOLITAN", "PLAYFUL", "SERENE", "ARTSY", "POLISHED", "FRESH"] as const;
export const MODEL_MAKEUPS = ["NONE", "MINIMAL_DEWY", "EVERYDAY", "SOFT_GLAM", "RED_LIP", "SMOKY", "MATURE"] as const;
export const MODEL_WARDROBES = ["WHITE_TANK", "BLACK_TURTLENECK", "WHITE_SHIRT", "NEUTRAL_TEE", "BLAZER_SHIRT", "RIBBED_DRESS", "SLEEVELESS_KNIT", "HOODIE"] as const;

// ---- 层 4 镜头呈现：定妆照的景别、姿态、背景与命名光照 ----
/** 景别自全景到特写的序：姿态声明「至少要拍到哪」时按它比较，特写下拍不到的姿态据此排除。 */
export const MODEL_FRAMINGS = ["FULL_BODY", "THREE_QUARTER", "WAIST_UP", "BEAUTY_CLOSEUP"] as const;
export const MODEL_POSES = ["WEIGHT_LEFT_HIP", "NATURAL_WALK", "LEANING_WALL", "SEATED_STOOL", "HANDS_RELAXED", "HANDS_ON_HIPS", "ARMS_CROSSED", "OVER_SHOULDER", "HANDS_IN_POCKETS", "HAIR_TOUCH"] as const;
export const MODEL_BACKDROPS = ["SEAMLESS_GREY", "PURE_WHITE", "CREAM", "WARM_BEIGE", "OUTDOOR_BOKEH", "PALE_PINK", "SLATE_BLUE", "CHARCOAL"] as const;
export const MODEL_LIGHTINGS = ["SOFTBOX_THREE_POINT", "WINDOW_DAYLIGHT", "OVERCAST_DIFFUSED", "GOLDEN_BACKLIT", "RING_LIGHT", "DRAMATIC_SIDE", "HIGH_KEY_STUDIO", "BUTTERFLY_LIGHT"] as const;
export const MODEL_LENSES = ["LENS_35", "LENS_50", "LENS_85", "LENS_105"] as const;

const specValue = <T extends string>(values: readonly T[]) => Type.Union(values.map((value) => Type.Literal(value)));

export const ModelSpec = Type.Object({
  gender: specValue(MODEL_GENDERS),
  age: specValue(MODEL_AGES),
  heritage: specValue(MODEL_HERITAGES),
  stature: specValue(MODEL_STATURES),
  build: specValue(MODEL_BUILDS),
  faceShape: specValue(MODEL_FACE_SHAPES),
  eyeShape: specValue(MODEL_EYE_SHAPES),
  eyeColor: specValue(MODEL_EYE_COLORS),
  browShape: specValue(MODEL_BROW_SHAPES),
  noseShape: specValue(MODEL_NOSE_SHAPES),
  lipShape: specValue(MODEL_LIP_SHAPES),
  hairLength: specValue(MODEL_HAIR_LENGTHS),
  hairstyle: specValue(MODEL_HAIRSTYLES),
  hairColor: specValue(MODEL_HAIR_COLORS),
  hairTexture: specValue(MODEL_HAIR_TEXTURES),
  hairline: specValue(MODEL_HAIRLINES),
  complexion: specValue(MODEL_COMPLEXIONS),
  skinTexture: specValue(MODEL_SKIN_TEXTURES),
  facialHair: specValue(MODEL_FACIAL_HAIRS),
  distinctiveMarks: Type.Array(specValue(MODEL_MARKS), { maxItems: MODEL_MARKS_MAX }),
  expression: specValue(MODEL_EXPRESSIONS),
  gaze: specValue(MODEL_GAZES),
  aura: Type.Array(specValue(MODEL_AURAS), { maxItems: MODEL_AURA_MAX }),
  makeup: specValue(MODEL_MAKEUPS),
  baseWardrobe: specValue(MODEL_WARDROBES),
  framing: specValue(MODEL_FRAMINGS),
  pose: specValue(MODEL_POSES),
  backdrop: specValue(MODEL_BACKDROPS),
  lighting: specValue(MODEL_LIGHTINGS),
  lens: specValue(MODEL_LENSES),
}, { $id: "#/components/schemas/ModelSpec", description: "四层结构化模特规格：身份内核 / 容貌细节 / 表达层 / 镜头呈现。定妆照 prompt 由该规格确定性编译；维度之间存在互斥约束，判定单源在 packages/ecom-skill。" });
export type ModelSpec = Static<typeof ModelSpec>;

/**
 * 基准款：设计器允许维度留空（至少显式选择 5 项），提交前用这份基准补全成完整 spec，
 * 因此 ModelSpec 合约本身保持全字段必填，编译器与 Worker 永远消费完整规格。
 *
 * 刻意逐项写死而不取各维元组首值：元组首值是「枚举起点」而非「可生成的组合」，
 * 直接拼会得到「利落短发 + 黑长直」这类自相矛盾的基准（发长与发型互斥），
 * 也会把未指定年龄的模特默认成 7 岁童模。基准必须自身通过互斥校验，
 * 否则「留空维度按基准款生成」会静默产出矛盾的提示词。
 *
 * 冻结（含两个数组）：这份基准被预设列表、设计器补全与 React state 直接引用，
 * 一次就地改动就会改写全站基准；冻结让越界写入在开发期立刻抛错而不是静默生效。
 */
const MODEL_SPEC_DEFAULTS_SOURCE: ModelSpec = {
  gender: "FEMALE",
  age: "LATE_20S",
  heritage: "EAST_ASIAN",
  stature: "STANDARD_165",
  build: "BALANCED",
  faceShape: "OVAL",
  eyeShape: "ALMOND",
  eyeColor: "DARK_BROWN",
  browShape: "STRAIGHT_SOFT",
  noseShape: "STRAIGHT",
  lipShape: "NATURAL",
  hairLength: "SHOULDER",
  hairstyle: "SOFT_WAVE",
  hairColor: "INK_BLACK",
  hairTexture: "NATURAL_VOLUME",
  hairline: "ROUNDED",
  complexion: "FAIR_WARM",
  skinTexture: "NATURAL_PORES",
  facialHair: "NONE",
  distinctiveMarks: [],
  expression: "CALM_DIRECT",
  gaze: "DIRECT_TO_CAMERA",
  aura: ["WARM_APPROACHABLE"],
  makeup: "MINIMAL_DEWY",
  baseWardrobe: "WHITE_TANK",
  framing: "THREE_QUARTER",
  pose: "HANDS_RELAXED",
  backdrop: "SEAMLESS_GREY",
  lighting: "SOFTBOX_THREE_POINT",
  lens: "LENS_50",
};
Object.freeze(MODEL_SPEC_DEFAULTS_SOURCE.distinctiveMarks);
Object.freeze(MODEL_SPEC_DEFAULTS_SOURCE.aura);
export const MODEL_SPEC_DEFAULTS: ModelSpec = Object.freeze(MODEL_SPEC_DEFAULTS_SOURCE);

export const ModelPortrait = Type.Object({
  id: Type.String({ format: "uuid" }),
  modelId: Type.String({ format: "uuid" }),
  url: Type.Optional(Type.String({ description: "定妆照静态访问地址；仅列表与详情响应携带。" })),
  width: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  height: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
  providerId: Type.String({ format: "uuid" }),
  imageModelId: Type.String(),
  aspectRatio: schemaRef(ImageAspectRatio),
  selected: Type.Boolean({ description: "定妆照标记；每个模特至多一张被选定。" }),
  createdAt: Type.String({ format: "date-time" }),
}, { $id: "#/components/schemas/ModelPortrait" });
export type ModelPortrait = Static<typeof ModelPortrait>;

export const EcomModel = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String(),
  spec: schemaRef(ModelSpec),
  notes: Type.String(),
  hasReferenceFace: Type.Boolean({ description: "是否已上传参考脸；有则该脸是后续生成的唯一身份基准。" }),
  referenceFaceUrl: Type.Optional(Type.String()),
  selectedPortrait: Type.Optional(Type.Union([schemaRef(ModelPortrait), Type.Null()])),
  portraitCount: Type.Integer({ minimum: 0 }),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
}, { $id: "#/components/schemas/EcomModel" });
export type EcomModel = Static<typeof EcomModel>;

export const ModelList = Type.Object({ items: Type.Array(schemaRef(EcomModel)), nextCursor: Type.Union([Type.String(), Type.Null()]) }, { $id: "#/components/schemas/ModelList" });
export type ModelList = Static<typeof ModelList>;

export const ModelPortraitList = Type.Object({ items: Type.Array(schemaRef(ModelPortrait)) }, { $id: "#/components/schemas/ModelPortraitList" });
export type ModelPortraitList = Static<typeof ModelPortraitList>;

export const CreateModelInput = Type.Object({
  name: Type.String({ minLength: 1, maxLength: MAX_MODEL_NAME_LENGTH }),
  spec: schemaRef(ModelSpec),
  notes: Type.Optional(Type.String({ maxLength: MAX_MODEL_NOTES_LENGTH })),
}, { $id: "#/components/schemas/CreateModelInput" });
export type CreateModelInput = Static<typeof CreateModelInput>;

export const UpdateModelInput = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_MODEL_NAME_LENGTH })),
  spec: Type.Optional(schemaRef(ModelSpec)),
  notes: Type.Optional(Type.String({ maxLength: MAX_MODEL_NOTES_LENGTH })),
}, { $id: "#/components/schemas/UpdateModelInput" });
export type UpdateModelInput = Static<typeof UpdateModelInput>;

export const CreateModelCastJobInput = Type.Object({
  providerId: Type.String({ format: "uuid" }),
  imageModelId: Type.String({ minLength: 1 }),
  aspectRatio: schemaRef(ImageAspectRatio),
  candidateCount: Type.Optional(Type.Integer({ minimum: 1, maximum: MODEL_CAST_CANDIDATES_MAX, default: 1 })),
}, { $id: "#/components/schemas/CreateModelCastJobInput", description: "发起一次选角生成：按模特当前 spec 编译定妆照 prompt，产出 candidateCount 张候选。" });
export type CreateModelCastJobInput = Static<typeof CreateModelCastJobInput>;
