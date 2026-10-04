import type { ImageContent } from "@earendil-works/pi-ai";
import type { ListingCopy, ListingPlatform, PodPrintCategory } from "@ecomgen/contracts";
import { LISTING_PLATFORM_LIMITS } from "@ecomgen/contracts";
import { LISTING_SYSTEM_PROMPT, listingPlatformRules } from "@ecomgen/ecom-skill";
import { createAgent, type ReasoningModel } from "./runtime.js";
import { parseJsonResponse } from "./json-response.js";
import { latestAssistantText, requiredText } from "./model-reply.js";
import { LISTING_COPY_SCHEMA } from "./structured-output.js";

/**
 * 花型 Listing 文案编写器（COPYWRITE 的全局扩展）。
 *
 * 与 writeCopywriting 分开实现而不是塞进同一函数：listing 是「看图写文案」——输入是花型图与
 * 平台硬约束，没有项目事实体系（verifiedFacts/prohibitedClaims）；把两条链路搅在一起会让
 * 两边的护栏语义互相模糊。平台字数用硬校验（validateListingCopy）而非提示词软约束，
 * 超限走一次会话内有界重试，仍超限按失败处理，不静默截断。
 *
 * 提示词模板与版本常量在 @ecomgen/ecom-skill 的 pattern-listing.ts：api 侧要把版本写进任务
 * 指纹，而 api 不依赖本包。
 */

export interface ListingCopyInput {
  model: ReasoningModel;
  apiKey: string;
  platform: ListingPlatform;
  /** 花型名称与目标品类构成最小主题上下文；花型图作为视觉附件传入。 */
  patternName: string;
  category: PodPrintCategory | null;
  sellingPoints: string | null;
  mustIncludeWords: string | null;
  bannedWords: string | null;
  patternImages: ImageContent[];
}


/** 生成花型在指定平台的 listing 文案；失败与超限不静默降级，超限走一次会话内重试。 */
export async function writeListingCopy(input: ListingCopyInput): Promise<ListingCopy> {
  const agent = createAgent({ workflow: "COPYWRITE", model: input.model, apiKey: input.apiKey, systemPrompt: LISTING_SYSTEM_PROMPT, tools: [], outputSchema: LISTING_COPY_SCHEMA });
  const payload = {
    platform: input.platform,
    platformRules: listingPlatformRules(input.platform),
    patternName: input.patternName,
    category: input.category,
    sellingPoints: input.sellingPoints,
    mustIncludeWords: input.mustIncludeWords,
    bannedWords: input.bannedWords,
  };
  await agent.prompt(
    `Write marketplace listing copy for this pattern artwork. Return {"platform":string,"title":string,"tags":string[],"description":string,"bullets":string[]}.\n${JSON.stringify(payload)}`,
    input.model.input.includes("image") ? input.patternImages : undefined,
  );
  if (agent.state.errorMessage) throw new Error(`Listing copy model request failed: ${agent.state.errorMessage}`);
  let result = validateListingCopy(input.platform, parseJsonResponse(latestAssistantText(agent.state.messages, "Listing copy")));
  if (result) return result;
  // 超限是可恢复偏差：重申具体数值上限再做一次，仍失败则如实抛错。
  await agent.prompt(
    `Your previous result violates the platform limits. Rewrite with the same JSON schema and the same content direction, obeying exactly: ${listingPlatformRules(input.platform)} Return only the JSON.`,
  );
  if (agent.state.errorMessage) throw new Error(`Listing copy model request failed: ${agent.state.errorMessage}`);
  result = validateListingCopy(input.platform, parseJsonResponse(latestAssistantText(agent.state.messages, "Listing copy")));
  if (!result) throw new Error("Listing copy model kept violating platform limits after one bounded retry");
  return result;
}

/**
 * 平台硬校验：返回 undefined 表示违规（调用方决定重试或失败），合法时返回规整后的 ListingCopy。
 * 数值单源在 contracts 的 LISTING_PLATFORM_LIMITS，与生成提示引用同一份，不会各自漂移。
 */
export function validateListingCopy(platform: ListingPlatform, value: unknown): ListingCopy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Listing copy model returned an invalid result");
  const record = value as Record<string, unknown>;
  const limits = LISTING_PLATFORM_LIMITS[platform];
  const title = requiredText(record.title, "title", "Listing copy");
  if (title.length > limits.titleMax) return undefined;
  if ("titleMin" in limits && title.length < limits.titleMin) return undefined;
  const tags = Array.isArray(record.tags) ? record.tags.map((item) => requiredText(item, "tag", "Listing copy")) : [];
  if (tags.length > limits.tagsMax) return undefined;
  if (tags.some((tag) => tag.length > limits.tagMaxLength)) return undefined;
  const description = requiredText(record.description, "description", "Listing copy");
  const bullets = Array.isArray(record.bullets) ? record.bullets.map((item) => requiredText(item, "bullet", "Listing copy")) : [];
  if (bullets.length > 5 || bullets.some((bullet) => bullet.length > 256)) return undefined;
  return { platform, title, tags, description, bullets };
}


