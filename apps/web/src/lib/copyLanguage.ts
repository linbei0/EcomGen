export const COPY_LANGUAGE_OPTIONS = [
  { value: "zh-Hans", label: "简体中文", aliases: ["zh", "zh-cn", "zh-hans", "chinese", "simplified chinese", "中文", "简体", "简中"] },
  { value: "zh-Hant", label: "繁体中文", aliases: ["zh-tw", "zh-hk", "zh-mo", "zh-hant", "traditional chinese", "繁体", "繁中", "繁體中文", "繁體"] },
  { value: "en-US", label: "英语（美国）", aliases: ["en", "en-us", "english", "english us", "american english", "美式英语", "英语"] },
  { value: "en-GB", label: "英语（英国）", aliases: ["en-gb", "english uk", "british english", "英式英语"] },
  { value: "de-DE", label: "德语", aliases: ["de", "de-de", "german"] },
  { value: "fr-FR", label: "法语", aliases: ["fr", "fr-fr", "french"] },
  { value: "it-IT", label: "意大利语", aliases: ["it", "it-it", "italian"] },
  { value: "es-ES", label: "西班牙语", aliases: ["es", "es-es", "spanish"] },
  { value: "ja-JP", label: "日语", aliases: ["ja", "ja-jp", "japanese", "日文"] },
  { value: "ko-KR", label: "韩语", aliases: ["ko", "ko-kr", "korean", "韩文", "한국어"] }
] as const;

function normalize(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", "-").replace(/\s+/g, " ");
}

function findCopyLanguage(input: string) {
  const key = normalize(input);
  if (!key) return undefined;
  return COPY_LANGUAGE_OPTIONS.find((option) => option.value.toLowerCase() === key || normalize(option.label) === key || option.aliases.some((alias) => normalize(alias) === key));
}

/** 输入框展示中文名；已保存的 BCP-47 代码也要能还原成中文名。 */
export function copyLanguageLabel(code: string | null | undefined): string {
  const value = code?.trim() ?? "";
  return findCopyLanguage(value)?.label ?? value;
}

/** 选择或输入中文名、别名、代码时，统一存成 BCP-47；无法识别则原样保存。 */
export function resolveCopyLanguage(input: string): string {
  const value = input.trim();
  return findCopyLanguage(value)?.value ?? value;
}

export function copyLanguageOptionMatches(input: string, optionValue: string): boolean {
  const query = normalize(input);
  if (!query) return true;
  if (COPY_LANGUAGE_OPTIONS.some((item) => normalize(item.label) === query)) return true;
  const option = COPY_LANGUAGE_OPTIONS.find((item) => item.label === optionValue);
  if (!option) return optionValue.toLowerCase().includes(query);
  return [option.label, option.value, ...option.aliases].some((text) => normalize(text).includes(query));
}

export const COPY_LANGUAGE_AUTOCOMPLETE_OPTIONS = COPY_LANGUAGE_OPTIONS.map((option) => ({ value: option.label }));
