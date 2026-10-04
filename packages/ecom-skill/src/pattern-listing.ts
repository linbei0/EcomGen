import {
  AMAZON_TITLE_MAX,
  ETSY_TAG_MAX_LENGTH,
  ETSY_TAGS_MAX,
  ETSY_TITLE_MAX,
  TIKTOK_TITLE_MAX,
  TIKTOK_TITLE_MIN,
} from "@ecomgen/contracts";
import type { ListingPlatform } from "@ecomgen/contracts";

/**
 * 花型 Listing 文案的确定性 prompt 模板。
 *
 * 放在 ecom-skill 而不是调用方 packages/agent：平台字数与条数派生自 contracts 的
 * LISTING_PLATFORM_LIMITS，而版本常量必须能被 api 侧引用（它要进任务指纹，避免改了措辞
 * 之后旧任务仍被复用），api 不依赖 agent 包。与 pod-forge / pattern-variant 同一条纪律。
 *
 * 模板只表达写作意图；字数、tags 数量与要点条数由 agent 侧 validateListingCopy 硬校验，
 * 超限走一次有界重试，不静默截断。
 */

/**
 * Listing 提示词版本：修订下面的系统提示词或任一平台规则都必须递增这个常量。
 */
export const PATTERN_LISTING_PROMPT_VERSION = "2026.10.1";

/**
 * 系统提示词。写作规则取自平台官方口径（2026-10 校对）：
 * - Etsy Seller Handbook《New Guidance for Listing Titles》：标题说清物品本身、客观属性（颜色/材质/
 *   尺寸）前置、保持可扫读（少于 15 个词）、去掉主观形容词与赠礼话术、不重复词、不写价格与促销；
 *   赠礼/场合/长尾词移到 tags。搜索是按整条 listing 综合评估的，标题不必背下所有关键词。
 * - Merch on Demand 的商品标题不写商品类型词（平台自动附加），不写促销/价格/物流与特殊字符，
 *   主关键词落在标题前段；要点写收益而不是罗列属性。
 * 关键约束（字数、tags 数量、要点条数）由平台规则注入并在 validateListingCopy 里硬校验，
 * 提示词只负责表达意图，不能替校验背书。
 */
export const LISTING_SYSTEM_PROMPT = `You are a cross-border print-on-demand listing copywriter. You receive a pattern artwork image and minimal context, and you write marketplace copy that a shopper can scan in seconds.

Critical rules:
- Output only valid JSON matching the requested schema. No Markdown fences or explanations.
- Write in English for the target marketplace. Do not translate the user's input verbatim; use the search vocabulary the target market actually types.
- Describe only what the artwork visibly shows. Do not invent product facts, materials, certifications, prices, rankings, health claims, guarantees, or shipping promises.
- Never claim trademarked brands, licensed characters, celebrity names, or fandom affiliations. If the artwork resembles a known brand or character, describe it generically.
- Title: state what the item is once, and lead with the most descriptive words plus the objective traits a shopper filters on (color, material, style). Keep it readable and free of padding. No subjective adjectives (beautiful, perfect, stunning), no gifting or occasion phrases, no price, shipping or promotion wording, and do not repeat the same word.
- Tags: each tag is a distinct multi-word phrase a shopper might type, not a single generic word, and no two tags may overlap in meaning. Prefer specific long-tail phrases over broad head terms.
- Description: plain text, no Markdown headings, and the first sentence must say what the artwork is in natural language, because only the opening lines are visible before the reader expands it. Then cover suitable audiences and usage or gift occasions.
- Bullets: lead each bullet with the benefit or the design's main appeal rather than a bare attribute list.
- Respect bannedWords completely: they must not appear in the title, tags, description or bullets. Weave mustIncludeWords in naturally where possible.`;

const PLATFORM_RULES: Record<ListingPlatform, string> = {
  ETSY: `Etsy rules: title at most ${ETSY_TITLE_MAX} characters, with the item and its strongest descriptive words inside the first 40 characters because that is what mobile shoppers see before the title truncates; exactly ${ETSY_TAGS_MAX} tags, each at most ${ETSY_TAG_MAX_LENGTH} characters, all distinct multi-word long-tail phrases, never single generic words and never near-duplicates of each other or of the title wording; put gifting and occasion phrases in tags rather than the title; bullets must be an empty array.`,
  AMAZON: `Amazon Merch rules: title at most ${AMAZON_TITLE_MAX} characters with the primary keyword early, no product-type words (the platform appends shirt, hoodie and similar terms itself), no special characters and no promotional, price or shipping wording; tags must be an empty array; provide exactly 3 bullets, each at most 256 characters, each opening with a benefit rather than a bare attribute.`,
  TIKTOK_SHOP: `TikTok Shop rules: title between ${TIKTOK_TITLE_MIN} and ${TIKTOK_TITLE_MAX} characters written for a fast mobile feed rather than a keyword stack; tags must be an empty array; bullets must be an empty array.`,
};

/** 平台规则：按平台取一段可直接拼进提示词的硬约束文本（缺省分支不会发生，平台是枚举）。 */
export function listingPlatformRules(platform: ListingPlatform): string {
  return PLATFORM_RULES[platform];
}

