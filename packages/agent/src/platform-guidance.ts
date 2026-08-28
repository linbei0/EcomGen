import type { PlatformTarget, TargetMarket } from "@ecomgen/contracts";
import { resolveProductFamily } from "@ecomgen/ecom-skill";

export interface MarketGuidanceContext {
  platformTargets: readonly PlatformTarget[];
  targetMarket: TargetMarket | null;
  copyLanguage: string | null;
  productCategory?: string | null;
}

interface MarketGuidance {
  name: string;
  defaultCopyLanguage: string;
}

const MARKET_GUIDANCE: Record<TargetMarket, MarketGuidance> = {
  CHINA_MAINLAND: { name: "中国大陆", defaultCopyLanguage: "zh-Hans" },
  HONG_KONG: { name: "香港", defaultCopyLanguage: "zh-Hant" },
  MACAU: { name: "澳门", defaultCopyLanguage: "zh-Hant" },
  TAIWAN: { name: "台湾", defaultCopyLanguage: "zh-Hant" },
  UNITED_STATES: { name: "美国", defaultCopyLanguage: "en-US" },
  UNITED_KINGDOM: { name: "英国", defaultCopyLanguage: "en-GB" },
  GERMANY: { name: "德国", defaultCopyLanguage: "de-DE" },
  FRANCE: { name: "法国", defaultCopyLanguage: "fr-FR" },
  ITALY: { name: "意大利", defaultCopyLanguage: "it-IT" },
  SPAIN: { name: "西班牙", defaultCopyLanguage: "es-ES" },
  JAPAN: { name: "日本", defaultCopyLanguage: "ja-JP" },
  SOUTH_KOREA: { name: "韩国", defaultCopyLanguage: "ko-KR" }
};

interface PlatformPlaybook {
  name: string;
  trafficJob: "SEARCH_THUMBNAIL" | "FEED_CARD" | "COLLECTION_GRID";
  hero: { background: string; occupancy: string; textBudget: "none" | "none-or-tiny"; contrast: "high" | "medium" };
  support: string;
  feedAsset: string | null;
  forbidden: string[];
}

/** 只返回当前选中平台的短规则；不要把六套平台全文塞进 system prompt。 */
const PLATFORM_PLAYBOOKS: Record<PlatformTarget, PlatformPlaybook> = {
  TAOBAO: {
    name: "淘宝/天猫",
    trafficJob: "SEARCH_THUMBNAIL",
    hero: { background: "干净浅底或纯色，缩略图里立刻能认出商品", occupancy: "70-85%", textBudget: "none-or-tiny", contrast: "high" },
    support: "后续帧各自只讲一个卖点、材质或简洁场景，不要每张都做成促销海报。",
    feedAsset: "AI 规划且张数足够时，加一张无字纯白底 #FFFFFF 商品图供推荐抓取；手动选择不得擅自加张。",
    forbidden: ["极限词", "大面积促销字", "未核验价格", "假认证", "Logo"]
  },
  JD: {
    name: "京东",
    trafficJob: "SEARCH_THUMBNAIL",
    hero: { background: "纯白 #FFFFFF，商品居中，不要拼接", occupancy: "约 80%", textBudget: "none", contrast: "high" },
    support: "辅图偏规格、材质和工艺，再给场景；少促销感，多可核对细节。",
    feedAsset: null,
    forbidden: ["诱导点击", "拼接主图", "未核验价格", "假认证", "Logo"]
  },
  PDD: {
    name: "拼多多",
    trafficJob: "SEARCH_THUMBNAIL",
    hero: { background: "高对比纯色或干净浅底，主体巨大", occupancy: "≥70%，宁大勿小", textBudget: "none-or-tiny", contrast: "high" },
    support: "画面极简，一眼看懂商品；场景从简，不要杂志风大留白。",
    feedAsset: "AI 规划且张数足够时，可加一张无字白底；手动选择不得擅自加张。",
    forbidden: ["极限词", "杂乱装饰", "未核验价格", "假认证", "Logo"]
  },
  DOUYIN: {
    name: "抖音",
    trafficJob: "FEED_CARD",
    hero: { background: "生活场景优先于纯白底，中心主体、色块对比强", occupancy: "中心清晰可扫，不要把主体缩在一角", textBudget: "none-or-tiny", contrast: "high" },
    support: "按商品卡/信息流来构图；真实使用感优先于设计海报；人物或场景服从品类需要。",
    feedAsset: null,
    forbidden: ["二维码", "他平台标识", "大面积牛皮癣", "未核验价格", "Logo"]
  },
  AMAZON: {
    name: "亚马逊",
    trafficJob: "SEARCH_THUMBNAIL",
    hero: { background: "纯白 #FFFFFF", occupancy: "≥85%", textBudget: "none", contrast: "high" },
    support: "主图禁止任何文字、徽章、边框和无关道具；卖点字、对比和场景只放辅图，且只用已核验事实。",
    feedAsset: null,
    forbidden: ["主图文字", "主图 Logo", "水印", "边框", "未包含的配件", "未核验认证"]
  },
  SHOPIFY: {
    name: "独立站",
    trafficJob: "COLLECTION_GRID",
    hero: { background: "干净统一的白底或品牌底，集合页缩略图可识别", occupancy: "主体清晰，允许克制留白", textBudget: "none-or-tiny", contrast: "medium" },
    support: "第 2 张起才是生活场景、细节和尺度；全套背景和裁切保持一致。",
    feedAsset: null,
    forbidden: ["促销牛皮癣", "未核验价格", "假认证", "每张都换风格"]
  }
};

/** 只注入当前平台与品类，供 Pi 改写成自然语言；市场不决定场景。 */
export function readPlatformGuidance(context: MarketGuidanceContext) {
  const market = context.targetMarket ? MARKET_GUIDANCE[context.targetMarket] : null;
  const family = resolveProductFamily(context.productCategory);
  const unknown = context.platformTargets.find((target) => !(target in PLATFORM_PLAYBOOKS));
  if (unknown) throw new Error(`Unknown platform target: ${unknown}`);
  return {
    targets: context.platformTargets.map((target) => ({ target, ...PLATFORM_PLAYBOOKS[target] })),
    market: market ? { id: context.targetMarket, name: market.name } : null,
    effectiveCopyLanguage: context.copyLanguage ?? market?.defaultCopyLanguage ?? null,
    copyLanguageSource: context.copyLanguage ? "explicit" : market ? "market-default" : "none",
    product: {
      category: context.productCategory ?? null,
      family
    },
    copyPolicy: [
      "Only use copy when the storyboard type needs it or the user explicitly requests it; a selected language never requires copy in every image.",
      "When copy is needed, use the effective copy language and only verified product facts.",
      "Do not derive visual style from the selected market. Use templates, verified product facts, brand guidance, reference assets, and user instruction for visual direction.",
      "Do not introduce stereotypes, landmarks, holidays, cultural symbols, prices, certifications, guarantees, or unsupported claims unless explicitly supplied as verified input."
    ],
    planningPolicy: [
      "MANUAL: requestedTypes is the exact list and order. Platform and product family only change each prompt. Do not add, remove, reorder, or substitute types, including extra feed packshots.",
      "AI: choose types from product-family needs first (drape, ports, texture, ritual, scale). Then adapt hero/feed frames to the selected platform. Do not pick types because a platform is popular.",
      "Apply platform hero rules to packshot templates such as hero-image, not blindly to whatever is first in a manual list. Infographic and poster frames may use short verified copy; Amazon/JD packshots stay textless.",
      "Never render prices, logos, badges, or promotional stamps into pixels."
    ]
  };
}
