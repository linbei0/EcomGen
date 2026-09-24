import {
  MODEL_AGES,
  MODEL_AURA_MAX,
  MODEL_FRAMINGS,
  MODEL_HAIR_LENGTHS,
  MODEL_MARKS_MAX,
  MODEL_SPEC_DEFAULTS,
  type ModelSpec,
} from "@ecomgen/contracts";

/**
 * 模特选角的确定性 prompt 编译层。
 *
 * 设计原则（与手写分镜模板不同）：
 * - spec 即合约：ModelSpec 是持久化结构化数据，本文件把 spec 纯函数地编译为定妆照
 *   prompt——同 spec 重算结果逐字节一致，下游任何生成都能复原同一 persona block。
 * - 选项单源：MODEL_SPEC_FIELDS 同时承载中文界面标签与英文摄影词汇，前端设计器与
 *   本编译器共用一份数据，不会各自漂移。
 * - 互斥即数据：维度之间的互斥（短发配不了高盘发、童模不带胡须、面部特写拍不到走动）
 *   以声明式约束挂在选项上，由本文件的判定引擎统一求值。UI 的禁用态、保存前的收敛、
 *   API 的入参校验都取自同一份判定，不在三处各写一遍规则。
 * - 长度纪律：编译产物控制在 250 词以内的流畅段落（超预算时按「不对称细节 → 特色标记 →
 *   气质联动段」顺序丢弃可选项，notes 作为用户硬性要求始终保留、不计入预算）。预算内
 *   不裁剪任何维度：完整规格的全部可选段都能保留下来。
 * - 真实感优先：年龄与体型用具体数字锚定，肤质走正向替代（毛孔、未修图）而非否定式
 *   套话，气质在编译层展开为姿态神情联动子句——不给模型留「漂亮但假」的空间。
 * - 负面约束收尾：结尾一句具体伪影清单（手指/肢体/水印文字/非摄影渲染），与分镜规划器
 *   给 promptInstruction 定的顺序一致。只写可命名的伪影，且不否定本层正面要的东西
 *   （例如命名不对称细节），避免身份指令与负面清单互相抵消。
 */

export interface ModelOptionDef {
  /** 界面中文文案。 */
  label: string;
  /** 进入 prompt 的英文摄影词汇片段。 */
  prompt: string;
  /** 身份句角色名词；仅年龄维度使用，区分成人「fashion model」与童模档位。 */
  noun?: string;
  /** 气质联动子句（仅 aura 选项使用）：编译期展开为姿态与神情描述，不覆盖显式布光/背景。 */
  expand?: string;
  /** 与本规格其余维度之间的互斥约束；不写即无约束。 */
  constraints?: ModelOptionConstraints;
}

/**
 * 选项级互斥约束。全部可选，声明式——判定只在这份数据上进行，没有第二处硬编码规则。
 *
 * 取值都取「目标维度」的语义，比较按 contracts 元组顺序（序即语义：发长由短到长、
 * 年龄由小到大、景别由全景到特写），因此新增枚举值不会漏掉任何已有规则的判定。
 */
export interface ModelOptionConstraints {
  /** 仅这些性别呈现可选。 */
  gender?: readonly ModelSpec["gender"][];
  /** 需要达到的最小年龄档。 */
  minAge?: ModelSpec["age"];
  /** 需要达到的最小发长（例如高盘发至少要有齐肩长度）。 */
  minHairLength?: ModelSpec["hairLength"];
  /** 允许的最大发长（例如寸头与及腰长发不能同时成立）。 */
  maxHairLength?: ModelSpec["hairLength"];
  /** 需要达到的最小取景范围（例如自然走动必须拍到全身）；特写排除了拍不到的姿态。 */
  minFraming?: ModelSpec["framing"];
  /** 与指定维度的取值直接互斥。 */
  excludes?: Partial<Record<keyof ModelSpec, readonly string[]>>;
}

/** 维度级规则：整个维度在某些条件下不参与，而不是某个取值互斥。 */
interface ModelFieldRule {
  minAge?: ModelSpec["age"];
  /** 展示给用户的原因；这类维度在编译期就被省略，属于「不适用」而非「矛盾」。 */
  reason: string;
}

export type ModelSpecKey = keyof ModelSpec;

/** 互斥判定的两种严重度：conflict 会导致自相矛盾的提示词，inapplicable 只是该维度不参与。 */
export type ModelConstraintKind = "conflict" | "inapplicable";


export type ModelSpecLayerId = "identity" | "features" | "expression" | "camera";

export interface ModelSpecFieldDef<K extends keyof ModelSpec = keyof ModelSpec> {
  label: string;
  layer: ModelSpecLayerId;
  options: Record<ModelSpec[K] & string, ModelOptionDef>;
}

/** 多选字段（spec 值为字符串数组）的定义；options 以元素取值为键。 */
export type ModelSpecMultiKey = "distinctiveMarks" | "aura";
export interface ModelSpecMultiFieldDef<K extends ModelSpecMultiKey = ModelSpecMultiKey> {
  label: string;
  layer: ModelSpecLayerId;
  options: Record<ModelSpec[K][number] & string, ModelOptionDef>;
}

/** 单选层的中文层名与说明；层序即 prompt 段序。 */
export const MODEL_SPEC_LAYERS: ReadonlyArray<{ id: ModelSpecLayerId; title: string; hint: string }> = [
  { id: "identity", title: "身份内核", hint: "决定这个模特是谁——全站复用时不能漂移的部分。" },
  { id: "features", title: "容貌细节", hint: "五官、发型与肤质；轻微不对称让脸更像真人。" },
  { id: "expression", title: "表达层", hint: "神态、气质与定妆基础穿搭，决定品牌调性。" },
  { id: "camera", title: "镜头呈现", hint: "定妆照的景别、姿态、背景与布光方案。" },
];

// ---- 层 1 身份内核 ----
const GENDER: ModelSpecFieldDef<"gender"> = {
  label: "性别呈现", layer: "identity",
  options: {
    FEMALE: { label: "女", prompt: "female" },
    MALE: { label: "男", prompt: "male" },
    ANDROGYNOUS: { label: "中性", prompt: "androgynous" },
  },
};
// 年龄用具体数字而非区间词锚定：生图模型对「28-year-old」的响应远比「around」类模糊词稳定。
const AGE: ModelSpecFieldDef<"age"> = {
  label: "年龄段", layer: "identity",
  options: {
    CHILD_7: { label: "儿童 7 岁上下", prompt: "a 7-year-old", noun: "child model" },
    PRETEEN_11: { label: "少年 11 岁上下", prompt: "an 11-year-old", noun: "preteen model" },
    TEEN_16: { label: "青少年 16 岁上下", prompt: "a 16-year-old", noun: "teen model" },
    EARLY_20S: { label: "22 岁上下", prompt: "a 22-year-old" },
    LATE_20S: { label: "28 岁上下", prompt: "a 28-year-old" },
    EARLY_30S: { label: "32 岁上下", prompt: "a 32-year-old" },
    MID_30S: { label: "35 岁上下", prompt: "a 35-year-old" },
    MID_40S: { label: "45 岁上下", prompt: "a 46-year-old" },
    SENIOR: { label: "60 岁上下", prompt: "a 63-year-old" },
  },
};
const HERITAGE: ModelSpecFieldDef<"heritage"> = {
  label: "族裔气质", layer: "identity",
  options: {
    EAST_ASIAN: { label: "东亚", prompt: "East Asian" },
    SOUTHEAST_ASIAN: { label: "东南亚", prompt: "Southeast Asian" },
    SOUTH_ASIAN: { label: "南亚", prompt: "South Asian" },
    MIDDLE_EASTERN: { label: "中东", prompt: "Middle Eastern" },
    NORTHERN_EUROPEAN: { label: "北欧", prompt: "Northern European" },
    MEDITERRANEAN: { label: "地中海", prompt: "Mediterranean" },
    LATIN_AMERICAN: { label: "拉美", prompt: "Latin American" },
    AFRICAN: { label: "非洲", prompt: "African" },
    MIXED: { label: "混血", prompt: "mixed-heritage" },
  },
};
const STATURE: ModelSpecFieldDef<"stature"> = {
  label: "身高体感", layer: "identity",
  options: {
    PETITE_158: { label: "娇小 158cm", prompt: "a petite 158cm frame" },
    STANDARD_165: { label: "标准 165cm", prompt: "a standard 165cm frame" },
    TALL_172: { label: "高挑 172cm", prompt: "a tall 172cm frame" },
    // 超模体感需要成年的骨架：与童模档位互斥，否则会写出「16 岁超模骨架」这类失真描述。
    RUNWAY_180: { label: "超模 180cm", prompt: "a runway-scale 180cm frame", constraints: { minAge: "TEEN_16" } },
  },
};
const BUILD: ModelSpecFieldDef<"build"> = {
  label: "体型", layer: "identity",
  options: {
    SLENDER: { label: "纤细", prompt: "a slender build" },
    BALANCED: { label: "匀称", prompt: "balanced proportions" },
    ATHLETIC: { label: "健美", prompt: "an athletic, toned build" },
    MUSCULAR: { label: "健硕", prompt: "a muscular, powerfully built frame" },
    CURVY: { label: "曲线", prompt: "a curvy build" },
    PLUS: { label: "大码", prompt: "a plus-size build" },
    MATERNITY: { label: "孕味", prompt: "a gently expectant maternity silhouette", constraints: { gender: ["FEMALE"], minAge: "EARLY_20S" } },
  },
};

// ---- 层 2 容貌细节 ----
const FACE_SHAPE: ModelSpecFieldDef<"faceShape"> = {
  label: "脸型", layer: "features",
  // 脸型是 features 句里唯一被编译器用 "with" 直接接下一个维度的取值，片段内再出现 "with"
  // 会拼出 "a round face with soft cheeks with dark brown eyes"：把附加特征改写成并列短语。
  options: {
    OVAL: { label: "鹅蛋脸", prompt: "an oval face" },
    ROUND: { label: "圆脸", prompt: "a softly rounded face" },
    SQUARE_JAW: { label: "方脸", prompt: "a square jawline" },
    HEART: { label: "心形脸", prompt: "a heart-shaped face" },
    LONG: { label: "长脸", prompt: "an elongated face" },
    DIAMOND: { label: "菱形脸", prompt: "a diamond-shaped face and high cheekbones" },
  },
};
const EYE_SHAPE: ModelSpecFieldDef<"eyeShape"> = {
  label: "眼型", layer: "features",
  options: {
    ALMOND: { label: "杏眼", prompt: "almond-shaped eyes" },
    ROUND: { label: "圆眼", prompt: "round eyes" },
    MONOLID: { label: "单眼皮", prompt: "monolid eyes" },
    UPTURNED: { label: "丹凤眼", prompt: "upturned eyes" },
    DOWNTURNED: { label: "下垂眼", prompt: "gently downturned eyes" },
    NARROW: { label: "细长眼", prompt: "narrow, elongated eyes" },
    DEEP_SET: { label: "深邃眼窝", prompt: "deep-set eyes" },
    PEACH_BLOSSOM: { label: "桃花眼", prompt: "soft peach-blossom eyes with a gentle outer curve" },
    INNER_DOUBLE: { label: "内双", prompt: "a subtle inner double eyelid" },
  },
};
const EYE_COLOR: ModelSpecFieldDef<"eyeColor"> = {
  label: "瞳色", layer: "features",
  options: {
    DARK_BROWN: { label: "墨黑", prompt: "dark brown" },
    AMBER: { label: "琥珀", prompt: "amber" },
    HAZEL: { label: "浅褐", prompt: "hazel" },
    GREEN: { label: "绿", prompt: "green" },
    BLUE: { label: "灰蓝", prompt: "grey-blue" },
    GREY: { label: "灰", prompt: "grey" },
  },
};
const BROW_SHAPE: ModelSpecFieldDef<"browShape"> = {
  label: "眉形", layer: "features",
  options: {
    STRAIGHT_SOFT: { label: "平眉", prompt: "soft straight brows" },
    ARCED: { label: "挑眉", prompt: "gently arched brows" },
    FEATHERED: { label: "野生眉", prompt: "feathered natural brows" },
    BOLD: { label: "剑眉", prompt: "bold defined brows" },
    THIN_ARCHED: { label: "细挑眉", prompt: "thin, finely arched brows" },
    WILLOW: { label: "柳叶眉", prompt: "soft willow-leaf brows" },
    THICK_STRAIGHT: { label: "浓直眉", prompt: "thick, straight brows" },
  },
};
const NOSE_SHAPE: ModelSpecFieldDef<"noseShape"> = {
  label: "鼻型", layer: "features",
  options: {
    DELICATE: { label: "秀气小巧", prompt: "a delicate nose" },
    STRAIGHT: { label: "挺直", prompt: "a straight nose bridge" },
    SCULPTED: { label: "高挺", prompt: "a sculpted nose" },
    BROAD: { label: "宽厚", prompt: "a broader nose" },
    UPTURNED: { label: "微翘", prompt: "a slightly upturned nose" },
    AQUILINE: { label: "鹰钩", prompt: "a high, aquiline nose" },
    BULBOUS: { label: "圆润鼻头", prompt: "a rounded nose with a soft tip" },
  },
};
const LIP_SHAPE: ModelSpecFieldDef<"lipShape"> = {
  label: "唇形", layer: "features",
  options: {
    NATURAL: { label: "标准唇", prompt: "natural lips" },
    FULL: { label: "丰唇", prompt: "full lips" },
    BOW: { label: "花瓣唇", prompt: "a defined cupid's bow" },
    WIDE: { label: "宽唇", prompt: "a wide mouth" },
    THIN: { label: "薄唇", prompt: "thin, delicate lips" },
  },
};
const HAIR_LENGTH: ModelSpecFieldDef<"hairLength"> = {
  label: "发长", layer: "features",
  options: {
    CROP: { label: "利落短发", prompt: "cropped hair" },
    CHIN_BOB: { label: "齐耳波波头", prompt: "a chin-length bob" },
    SHOULDER: { label: "齐肩", prompt: "shoulder-length hair" },
    LONG: { label: "长发", prompt: "long hair" },
    WAIST: { label: "及腰超长", prompt: "waist-length hair" },
  },
};
/*
 * 发型的长度约束是这一层最容易出错的地方：短发配不上盘发与马尾，寸头与及腰长发互斥。
 * 约束用「最小/最大发长」表达而非逐个枚举禁用组合，新增发长档位时规则自动覆盖；
 * 一切能扎起来、盘起来的造型（马尾、双马尾、丸子头、盘发、半扎发）共用一个齐肩下界。
 */
const HAIRSTYLE: ModelSpecFieldDef<"hairstyle"> = {
  label: "发型", layer: "features",
  options: {
    SLEEK_STRAIGHT: { label: "黑长直", prompt: "sleek straight styling", constraints: { minHairLength: "SHOULDER" } },
    SOFT_WAVE: { label: "微卷", prompt: "soft waves", constraints: { minHairLength: "CHIN_BOB" } },
    DEEP_CURL: { label: "大波浪", prompt: "deep curls", constraints: { minHairLength: "LONG" } },
    HIGH_BUN: { label: "高盘发", prompt: "a high bun", constraints: { minHairLength: "SHOULDER" } },
    PONYTAIL: { label: "低马尾", prompt: "a low ponytail", constraints: { minHairLength: "SHOULDER" } },
    // 刘海长在额前，任何发长都成立。它只遮住发际线中段，不与发际线互斥：
    // ModelSpec 全维度必填，若在此声明「遮住发际线」会让这个发型永远不可用。
    TEXTURED_FRINGE: { label: "空气刘海", prompt: "a textured fringe with a few flyaways" },
    BRAIDED: { label: "编发", prompt: "braided styling with neat, even plaits", constraints: { minHairLength: "SHOULDER" } },
    AFRO: { label: "爆炸头", prompt: "a full natural afro", constraints: { maxHairLength: "SHOULDER" } },
    SHAVED: { label: "寸头", prompt: "a closely shaved head", constraints: { maxHairLength: "CROP" } },
    PIXIE: { label: "精灵短发", prompt: "a short pixie cut", constraints: { maxHairLength: "CROP" } },
    // 油头背头在短发与长发上都成立（短背头与长发背头都是真实造型），刻意不设长度约束。
    SLICKED_BACK: { label: "油头背头", prompt: "slicked straight back with a polished finish" },
    LAYERED_LONG: { label: "层次长发", prompt: "long layers that break at the collarbone", constraints: { minHairLength: "LONG" } },
    HIME_CUT: { label: "公主切", prompt: "a hime cut with blunt cheek-length side locks", constraints: { minHairLength: "LONG" } },
    HALF_UP: { label: "半扎发", prompt: "a half-up, half-down style with the top pulled back", constraints: { minHairLength: "SHOULDER" } },
    TWIN_TAILS: { label: "双马尾", prompt: "twin tails tied on either side", constraints: { minHairLength: "SHOULDER" } },
    SPACE_BUNS: { label: "双丸子头", prompt: "two symmetric space buns set on the crown", constraints: { minHairLength: "SHOULDER" } },
    LOW_BUN: { label: "低盘发", prompt: "a low, softly wrapped chignon", constraints: { minHairLength: "SHOULDER" } },
  },
};
const HAIRLINE: ModelSpecFieldDef<"hairline"> = {
  label: "发际线", layer: "features",
  options: {
    ROUNDED: { label: "圆润", prompt: "a softly rounded hairline" },
    SQUARE: { label: "方正", prompt: "a squarer hairline" },
    WIDOWS_PEAK: { label: "美人尖", prompt: "a defined widow's peak" },
    RECEDING: { label: "后移", prompt: "a receding hairline" },
    HIGH_FOREHEAD: { label: "高额头", prompt: "a high forehead" },
  },
};
const HAIR_COLOR: ModelSpecFieldDef<"hairColor"> = {
  label: "发色", layer: "features",
  options: {
    INK_BLACK: { label: "自然黑", prompt: "ink black" },
    ESPRESSO: { label: "深棕", prompt: "espresso brown" },
    CHESTNUT: { label: "栗棕", prompt: "chestnut" },
    LIGHT_BROWN: { label: "浅棕", prompt: "light brown" },
    HONEY_BLONDE: { label: "浅金", prompt: "honey blonde" },
    STRAWBERRY_BLONDE: { label: "草莓金", prompt: "strawberry blonde" },
    ASH_BROWN: { label: "亚麻", prompt: "ash brown" },
    COPPER: { label: "酒红铜", prompt: "copper red" },
    BURGUNDY: { label: "浆果红", prompt: "deep burgundy" },
    PLATINUM: { label: "白金", prompt: "platinum blonde" },
    SILVER: { label: "银灰", prompt: "silver grey" },
    MILK_TEA: { label: "奶茶棕", prompt: "milk-tea brown" },
    ASH_BLONDE: { label: "灰金", prompt: "ash blonde" },
  },
};
// 发质独立于发型：同一剪裁可呈现完全不同的发丝质感，是扩大多元度的低冲突维度。
const HAIR_TEXTURE: ModelSpecFieldDef<"hairTexture"> = {
  label: "发质", layer: "features",
  options: {
    SLEEK_GLOSSY: { label: "柔顺光泽", prompt: "sleek glossy strands" },
    NATURAL_VOLUME: { label: "蓬松自然", prompt: "natural body and volume" },
    TOUSLED: { label: "凌乱质感", prompt: "tousled, lived-in texture" },
    WET_LOOK: { label: "湿发造型", prompt: "a wet-look finish" },
  },
};
const COMPLEXION: ModelSpecFieldDef<"complexion"> = {
  label: "肤色", layer: "features",
  options: {
    PORCELAIN: { label: "冷白", prompt: "porcelain-fair skin" },
    FAIR_WARM: { label: "自然白", prompt: "warm fair skin" },
    LIGHT_NEUTRAL: { label: "暖黄", prompt: "light neutral skin" },
    MEDIUM_OLIVE: { label: "小麦", prompt: "medium olive skin" },
    HONEY: { label: "蜜色", prompt: "honey-toned skin" },
    CARAMEL: { label: "浅棕", prompt: "caramel skin" },
    DEEP: { label: "深棕", prompt: "a deep skin tone" },
    DEEP_EBONY: { label: "深黑", prompt: "deep ebony skin" },
  },
};
const SKIN_TEXTURE: ModelSpecFieldDef<"skinTexture"> = {
  label: "肤质", layer: "features",
  options: {
    NATURAL_PORES: { label: "真实毛孔", prompt: "realistic skin texture with visible pores and subtle imperfections, unretouched" },
    DEWY: { label: "水光感", prompt: "a dewy finish" },
    MATTE_FINE: { label: "细腻哑光", prompt: "a fine matte surface" },
    FRECKLED: { label: "自然斑点", prompt: "a lightly freckled surface" },
    MATURE_LINES: { label: "岁月纹理", prompt: "natural expression lines and a lived-in, unretouched skin texture", constraints: { minAge: "MID_30S" } },
  },
};
// 胡须是男性模特的身份锚点，也是与年龄、性别最容易冲突的维度：童模不得有胡须，
// 浓密胡须需要成年男性的骨相，因此每档都声明性别与年龄下界。
const FACIAL_HAIR: ModelSpecFieldDef<"facialHair"> = {
  label: "胡须", layer: "features",
  options: {
    NONE: { label: "无须", prompt: "clean-shaven" },
    STUBBLE: { label: "短胡茬", prompt: "light, even stubble", constraints: { gender: ["MALE", "ANDROGYNOUS"], minAge: "TEEN_16" } },
    MUSTACHE: { label: "唇上胡", prompt: "a trimmed moustache", constraints: { gender: ["MALE"], minAge: "EARLY_20S" } },
    GOATEE: { label: "山羊胡", prompt: "a trimmed goatee", constraints: { gender: ["MALE"], minAge: "EARLY_20S" } },
    BEARD: { label: "络腮胡", prompt: "a short, well-kept full beard", constraints: { gender: ["MALE"], minAge: "EARLY_20S" } },
    FULL_BEARD: { label: "长络腮胡", prompt: "a dense, grown-out beard", constraints: { gender: ["MALE"], minAge: "LATE_20S" } },
  },
};
const MARKS: ModelSpecMultiFieldDef<"distinctiveMarks"> = {
  label: "特色标记", layer: "features",
  options: {
    FRECKLES_NOSE: { label: "鼻梁雀斑", prompt: "freckles scattered across the nose" },
    FRECKLES_CHEEKS: { label: "颊部雀斑", prompt: "faint freckles across the cheekbones" },
    MOLE_CHEEK: { label: "颊侧痣", prompt: "a small dark mole on the left cheek" },
    TEAR_MOLE: { label: "眼角泪痣", prompt: "a small tear mole under the outer corner of the right eye" },
    DIMPLES: { label: "梨涡", prompt: "dimples when smiling" },
    BEAUTY_MARK_LIP: { label: "唇上美人痣", prompt: "a beauty mark above the lip" },
    BIRTHMARK: { label: "颈部胎记", prompt: "a soft birthmark patch on the side of the neck" },
    SUBTLE_ASYMMETRY: { label: "不对称辨识度", prompt: "distinctive asymmetric features that make the face memorably individual" },
    AEGYO_SAL: { label: "卧蚕", prompt: "soft aegyo-sal highlights beneath the eyes" },
    // 浅淡旧疤是最强的「真人签名」之一：位置固定、不随角度漂移，比泛化的「有特点」更能锁定身份。
    BROW_SCAR: { label: "眉上浅疤", prompt: "a faint, long-healed scar through the left brow" },
  },
};

// ---- 层 3 表达层 ----
const EXPRESSION: ModelSpecFieldDef<"expression"> = {
  label: "表情基调", layer: "expression",
  options: {
    CALM_DIRECT: { label: "自信直视", prompt: "a calm direct gaze" },
    SOFT_SMILE: { label: "微笑", prompt: "a soft closed-lip smile" },
    BRIGHT_GRIN: { label: "浅笑", prompt: "a bright open grin" },
    WARM_LAUGH: { label: "开怀笑", prompt: "a genuine warm laugh with crinkled eyes" },
    EDITORIAL_DISTANCE: { label: "清冷", prompt: "an editorial, composed distance" },
    THOUGHTFUL: { label: "专注", prompt: "a thoughtful, pensive look" },
    TENDER: { label: "温柔", prompt: "a soft, tender expression" },
    SURPRISED: { label: "惊喜", prompt: "a bright, open look of pleasant surprise" },
  },
};
// 目光方向独立于表情基调：同一表情可朝向镜头或离镜，是叙事感的关键维度。
const GAZE: ModelSpecFieldDef<"gaze"> = {
  label: "目光方向", layer: "expression",
  options: {
    DIRECT_TO_CAMERA: { label: "直视镜头", prompt: "eyes locked directly into the camera" },
    OFF_CAMERA: { label: "视线离镜", prompt: "gaze drifting off-camera" },
    LOWERED_LIDS: { label: "低垂眼帘", prompt: "gaze lowered with relaxed lids" },
    HALF_LID_IDLE: { label: "半阖慵懒", prompt: "a half-lidded, languid gaze" },
  },
};
// 气质不是孤立形容词：expand 在编译期联动展开为姿态与神情子句（不覆盖用户显式的布光/背景），
// 把「气质关键词」变成可执行的拍摄指令。
const AURA: ModelSpecMultiFieldDef<"aura"> = {
  label: "气质关键词", layer: "expression",
  options: {
    WARM_APPROACHABLE: { label: "亲和", prompt: "warm and approachable", expand: "open, relaxed shoulders and an easy warmth that reaches the eyes" },
    QUIET_CONFIDENCE: { label: "高级感", prompt: "quietly confident", expand: "a still, grounded stance and an unhurried self-possession" },
    METROPOLITAN: { label: "都市", prompt: "polished metropolitan energy", expand: "a tall spine, crisp lines and economical gestures" },
    PLAYFUL: { label: "元气", prompt: "a playful spark", expand: "a lively head tilt and animated eyes" },
    SERENE: { label: "知性", prompt: "serene", expand: "level calm and an unhurried stillness" },
    ARTSY: { label: "文艺", prompt: "an artsy, independent streak", expand: "a slightly off-axis stance and a candid, self-possessed air" },
    POLISHED: { label: "干练", prompt: "polished and capable", expand: "a straight, businesslike posture with hands held deliberately" },
    FRESH: { label: "清新", prompt: "fresh and clean-cut", expand: "clean, unhurried energy and a bright, open face" },
  },
};
/*
 * 妆容的年龄下界是合规问题而不只是审美问题：面向童模的广告物料不做成妆。
 * 素颜全年龄可用，日常淡妆从少年起，其余浓妆一律要求 16 岁以上。
 */
const MAKEUP: ModelSpecFieldDef<"makeup"> = {
  label: "妆容", layer: "expression",
  options: {
    NONE: { label: "素颜感", prompt: "no makeup" },
    MINIMAL_DEWY: { label: "日常淡妆", prompt: "minimal dewy makeup", constraints: { minAge: "PRETEEN_11" } },
    EVERYDAY: { label: "通勤裸妆", prompt: "everyday light makeup", constraints: { minAge: "TEEN_16" } },
    SOFT_GLAM: { label: "轻欧美", prompt: "soft glam makeup", constraints: { minAge: "TEEN_16" } },
    RED_LIP: { label: "红唇点睛", prompt: "classic red lipstick as the single makeup statement", constraints: { minAge: "TEEN_16" } },
    SMOKY: { label: "烟熏", prompt: "a smoky eye with softly diffused charcoal shadow", constraints: { minAge: "TEEN_16" } },
    MATURE: { label: "熟龄优雅", prompt: "elegant makeup suited to mature skin", constraints: { minAge: "MID_30S" } },
  },
};
const WARDROBE: ModelSpecFieldDef<"baseWardrobe"> = {
  label: "定妆基础装", layer: "expression",
  options: {
    WHITE_TANK: { label: "白色背心", prompt: "a plain white fitted tank top" },
    BLACK_TURTLENECK: { label: "黑色高领", prompt: "a black turtleneck" },
    WHITE_SHIRT: { label: "白衬衫", prompt: "a crisp white shirt" },
    NEUTRAL_TEE: { label: "素色 T 恤", prompt: "a neutral cotton tee" },
    BLAZER_SHIRT: { label: "西装外套", prompt: "an open grey blazer over a plain tee" },
    RIBBED_DRESS: { label: "针织连衣裙", prompt: "a simple ribbed midi dress" },
    SLEEVELESS_KNIT: { label: "无袖针织", prompt: "a sleeveless ribbed knit top" },
    HOODIE: { label: "连帽卫衣", prompt: "a plain pullover hoodie" },
  },
};

// ---- 层 4 镜头呈现 ----
const FRAMING: ModelSpecFieldDef<"framing"> = {
  label: "景别", layer: "camera",
  options: {
    FULL_BODY: { label: "全身", prompt: "Full-body studio portrait" },
    THREE_QUARTER: { label: "七分身", prompt: "Three-quarter-length portrait" },
    WAIST_UP: { label: "半身", prompt: "Waist-up portrait" },
    BEAUTY_CLOSEUP: { label: "面部特写", prompt: "Beauty close-up portrait" },
  },
};
/*
 * 姿态声明「至少要拍到哪」：走动与坐姿需要腿与坐具，双手叉腰需要手臂与胯，
 * 面部特写下这些全部拍不到，选出来就是一句不会被执行的指令。
 * 正面直立是中性起手姿态，其手足描述属于附带信息，刻意不设下限（面部特写预设依赖它）。
 */
const POSE: ModelSpecFieldDef<"pose"> = {
  label: "姿态", layer: "camera",
  options: {
    WEIGHT_LEFT_HIP: { label: "重心站姿", prompt: "standing with weight shifted onto the left hip, hands relaxed at the sides", constraints: { minFraming: "WAIST_UP" } },
    NATURAL_WALK: { label: "自然走动", prompt: "captured mid-stride in a natural walk, arms swinging freely", constraints: { minFraming: "FULL_BODY" } },
    LEANING_WALL: { label: "倚靠", prompt: "leaning against a wall on one shoulder, hands loose", constraints: { minFraming: "THREE_QUARTER" } },
    SEATED_STOOL: { label: "坐姿", prompt: "seated on a stool with a straight back, forearms resting on the thighs", constraints: { minFraming: "THREE_QUARTER" } },
    HANDS_RELAXED: { label: "正面直立", prompt: "standing square to the camera with hands relaxed at the sides" },
    HANDS_ON_HIPS: { label: "双手叉腰", prompt: "standing with both hands on the hips, elbows out", constraints: { minFraming: "WAIST_UP" } },
    ARMS_CROSSED: { label: "环抱双臂", prompt: "standing with arms loosely crossed, shoulders relaxed", constraints: { minFraming: "WAIST_UP" } },
    OVER_SHOULDER: { label: "回眸", prompt: "turned away from the camera, looking back over one shoulder" },
    HANDS_IN_POCKETS: { label: "手插口袋", prompt: "standing with both hands tucked into pockets", constraints: { minFraming: "WAIST_UP" } },
    HAIR_TOUCH: { label: "手抚发丝", prompt: "one hand lifting the hair away from the temple", constraints: { minFraming: "WAIST_UP" } },
  },
};
const BACKDROP: ModelSpecFieldDef<"backdrop"> = {
  label: "背景", layer: "camera",
  options: {
    SEAMLESS_GREY: { label: "纯净暖灰", prompt: "against a seamless dove-grey studio backdrop" },
    PURE_WHITE: { label: "纯白棚拍", prompt: "against a pure white seamless background" },
    CREAM: { label: "浅奶油", prompt: "against a soft cream backdrop" },
    WARM_BEIGE: { label: "暖米色", prompt: "against a warm beige backdrop" },
    OUTDOOR_BOKEH: { label: "外景虚化", prompt: "outdoors with soft natural bokeh behind the subject" },
    PALE_PINK: { label: "浅粉", prompt: "against a pale blush-pink seamless backdrop" },
    SLATE_BLUE: { label: "雾霾蓝", prompt: "against a muted slate-blue backdrop" },
    CHARCOAL: { label: "深炭灰", prompt: "against a deep charcoal seamless backdrop" },
  },
};
/*
 * 棚内灯具与「外景虚化」不能并存：柔光箱、环形光、蝴蝶光、高调棚光都指涉室内影棚，
 * 与室外背景同时出现会让模型在两者之间摇摆（自然光系列不受此限，室外成立）。
 */
const STUDIO_ONLY_LIGHTING: ModelOptionConstraints = { excludes: { backdrop: ["OUTDOOR_BOKEH"] } };
const LIGHTING: ModelSpecFieldDef<"lighting"> = {
  label: "光线", layer: "camera",
  options: {
    SOFTBOX_THREE_POINT: { label: "柔光箱三点", prompt: "lit with a three-point softbox setup, key light at 45 degrees with soft fill", constraints: STUDIO_ONLY_LIGHTING },
    WINDOW_DAYLIGHT: { label: "自然窗光", prompt: "lit by soft natural window daylight from the left" },
    OVERCAST_DIFFUSED: { label: "阴天散射", prompt: "lit by even overcast diffused daylight" },
    GOLDEN_BACKLIT: { label: "黄昏逆光", prompt: "backlit by golden-hour sun with a warm bounce fill" },
    RING_LIGHT: { label: "环形光", prompt: "lit by a frontal ring light leaving a soft round catchlight in the eyes", constraints: STUDIO_ONLY_LIGHTING },
    DRAMATIC_SIDE: { label: "戏剧侧光", prompt: "lit with dramatic side lighting, one half of the face falling into soft shadow" },
    HIGH_KEY_STUDIO: { label: "高调棚光", prompt: "in a high-key studio setup with shadowless even lighting", constraints: STUDIO_ONLY_LIGHTING },
    BUTTERFLY_LIGHT: { label: "蝴蝶光", prompt: "lit with a butterfly key directly above the lens, casting a soft symmetric shadow under the nose", constraints: STUDIO_ONLY_LIGHTING },
  },
};
// 焦段用成对短语（焦距数字 + 摄影效果），让「镜头画质」可被模型理解而非空洞的器材名词。
const LENS: ModelSpecFieldDef<"lens"> = {
  label: "镜头焦段", layer: "camera",
  options: {
    LENS_35: { label: "35mm 环境", prompt: "a 35mm lens with a touch of environmental context" },
    LENS_50: { label: "50mm 自然", prompt: "a 50mm lens with natural perspective" },
    LENS_85: { label: "85mm 压缩", prompt: "an 85mm lens with slight background compression" },
    LENS_105: { label: "105mm 长焦", prompt: "a 105mm lens with a compressed, flattering falloff" },
  },
};

/** 全部单选维度注册表：前端设计器按 layer 分组渲染，编译器按键取英文词汇。 */
export const MODEL_SPEC_FIELDS: { [K in Exclude<keyof ModelSpec, ModelSpecMultiKey>]: ModelSpecFieldDef<K> } = {
  gender: GENDER, age: AGE, heritage: HERITAGE, stature: STATURE, build: BUILD,
  faceShape: FACE_SHAPE, eyeShape: EYE_SHAPE, eyeColor: EYE_COLOR, browShape: BROW_SHAPE, noseShape: NOSE_SHAPE, lipShape: LIP_SHAPE,
  hairLength: HAIR_LENGTH, hairstyle: HAIRSTYLE, hairColor: HAIR_COLOR, hairTexture: HAIR_TEXTURE, hairline: HAIRLINE,
  complexion: COMPLEXION, skinTexture: SKIN_TEXTURE, facialHair: FACIAL_HAIR,
  expression: EXPRESSION, gaze: GAZE, makeup: MAKEUP, baseWardrobe: WARDROBE,
  framing: FRAMING, pose: POSE, backdrop: BACKDROP, lighting: LIGHTING, lens: LENS,
};

/** 多选维度注册表：options 与单选同构，前端用同一套 chip 渲染逻辑。 */
export const MODEL_SPEC_MULTI_FIELD_DEFS: { [K in ModelSpecMultiKey]: ModelSpecMultiFieldDef<K> } = {
  distinctiveMarks: MARKS,
  aura: AURA,
};

/** 多选维度及其上限；上限取 contracts 的 limits 单源，避免两处各写一个数字。 */
export const MODEL_SPEC_MULTI_FIELDS: ReadonlyArray<{ key: ModelSpecMultiKey; max: number }> = [
  { key: "distinctiveMarks", max: MODEL_MARKS_MAX },
  { key: "aura", max: MODEL_AURA_MAX },
];

/**
 * 维度级规则：整个维度在某些年龄下不参与编译（而非某个取值互斥）。
 *
 * stature 的下界必须与编译器 CHILD_AGE_VALUES 的上界对齐：童模档含 16 岁，编译器对
 * 16 岁同样省略身高锚点，规则若只下探到 TEEN_16，界面会展示一个不会被编译的 172cm。
 * 与其让用户选一个不生效的身高，不如在界面上直接标注「不参与」。
 */
const MODEL_FIELD_RULES: Partial<Record<ModelSpecKey, ModelFieldRule>> = {
  stature: { minAge: "EARLY_20S", reason: "童模不输出身高锚点，编译期会省略这一维" },
};

// ---- 互斥判定引擎 ----

/** 设计器里的规格草稿：允许维度未指定，其余与 ModelSpec 同构。 */
export type ModelSpecDraft = Partial<ModelSpec>;

/**
 * 候选取值与当前草稿的关系，两级严重度：
 * - conflict 会写进自相矛盾的提示词（短发配高盘发、童模配红唇），必须在保存前拦下；
 * - inapplicable 只是该维度在此规格下不参与编译（童模的身高锚点），不算错误。
 */
export interface ModelOptionIssue {
  kind: ModelConstraintKind;
  reason: string;
}

/** 规格里一处不成立的组合。 */
export interface ModelSpecConflict {
  field: ModelSpecKey;
  value: string;
  reason: string;
}

/** 展示层字段视图：泛型键在此统一放宽为 string，类型安全由契约与编译器兜底。 */
interface FieldView {
  label: string;
  layer: ModelSpecLayerId;
  options: Record<string, ModelOptionDef>;
}

const FIELD_VIEW = MODEL_SPEC_FIELDS as unknown as Record<string, FieldView | undefined>;
const MULTI_FIELD_VIEW = MODEL_SPEC_MULTI_FIELD_DEFS as unknown as Record<string, FieldView | undefined>;

/** 全部维度键，顺序与设计器渲染顺序一致，保证同一草稿多次判定结果稳定。 */
export const MODEL_SPEC_KEYS: ReadonlyArray<ModelSpecKey> = [
  ...Object.keys(MODEL_SPEC_FIELDS),
  ...Object.keys(MODEL_SPEC_MULTI_FIELD_DEFS),
] as ModelSpecKey[];

/** 取值在元组里的序号即语义序；全部比较都建立在这份序上，新增枚举值自动纳入。 */
function rankOf(values: readonly string[]): ReadonlyMap<string, number> {
  return new Map(values.map((value, index) => [value, index]));
}

/**
 * 有序维度的比较基准。
 *
 * 方向必须显式声明：age 与 hairLength 的元组由小到大，序号越大越「晚」；
 * framing 反过来——元组从全景排到特写，序号越大拍到的身体越少，
 * 因此「需要全身以上」在数值上是要求序号更小。把方向编码进这里，
 * 判定侧就只需要一个比较器，而不是给每个维度写一套 if。
 */
interface OrderedDimension {
  rank: ReadonlyMap<string, number>;
  /** true：序号越大越达标（年龄更大、头发更长）；false：序号越小越达标（拍到更多身体）。 */
  ascending: boolean;
}

const ORDERED_DIMENSIONS: Partial<Record<ModelSpecKey, OrderedDimension>> = {
  age: { rank: rankOf(MODEL_AGES), ascending: true },
  hairLength: { rank: rankOf(MODEL_HAIR_LENGTHS), ascending: true },
  framing: { rank: rankOf(MODEL_FRAMINGS), ascending: false },
};

function fieldLabel(field: ModelSpecKey): string {
  return (FIELD_VIEW[field] ?? MULTI_FIELD_VIEW[field])?.label ?? field;
}

function optionLabel(field: ModelSpecKey, value: string): string {
  return (FIELD_VIEW[field] ?? MULTI_FIELD_VIEW[field])?.options[value]?.label ?? value;
}

function optionConstraints(field: ModelSpecKey, value: string): ModelOptionConstraints | undefined {
  return (FIELD_VIEW[field] ?? MULTI_FIELD_VIEW[field])?.options[value]?.constraints;
}

/** 候选代入位：判定「把 value 填进 field 之后会怎样」时不复制整份草稿。 */
interface Override {
  field: ModelSpecKey;
  value: string;
}

function readValues(draft: ModelSpecDraft, field: ModelSpecKey, override?: Override): readonly string[] {
  if (override?.field === field) return [override.value];
  const raw = draft[field];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw as string];
}

/**
 * 当前取值是否达不到该维度的下界。任一取值未指定即不判定——草稿里留空的维度不构成约束，
 * 否则设计器刚打开时每个选项都会被判成与「未指定」冲突。
 */
function missesFloor(field: ModelSpecKey, current: readonly string[], floor: string | undefined): boolean {
  const order = ORDERED_DIMENSIONS[field];
  if (!order || floor === undefined || current.length === 0) return false;
  const bound = order.rank.get(floor);
  if (bound === undefined) return false;
  return current.some((value) => {
    const rank = order.rank.get(value);
    return rank !== undefined && (order.ascending ? rank < bound : rank > bound);
  });
}

/** 当前取值是否超出该维度的上界；方向与下界相反（目前只有发长用到）。 */
function exceedsCeiling(field: ModelSpecKey, current: readonly string[], ceiling: string | undefined): boolean {
  const order = ORDERED_DIMENSIONS[field];
  if (!order || ceiling === undefined || current.length === 0) return false;
  const bound = order.rank.get(ceiling);
  if (bound === undefined) return false;
  return current.some((value) => {
    const rank = order.rank.get(value);
    return rank !== undefined && (order.ascending ? rank > bound : rank < bound);
  });
}

interface PreconditionFailure {
  /** 触发失败的维度；用于区分「候选自己的问题」和「别人约束了候选」。 */
  field: ModelSpecKey;
  reason: string;
}

/** 准入条件：该选项自身要求的性别、年龄、发长与取景范围是否被草稿满足。 */
function preconditionFailure(constraints: ModelOptionConstraints, draft: ModelSpecDraft, override?: Override): PreconditionFailure | null {
  const genders = readValues(draft, "gender", override);
  if (constraints.gender && genders.length > 0 && !genders.every((value) => constraints.gender!.includes(value as ModelSpec["gender"]))) {
    return { field: "gender", reason: `仅限${constraints.gender.map((value) => optionLabel("gender", value)).join(" / ")}呈现` };
  }
  if (constraints.minAge && missesFloor("age", readValues(draft, "age", override), constraints.minAge)) {
    return { field: "age", reason: `需要 ${optionLabel("age", constraints.minAge)} 及以上的年龄` };
  }
  const hairLength = readValues(draft, "hairLength", override);
  if (missesFloor("hairLength", hairLength, constraints.minHairLength)) {
    return { field: "hairLength", reason: `需要${optionLabel("hairLength", constraints.minHairLength!)}及以上的发长` };
  }
  if (exceedsCeiling("hairLength", hairLength, constraints.maxHairLength)) {
    return { field: "hairLength", reason: `需要${optionLabel("hairLength", constraints.maxHairLength!)}以内的发长` };
  }
  if (constraints.minFraming && missesFloor("framing", readValues(draft, "framing", override), constraints.minFraming)) {
    return { field: "framing", reason: `需要${optionLabel("framing", constraints.minFraming)}以上的取景范围` };
  }
  for (const [field, values] of Object.entries(constraints.excludes ?? {}) as Array<[ModelSpecKey, readonly string[]]>) {
    const hit = readValues(draft, field, override).find((value) => values.includes(value));
    if (hit !== undefined) return { field, reason: `与${fieldLabel(field)}「${optionLabel(field, hit)}」互斥` };
  }
  return null;
}

/**
 * 判定单个取值在当前草稿下是否可选。这是唯一的规则求值点：
 * 设计器禁用态、保存前收敛、API 入参校验全部投影自它，也就不会出现三套规则各自漂移。
 *
 * 判定对称——候选可能不满足别人，也可能是别人不满足候选：
 * 1. 维度级不适用（童模的身高锚点）；
 * 2. 候选自身的准入条件不满足；
 * 3. 草稿里其他已选维度排斥候选（姿态要求全身、棚灯排斥外景）。
 *
 * 复杂度 O(维度数)：步骤 3 只遍历草稿里已指定的维度，无约束的选项直接短路。
 */
export function modelOptionIssue(field: ModelSpecKey, value: string, draft: ModelSpecDraft): ModelOptionIssue | null {
  const rule = MODEL_FIELD_RULES[field];
  if (rule && missesFloor("age", readValues(draft, "age"), rule.minAge)) {
    return { kind: "inapplicable", reason: rule.reason };
  }

  const own = optionConstraints(field, value);
  const ownFailure = own ? preconditionFailure(own, draft, { field, value }) : null;
  if (ownFailure) return { kind: "conflict", reason: ownFailure.reason };

  const override: Override = { field, value };
  for (const other of MODEL_SPEC_KEYS) {
    if (other === field) continue;
    for (const otherValue of readValues(draft, other)) {
      const constraints = optionConstraints(other, otherValue);
      if (!constraints) continue;
      const failure = preconditionFailure(constraints, draft, override);
      if (failure?.field === field) {
        return { kind: "conflict", reason: `与${fieldLabel(other)}「${optionLabel(other, otherValue)}」互斥：${failure.reason}` };
      }
    }
  }
  return null;
}

/**
 * 一次算出整份草稿下所有不可选的取值，键为 `${维度}:${取值}`。
 *
 * 约 30 个维度、230 个取值，每次规格变更求值一遍（调用方按草稿记忆化）；
 * 单次求值是纯比较运算，不做增量缓存——缓存的失效条件比计算本身更贵。
 */
export function blockedModelOptions(draft: ModelSpecDraft): Map<string, ModelOptionIssue> {
  const blocked = new Map<string, ModelOptionIssue>();
  for (const field of MODEL_SPEC_KEYS) {
    for (const value of Object.keys((FIELD_VIEW[field] ?? MULTI_FIELD_VIEW[field])?.options ?? {})) {
      const issue = modelOptionIssue(field, value, draft);
      if (issue) blocked.set(`${field}:${value}`, issue);
    }
  }
  return blocked;
}

/** 规格里所有不成立的组合；保存前与 API 入参校验用。 */
export function findModelSpecConflicts(spec: ModelSpecDraft): ModelSpecConflict[] {
  const conflicts: ModelSpecConflict[] = [];
  for (const field of MODEL_SPEC_KEYS) {
    for (const value of readValues(spec, field)) {
      const issue = modelOptionIssue(field, value, spec);
      if (issue?.kind === "conflict") conflicts.push({ field, value, reason: issue.reason });
    }
  }
  return conflicts;
}

/** 该维度在当前草稿下第一个可选取值；全部冲突则返回 null（交由调用方保留原值）。 */
function firstAllowedValue(field: ModelSpecKey, draft: ModelSpecDraft): string | null {
  for (const value of Object.keys((FIELD_VIEW[field] ?? MULTI_FIELD_VIEW[field])?.options ?? {})) {
    if (modelOptionIssue(field, value, draft)?.kind !== "conflict") return value;
  }
  return null;
}

/** 让位替补：互斥项被清掉后用什么顶上；单维与多维的顶替形态不同，由调用方决定。 */
type ConflictFallback = (field: ModelSpecKey, draft: ModelSpecDraft) => string | readonly string[] | undefined;

/**
 * 收敛到「互斥成立」的状态，落库前必过。
 *
 * protectedKeys 是用户显式选择的维度，永不改动；与之冲突的其他维度让位。
 * 单趟即可收敛：清空或回落一个维度只会移除约束，不会引入新的约束。
 * 维度级不适用（inapplicable）不参与收敛——它本来就不进提示词，不影响自洽性。
 */
function reconcile(
  spec: ModelSpecDraft,
  protectedKeys: ReadonlySet<ModelSpecKey>,
  fallback: ConflictFallback,
): { spec: ModelSpecDraft; dropped: ModelSpecKey[] } {
  const next: ModelSpecDraft = { ...spec };
  const dropped: ModelSpecKey[] = [];
  for (const field of MODEL_SPEC_KEYS) {
    if (protectedKeys.has(field)) continue;
    const values = readValues(next, field);
    if (values.length === 0) continue;
    const kept = values.filter((value) => modelOptionIssue(field, value, next)?.kind !== "conflict");
    if (kept.length === values.length) continue;
    dropped.push(field);
    const replacement = kept.length > 0 ? kept : fallback(field, next);
    (next as Record<string, unknown>)[field] = Array.isArray(next[field]) ? replacement ?? [] : replacement;
  }
  return { spec: next, dropped };
}

/** 草稿收敛：让位的维度回到「未指定」，设计器允许留空、保存时由基准款补全。 */
export function reconcileModelSpecDraft(draft: ModelSpecDraft, protectedKeys: ReadonlySet<ModelSpecKey>): { spec: ModelSpecDraft; dropped: ModelSpecKey[] } {
  return reconcile(draft, protectedKeys, () => undefined);
}

/**
 * 完整规格修复：让位的维度顶到当前状态下第一个可选取值，保证结果仍是完整合约。
 *
 * 仅在「基准款补全出的默认值撞上用户显式选择」时才是必需的（例如显式选了儿童、
 * 默认的日常淡妆就必须让位给素颜），正常路径下草稿收敛已经保证无冲突。
 */
export function repairModelSpec(spec: ModelSpec, protectedKeys: ReadonlySet<ModelSpecKey>): { spec: ModelSpec; repaired: ModelSpecKey[] } {
  const { spec: next, dropped } = reconcile(spec, protectedKeys, (field, draft) => firstAllowedValue(field, draft) ?? MODEL_SPEC_DEFAULTS[field]);
  return { spec: next as ModelSpec, repaired: dropped };
}


/**
 * 容貌层轻微不对称语料。确定性派生：由 spec 哈希选两条，同 spec 稳定、不同 spec 有差异；
 * 命名不对称是对抗「完美对称 AI 脸」最有效的手段。
 */
const ASYMMETRY_POOL: ReadonlyArray<string> = [
  "the right eye sitting fractionally lower than the left",
  "one brow marginally higher than the other",
  "a subtly uneven nose bridge",
  "a slightly uneven hairline at the temple",
  "faint asymmetry at the lip corners",
  "one eyelid a touch heavier than the other",
];

/**
 * 词数上限：超出时按 rank 丢弃可选段，保证编译产物有确定的体积上界。
 * 上限放宽到 250 是为了让完整规格（三条气质、两条标记、两条不对称细节）能全部保留——
 * 190 词时出厂预设已在 188 词贴顶，任何一个额外维度都会把不对称细节先挤掉。
 */
const PROMPT_WORD_BUDGET = 250;

/** 童模档位集合（儿童/少年/青少年）：这些年龄段在编译时省略成人身高与成衣尺码锚定。 */
const CHILD_AGE_VALUES: ReadonlySet<ModelSpec["age"]> = new Set(["CHILD_7", "PRETEEN_11", "TEEN_16"]);

/** 成人大码的尺码锚定词，由编译层按需拼接（童模不适用成人尺码体系）。 */
const PLUS_SIZE_ANCHOR = ", around US size 16";

/**
 * 收尾负面清单：只列可命名的具体伪影，不写 "low quality / bad quality" 这类空泛否定。
 *
 * 生图通道（OpenAI 兼容 images / Gemini）都只有单个 prompt 参数，没有独立 negative 字段，
 * 负面约束只能作为正文的最后一句——与分镜规划器给 promptInstruction 定的顺序一致
 * （「…；显式负面约束」收尾）。具体名词可执行，泛化否定词会被模型忽略还会挤占描述预算。
 *
 * 刻意不出现 asymmetrical / uneven：本编译器的正面要求里就有两条命名不对称细节，
 * 否定它会与自己的身份指令互殴（把想要的当成伪影去压制）。
 */
const PORTRAIT_NEGATIVE_CONSTRAINTS = "Avoid: extra or fused fingers, malformed hands, extra limbs, duplicated face, watermark, logo, text, 3D render and illustration.";

/** FNV-1a 32 位哈希：足够派生不对称对，且无依赖、跨端一致。 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function canonicalSpecKey(spec: ModelSpec): string {
  // ModelSpec 的键集合固定，按序拼接即可；多选数组排序抵消用户勾选顺序差异。
  return [
    spec.gender, spec.age, spec.heritage, spec.stature, spec.build,
    spec.faceShape, spec.eyeShape, spec.eyeColor, spec.browShape, spec.noseShape, spec.lipShape,
    spec.hairLength, spec.hairstyle, spec.hairColor, spec.hairTexture, spec.hairline,
    spec.complexion, spec.skinTexture, spec.facialHair, [...spec.distinctiveMarks].sort().join("+"),
    spec.expression, spec.gaze, [...spec.aura].sort().join("+"), spec.makeup, spec.baseWardrobe,
    spec.framing, spec.pose, spec.backdrop, spec.lighting, spec.lens,
  ].join("|");
}

function pickAsymmetries(spec: ModelSpec): [string, string] {
  const hash = fnv1a(canonicalSpecKey(spec));
  const first = hash % ASYMMETRY_POOL.length;
  const second = (Math.floor(hash / ASYMMETRY_POOL.length) + 1 + (hash % (ASYMMETRY_POOL.length - 1))) % ASYMMETRY_POOL.length;
  return [ASYMMETRY_POOL[first], ASYMMETRY_POOL[second === first ? (first + 1) % ASYMMETRY_POOL.length : second]];
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** 编译产物的词数预算（不含 notes）。 */
export const MODEL_PROMPT_WORD_BUDGET = PROMPT_WORD_BUDGET;

/**
 * 把四层 spec 确定性编译为定妆照 prompt：一个 250 词以内的英文流畅段落。
 * notes 以 "Additional requirements" 追加，属于用户硬性要求、不计入词数预算。
 */
export function compileModelPortraitPrompt(spec: ModelSpec, notes: string): string {
  const eyeColor = EYE_COLOR.options[spec.eyeColor].prompt;
  const [asymmetryA, asymmetryB] = pickAsymmetries(spec);

  // 成人身高（cm）与成衣尺码（US size）不适用于童模：编译时省略，避免「4 岁 + 172cm」式荒谬组合。
  const isChild = CHILD_AGE_VALUES.has(spec.age);
  const ageOption = AGE.options[spec.age];
  const buildText = spec.build === "PLUS" && !isChild ? `${BUILD.options[spec.build].prompt}${PLUS_SIZE_ANCHOR}` : BUILD.options[spec.build].prompt;
  const bodyText = isChild ? buildText : `${STATURE.options[spec.stature].prompt} and ${buildText}`;

  // 年龄数字化后身份句写作「a 28-year-old female fashion model」，童模档由 noun 切换角色名词。
  const identity = `${FRAMING.options[spec.framing].prompt} of ${ageOption.prompt} ${GENDER.options[spec.gender].prompt} ${ageOption.noun ?? "fashion model"} with ${HERITAGE.options[spec.heritage].prompt} features, ${bodyText}.`;

  const features = `${FACE_SHAPE.options[spec.faceShape].prompt} with ${eyeColor} ${EYE_SHAPE.options[spec.eyeShape].prompt}, ${BROW_SHAPE.options[spec.browShape].prompt}, ${NOSE_SHAPE.options[spec.noseShape].prompt} and ${LIP_SHAPE.options[spec.lipShape].prompt}; ${HAIR_COLOR.options[spec.hairColor].prompt} ${HAIR_LENGTH.options[spec.hairLength].prompt} in ${HAIRSTYLE.options[spec.hairstyle].prompt}, ${HAIR_TEXTURE.options[spec.hairTexture].prompt}, ${HAIRLINE.options[spec.hairline].prompt}; ${COMPLEXION.options[spec.complexion].prompt}, ${SKIN_TEXTURE.options[spec.skinTexture].prompt}, ${FACIAL_HAIR.options[spec.facialHair].prompt}.`;

  const marks = spec.distinctiveMarks.map((mark) => MARKS.options[mark].prompt);
  const marksSentence = marks.length > 0 ? `${marks.join(", ").replace(/^\w/, (c) => c.toUpperCase())}.` : "";

  // 气质联动段：每个 aura 展开为「气质词 + 姿态神情子句」并独立成句，不覆盖显式布光/背景。
  const auraClauses = spec.aura.map((key) => {
    const option = AURA.options[key];
    return option.expand ? `${option.prompt} (${option.expand})` : option.prompt;
  });
  const auraPhrase = auraClauses.length > 0 ? `The overall presence is ${auraClauses.join(" and ")}.` : "";
  const expression = `${EXPRESSION.options[spec.expression].prompt}, ${GAZE.options[spec.gaze].prompt}, ${MAKEUP.options[spec.makeup].prompt}, wearing ${WARDROBE.options[spec.baseWardrobe].prompt}.`;

  const asymmetries = `Naturally asymmetric details: ${asymmetryA}, ${asymmetryB}.`;

  const posePrompt = POSE.options[spec.pose].prompt;
  const camera = `${posePrompt.charAt(0).toUpperCase()}${posePrompt.slice(1)}, ${BACKDROP.options[spec.backdrop].prompt}, ${LIGHTING.options[spec.lighting].prompt}.`;

  // 收尾双锚点：电商目录摄影的用途定位 + 反 AI 感的真实感约束，覆盖买家信任的核心判据。
  const realism = `Commercial e-commerce catalog photography with true-to-life color and crisp focus on the eyes; true skin tones, fine lines and skin texture kept unretouched; shot on ${LENS.options[spec.lens].prompt}, no AI-smoothed perfection.`;

  // 可选段按 rank 丢弃（rank 越大越先丢）：不对称细节 → 特色标记 → 气质联动段。
  const optional: Array<{ rank: number; text: string }> = [
    { rank: 2, text: marksSentence },
    { rank: 1, text: auraPhrase },
    { rank: 3, text: asymmetries },
  ].filter((segment) => segment.text);
  const activeRanks = new Set(optional.map((segment) => segment.rank));

  // 负面清单必须留在必保段里：它是伪影防线，不能随预算被裁掉（因此排在可选段之后、notes 之前）。
  const render = () => [identity, features, ...optional.filter((segment) => activeRanks.has(segment.rank)).map((segment) => segment.text), expression, camera, realism, PORTRAIT_NEGATIVE_CONSTRAINTS].join(" ").replace(/\s+/g, " ").trim();
  let body = render();
  while (countWords(body) > PROMPT_WORD_BUDGET && activeRanks.size > 0) {
    for (const rank of [3, 2, 1]) {
      if (activeRanks.has(rank)) {
        activeRanks.delete(rank);
        break;
      }
    }
    body = render();
  }

  const notesText = notes.trim();
  return notesText ? `${body} Additional requirements: ${notesText}` : body;
}

/**
 * 有参考脸时前置的身份锚点句。
 *
 * 它是同一条实发 prompt 的前半段，由编译层导出：Worker 的生图请求与前端预览引用同一份文案，
 * 否则「预览即实发」的承诺会在有参考脸时失效（此前两边各写一份字面量）。
 */
export const MODEL_REFERENCE_FACE_PREFIX = "Identity reference: use the attached photo as the single identity baseline for this person, keeping facial structure, features and skin tone consistent with it.";

/**
 * 实发定妆照 prompt：无参考脸时就是编译正文；有参考脸时前置身份锚点句（人脸随请求上传）。
 * 参考脸是模特的唯一身份基准，因此锚点句只声明「以这张脸为准」，不重复描述五官。
 */
export function compileModelCastPrompt(spec: ModelSpec, notes: string, hasReferenceFace: boolean): string {
  const body = compileModelPortraitPrompt(spec, notes);
  return hasReferenceFace ? `${MODEL_REFERENCE_FACE_PREFIX} ${body}` : body;
}

/** 模特库列表行的中文身份摘要，如「女 · 28 岁上下 · 东亚 · 高挑 172cm · 匀称」。 */
type ModelIdentityKey = "gender" | "age" | "heritage" | "stature" | "build";
function identityLabel<K extends ModelIdentityKey>(key: K, value: ModelSpec[K]): string {
  const field: ModelSpecFieldDef<K> = MODEL_SPEC_FIELDS[key];
  return field.options[value as ModelSpec[K] & string].label;
}
export function modelSpecSummary(spec: ModelSpec): string {
  const keys: ReadonlyArray<ModelIdentityKey> = ["gender", "age", "heritage", "stature", "build"];
  // 不参与编译的维度不进摘要：童模不会输出身高锚点，摘要里写「儿童 7 岁 · 165cm」是在承诺不存在的规格。
  return keys
    .filter((key) => modelOptionIssue(key, spec[key], spec)?.kind !== "inapplicable")
    .map((key) => identityLabel(key, spec[key]))
    .join(" · ");
}

export interface ModelCastPreset {
  id: string;
  name: string;
  description: string;
  spec: ModelSpec;
}

/**
 * 预设共用的基准款。直接取契约的 MODEL_SPEC_DEFAULTS：设计器「留空维度按基准款生成」
 * 与预设「中性基准」用的是同一个基准，两处各自维护一份必然漂移。
 */
const BASELINE_SPEC: ModelSpec = MODEL_SPEC_DEFAULTS;

/*
 * 预设是「人设档位」，不是拍摄场景。
 *
 * 模特库的产出是选角档案照，预设要回答的是「这个人是谁」——身份、骨相、发型、神态与妆容；
 * 而不是「这批图怎么拍」。因此镜头层（景别/姿态/背景/光线/镜头）与定妆基础装一律沿用
 * 基准款：定妆照参数统一，库里不同人设之间才可横向比较，风格化拍摄留给后续的工作台与套图。
 *
 * 每个条目是一份可直接落库的完整 spec，并有两条硬约束：自身通过互斥校验（否则「一键起手」
 * 会直接产出矛盾提示词），且编译词数落在预算内（预设不应该靠丢弃可选段来收场）。
 */
export const MODEL_CAST_PRESETS: ReadonlyArray<ModelCastPreset> = [
  {
    id: "neutral-baseline", name: "中性基准", description: "不预设人设：自然白肤色 + 齐肩微卷，先把脸定下来再逐层加风格。",
    spec: BASELINE_SPEC,
  },
  {
    id: "editorial-cool", name: "清冷高级", description: "冷白瘦高配细挑眉薄唇，低垂眼帘，走杂志脸的高级距离感。",
    spec: { ...BASELINE_SPEC, stature: "TALL_172", build: "SLENDER", faceShape: "DIAMOND", eyeShape: "NARROW", browShape: "THIN_ARCHED", noseShape: "SCULPTED", lipShape: "THIN", hairLength: "LONG", hairstyle: "SLEEK_STRAIGHT", hairTexture: "SLEEK_GLOSSY", hairline: "WIDOWS_PEAK", complexion: "PORCELAIN", skinTexture: "MATTE_FINE", expression: "EDITORIAL_DISTANCE", gaze: "LOWERED_LIDS", aura: ["QUIET_CONFIDENCE"], makeup: "SOFT_GLAM" },
  },
  {
    id: "sweet-cool", name: "甜酷少女", description: "心形脸配桃花眼与空气刘海，甜底子上压一层轻欧美妆容。",
    spec: { ...BASELINE_SPEC, age: "EARLY_20S", stature: "PETITE_158", build: "SLENDER", faceShape: "HEART", eyeShape: "PEACH_BLOSSOM", browShape: "STRAIGHT_SOFT", noseShape: "UPTURNED", lipShape: "BOW", hairstyle: "TEXTURED_FRINGE", hairColor: "CHESTNUT", hairTexture: "NATURAL_VOLUME", skinTexture: "DEWY", expression: "SOFT_SMILE", aura: ["PLAYFUL"], makeup: "SOFT_GLAM" },
  },
  {
    id: "bright-youth", name: "元气少女", description: "16 岁圆脸圆眼配双马尾，低龄合规的日常淡妆，元气开怀。",
    spec: { ...BASELINE_SPEC, age: "TEEN_16", stature: "PETITE_158", build: "SLENDER", faceShape: "ROUND", eyeShape: "ROUND", browShape: "FEATHERED", noseShape: "DELICATE", lipShape: "FULL", hairLength: "LONG", hairstyle: "TWIN_TAILS", hairTexture: "NATURAL_VOLUME", complexion: "LIGHT_NEUTRAL", expression: "BRIGHT_GRIN", aura: ["PLAYFUL"], makeup: "MINIMAL_DEWY" },
  },
  {
    id: "warm-neighbor", name: "邻家温柔", description: "柳叶眉与浅棕微卷，性格感优先：亲和、温柔、不端着。",
    spec: { ...BASELINE_SPEC, browShape: "WILLOW", noseShape: "DELICATE", hairColor: "LIGHT_BROWN", expression: "TENDER", gaze: "OFF_CAMERA", aura: ["WARM_APPROACHABLE"], makeup: "EVERYDAY", distinctiveMarks: ["DIMPLES"] },
  },
  {
    id: "city-professional", name: "都市精英", description: "32 岁方下颌配低盘发，干练通勤感，冷调哑光肤质。",
    spec: { ...BASELINE_SPEC, age: "EARLY_30S", stature: "TALL_172", build: "SLENDER", faceShape: "SQUARE_JAW", browShape: "BOLD", lipShape: "WIDE", hairstyle: "LOW_BUN", hairColor: "ESPRESSO", hairTexture: "SLEEK_GLOSSY", complexion: "LIGHT_NEUTRAL", skinTexture: "MATTE_FINE", aura: ["POLISHED", "QUIET_CONFIDENCE"], makeup: "EVERYDAY" },
  },
  {
    id: "business-gentleman", name: "商务绅士", description: "男性通勤人设：背头、方正发际线与短胡茬，稳重不油腻。",
    spec: { ...BASELINE_SPEC, gender: "MALE", age: "EARLY_30S", stature: "TALL_172", faceShape: "SQUARE_JAW", eyeShape: "NARROW", browShape: "THICK_STRAIGHT", noseShape: "SCULPTED", lipShape: "WIDE", hairLength: "CROP", hairstyle: "SLICKED_BACK", hairTexture: "SLEEK_GLOSSY", hairline: "SQUARE", complexion: "LIGHT_NEUTRAL", skinTexture: "MATTE_FINE", facialHair: "STUBBLE", aura: ["POLISHED", "METROPOLITAN"], makeup: "NONE" },
  },
  {
    id: "youth-fresh", name: "少年感", description: "单眼皮与野生眉，短碎发，清爽干净、不施妆容的少年气。",
    spec: { ...BASELINE_SPEC, gender: "MALE", age: "EARLY_20S", build: "SLENDER", eyeShape: "MONOLID", browShape: "FEATHERED", noseShape: "DELICATE", hairLength: "CROP", hairstyle: "TEXTURED_FRINGE", hairTexture: "TOUSLED", complexion: "LIGHT_NEUTRAL", expression: "SOFT_SMILE", gaze: "OFF_CAMERA", aura: ["FRESH"], makeup: "NONE" },
  },
  {
    id: "sunny-athletic", name: "阳光运动", description: "小麦肤色与健美体型，开怀笑容，活力外放的运动人设。",
    spec: { ...BASELINE_SPEC, gender: "MALE", age: "EARLY_20S", stature: "TALL_172", build: "ATHLETIC", browShape: "THICK_STRAIGHT", hairLength: "CROP", hairstyle: "TEXTURED_FRINGE", hairColor: "ESPRESSO", hairTexture: "TOUSLED", complexion: "MEDIUM_OLIVE", expression: "BRIGHT_GRIN", gaze: "OFF_CAMERA", aura: ["PLAYFUL", "FRESH"], makeup: "NONE" },
  },
  {
    id: "mixed-exotic", name: "混血异域", description: "混血骨相：深眼窝、高鼻梁与厚唇，大波浪演绎异域感。",
    spec: { ...BASELINE_SPEC, heritage: "MIXED", stature: "TALL_172", build: "SLENDER", faceShape: "DIAMOND", eyeShape: "DEEP_SET", eyeColor: "HAZEL", browShape: "BOLD", noseShape: "AQUILINE", lipShape: "FULL", hairLength: "LONG", hairstyle: "DEEP_CURL", hairColor: "CHESTNUT", complexion: "HONEY", expression: "EDITORIAL_DISTANCE", gaze: "HALF_LID_IDLE", aura: ["ARTSY"], makeup: "SOFT_GLAM" },
  },
  {
    id: "deep-tone-vital", name: "深肤活力", description: "深肤色配编发与饱满唇形，健康外放的多元审美人设。",
    spec: { ...BASELINE_SPEC, heritage: "AFRICAN", stature: "TALL_172", build: "ATHLETIC", faceShape: "HEART", eyeShape: "ROUND", browShape: "BOLD", noseShape: "BROAD", lipShape: "FULL", hairstyle: "BRAIDED", complexion: "DEEP", expression: "BRIGHT_GRIN", aura: ["FRESH", "WARM_APPROACHABLE"], makeup: "SOFT_GLAM" },
  },
  {
    id: "plus-confident", name: "大码自信", description: "大码体型配铜色层次长发，松弛有底气的自信笑容。",
    spec: { ...BASELINE_SPEC, age: "EARLY_30S", build: "PLUS", faceShape: "ROUND", browShape: "ARCED", lipShape: "FULL", hairLength: "LONG", hairstyle: "LAYERED_LONG", hairColor: "COPPER", complexion: "HONEY", expression: "WARM_LAUGH", aura: ["WARM_APPROACHABLE", "QUIET_CONFIDENCE"], makeup: "EVERYDAY" },
  },
  {
    id: "silver-elegant", name: "银发从容", description: "60 岁银发与真实岁月纹理，从容有度，服务中老年与银发品类。",
    spec: { ...BASELINE_SPEC, age: "SENIOR", heritage: "NORTHERN_EUROPEAN", faceShape: "LONG", eyeShape: "DOWNTURNED", browShape: "THIN_ARCHED", lipShape: "THIN", hairstyle: "SOFT_WAVE", hairColor: "SILVER", complexion: "PORCELAIN", skinTexture: "MATURE_LINES", gaze: "OFF_CAMERA", aura: ["SERENE", "QUIET_CONFIDENCE"], makeup: "MATURE" },
  },
  {
    id: "child-playful", name: "童真活泼", description: "7 岁童模配齐耳波波头与鼻梁雀斑，素颜起手，不做成妆。",
    // 童模的两条硬规则：妆只留素颜（面向未成年人的物料不做成妆），身高锚点编译期本就被省略。
    spec: { ...BASELINE_SPEC, age: "CHILD_7", build: "SLENDER", faceShape: "ROUND", eyeShape: "ROUND", noseShape: "DELICATE", hairLength: "CHIN_BOB", hairTexture: "NATURAL_VOLUME", expression: "BRIGHT_GRIN", aura: ["PLAYFUL"], makeup: "NONE", distinctiveMarks: ["FRECKLES_NOSE"] },
  },
];
