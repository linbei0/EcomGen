/**
 * 剪贴板连接信息解析：把中转站「一键复制」的内容拆成 Provider 表单可用的字段。
 * 覆盖的来源（按命中优先级）：
 * 1. New API「复制连接信息」：`{"_type":"newapi_channel_conn","key":"sk-…","url":"https://站点根"}`；
 * 2. 客户端导入深链：`cherrystudio://` / `deepchat://` / `aionui://` 的 `data` 参数是
 *    urlsafe-base64(JSON{id,baseUrl,apiKey,…})，`ccswitch://` 用查询参数直传；
 * 3. 朴素文本：地址行 + 密钥行（任意顺序）、环境变量对（OPENAI_BASE_URL / OPENAI_API_KEY 等）。
 * 密钥只在此模块内流转，不打日志、不外发。
 */

/** 解析结果；纯地址或纯密钥粘贴时只填对应字段。 */
export interface ProviderConnectionDraft {
  baseUrl?: string;
  apiKey?: string;
  name?: string;
}

/** 与 EcomGen 无关的 scheme 不做深链解析，避免误吞普通 URL。 */
const DEEP_LINK_SCHEMES = new Set(["cherrystudio", "deepchat", "aionui", "ccswitch"]);

/**
 * 校验并规范化 base URL：剥掉从文档/网页连复制时带上的引号与尖括号；
 * 站点根地址（无路径）补 `/v1`——New API 复制的 url 不带版本段，而 OpenAI 兼容
 * 端点挂在 /v1 下；已带路径（/v1、/v1beta、网关自定义前缀）时尊重原值。
 * 不是合法 URL 时返回 null。
 */
export function normalizeProviderBaseUrl(input: string): string | null {
  const trimmed = input.trim().replace(/^["'<(]+/, "").replace(/["'>)]+$/, "");
  if (trimmed === "") return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.pathname === "/" || url.pathname === "") return `${url.origin}/v1`;
  return url.toString().replace(/\/$/, "");
}

/** 宽松取值：兼容 camelCase / snake_case 常见命名。 */
function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function draftFromJsonObject(value: unknown): ProviderConnectionDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const apiKey = pickString(record, ["apiKey", "api_key", "key"]);
  const baseUrl = normalizeProviderBaseUrl(pickString(record, ["baseUrl", "base_url", "url"]) ?? "");
  const name = pickString(record, ["name", "providerName"]);
  if (!apiKey && !baseUrl) return null;
  return { ...(apiKey ? { apiKey } : {}), ...(baseUrl ? { baseUrl } : {}), ...(name ? { name } : {}) };
}

function parseDeepLink(text: string, scheme: string): ProviderConnectionDraft | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (scheme === "ccswitch") {
    // ccswitch://v1/import?resource=provider&apiKey=…&endpoint=…&name=…
    const apiKey = url.searchParams.get("apiKey") ?? undefined;
    const endpoint = url.searchParams.get("endpoint") ?? undefined;
    const name = url.searchParams.get("name") ?? undefined;
    const baseUrl = endpoint === undefined ? undefined : normalizeProviderBaseUrl(endpoint) ?? undefined;
    if (!apiKey && !baseUrl) return null;
    return { ...(apiKey ? { apiKey } : {}), ...(baseUrl ? { baseUrl } : {}), ...(name ? { name } : {}) };
  }
  const data = url.searchParams.get("data");
  if (!data) return null;
  // 站点把 base64 的 +/ 替换成 -_ 以避开查询串编码，这里还原后再按 UTF-8 解码
  // （载荷里常有中文 Provider 名，atob 的 Latin-1 结果会乱码）
  const base64 = data.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
    return draftFromJsonObject(JSON.parse(decoded));
  } catch {
    return null;
  }
}

/** 逐行扫描：环境变量对、http(s) 地址、sk-/AIza/长令牌样式的密钥。 */
function scanPlainConnectionText(text: string): ProviderConnectionDraft | null {
  let apiKey: string | undefined;
  let baseUrl: string | undefined;

  for (const line of text.split(/\r?\n/)) {
    const envMatch = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
    if (!envMatch) continue;
    const name = envMatch[1]!;
    if (!apiKey && /(API_KEY|AUTH_TOKEN)$/i.test(name)) apiKey = envMatch[2];
    else if (!baseUrl && /(BASE_URL|API_BASE|API_HOST)$/i.test(name)) baseUrl = normalizeProviderBaseUrl(envMatch[2]!) ?? undefined;
  }

  const urlMatches = text.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  for (const candidate of urlMatches) {
    const normalized = normalizeProviderBaseUrl(candidate);
    if (normalized) {
      baseUrl ??= normalized;
      break;
    }
  }

  if (!apiKey) {
    // 在剔除 URL 片段后的文本里找密钥，避免把 URL 里的 base64 参数误当密钥
    const urlFree = urlMatches.reduce((remaining, match) => remaining.replaceAll(match, " "), text);
    const skStyle = /\bsk-[A-Za-z0-9_-]{8,}/.exec(urlFree);
    const googleStyle = /\bAIza[A-Za-z0-9_-]{30,}/.exec(urlFree);
    // 兜底长令牌：JWT/自定义前缀密钥；用显式边界而不是 \b（- 不是单词字符）
    const bareToken = /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{40,})(?![A-Za-z0-9_-])/.exec(urlFree);
    apiKey = skStyle?.[0] ?? googleStyle?.[0] ?? bareToken?.[2];
  }

  if (!baseUrl && !apiKey) return null;
  return { ...(baseUrl ? { baseUrl } : {}), ...(apiKey ? { apiKey } : {}) };
}

export function parseConnectionText(text: string): ProviderConnectionDraft | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  if (trimmed.startsWith("{")) {
    try {
      const draft = draftFromJsonObject(JSON.parse(trimmed));
      if (draft) return draft;
    } catch {
      // 不是合法 JSON，继续按文本扫描
    }
  }

  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  if (schemeMatch && DEEP_LINK_SCHEMES.has(schemeMatch[1]!.toLowerCase())) {
    const draft = parseDeepLink(trimmed, schemeMatch[1]!.toLowerCase());
    if (draft) return draft;
  }

  return scanPlainConnectionText(trimmed);
}
