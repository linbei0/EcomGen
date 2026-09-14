import manifest from "./skill-manifest.js";

// 本包把 .agents/skills/ecom-suite-forge 的技能文本作为源码内嵌，运行时直接读 manifest，
// 不依赖 .agents 目录（Docker 构建会排除它）。修改 skill/ 后运行 gen:forge-skill 重新生成。
const skill = manifest as unknown as { totalHash: string; files: Array<{ path: string; hash: string; text: string }> };

/** 内嵌技能文件的整体内容指纹，参与 Agent promptVersion，技能变更即视为新版本。 */
export const ECOM_SUITE_FORGE_SKILL_HASH: string = skill.totalHash;

/** 按相对路径读取内嵌技能文本；缺失时抛错以暴露 manifest 漂移。 */
export function readSkillFile(path: string): string {
  const entry = skill.files.find((file) => file.path === path);
  if (!entry) throw new Error(`ecom-suite-forge skill file not found: ${path}`);
  return entry.text;
}

// 系统提示词按“总纲 → 分类 → 分镜手册 → Prompt 合约 → 脱敏 → Schema → QA → 工作表 → 示例”顺序拼装，
// 覆盖反推全流程所需的全部约束；示例 JSON 作为少量样本提升输出结构准确率。
const PROMPT_SECTIONS = [
  "SKILL.md",
  "references/category-taxonomy.md",
  "references/shot-playbook.md",
  "references/prompt-contract.md",
  "references/de-identification.md",
  "references/suite-schema.md",
  "references/quality-checklist.md",
  "assets/analysis-worksheet.md",
  "assets/suite-template.example.json"
] as const;

const OUTPUT_CONTRACT = [
  "## ECOMGEN OUTPUT CONTRACT (highest priority)",
  "",
  "You will receive a set of reference images (one main product). Analyze the whole set and output ONE suite template.",
  "Return ONLY a single JSON object, no markdown fences, no commentary. It must match the suite schema above with these EcomGen specifics:",
  "- `schemaVersion`: 1, `kind`: \"ecomgen.suite\".",
  "- `id`: suite-<l1-slug>-<leaf-slug>, lowercase ascii hyphenated (EcomGen prefixes it with custom- when saving).",
  "- `name`: 6–20 Chinese characters with a 款式名 feel.",
  "- `category.l1` / `category.l2` MUST be exact strings from the taxonomy; `leaf` is free text; include 3–8 `leafKeywords`.",
  "- `productFamily`: one of fashion, electronics, beauty, food, home, jewelry.",
  "- `description`: one line, <= 40 Chinese characters.",
  "- `styleLock`: fill every field and provide the assembled English `lockText`.",
  "- `shots`: 5–12 items ordered 1..N as a conversion funnel; provide EVERY per-shot field from the schema (shotId, order, shotRole, displayName, intent, assetType, mode, aspectRatio, resolution, camera, lighting, background, props, productOccupancy, whitespace, textZone, promptTemplate, supportsImageReference).",
  "- `aspectRatio` in {1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9}; `resolution` in {1K, 2K, 4K}.",
  "- Every `promptTemplate` is English, uses only the placeholders {product}, {product_identity_lock}, {style_lock}, {selling_point_1..n}, {callout_1..n}, {accent_color}, contains the verbatim product-fidelity lock, and ends with a concrete negative list.",
  "- Every `promptTemplate` must include the SAME `styleLock.lockText` verbatim.",
  "- `assetType` = `<id>::<shotId>`. It is metadata only and must NEVER appear inside prompts.",
  "- `provenance`: { sourceKind: \"viral-reference-set\", sourceImageCount: <number of images analyzed>, detached: true, notes: \"...\" }.",
  "- Never invent certifications, ratings, sales, awards or efficacy claims; use `proof placeholder` instead.",
  "- The suite must be reusable when {product} is swapped for a different product of the same family."
].join("\n");

/** 组装 suite-forge Agent 的系统提示词：内嵌技能全文 + EcomGen 输出契约。 */
export function forgeSystemPrompt(): string {
  const sections = PROMPT_SECTIONS.map((path) => `\n\n===== ${path} =====\n${readSkillFile(path)}`).join("");
  return `You are the EcomGen Suite Forge analyst. Reverse-engineer one set of viral e-commerce images into one reusable suite template.\n${sections}\n\n${OUTPUT_CONTRACT}\n`;
}
