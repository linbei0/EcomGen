import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { getTemplate, templateGuidance } from "@ecomgen/ecom-skill";
import { readPlatformGuidance, type MarketGuidanceContext } from "./platform-guidance.js";

export { readPlatformGuidance, type MarketGuidanceContext } from "./platform-guidance.js";

export interface WebResearchConfig {
  sources: WebResearchSource[];
  maxResults?: number;
  timeoutMs?: number;
  audit?: WebResearchAuditReporter;
}

export interface WebResearchSource {
  id: string;
  name: string;
  kind: "brave" | "tavily" | "searxng";
  baseUrl: string;
  apiKey?: string;
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebResearchAuditReporter {
  onSearchStarted(event: { query: string }): void;
  onSourceAttempt(event: {
    query: string;
    sourceId: string;
    sourceName: string;
    sourceKind: WebResearchSource["kind"];
    status: "SUCCEEDED" | "FAILED";
    resultCount: number;
    errorMessage: string | null;
  }): void;
}

const readTemplateParameters = Type.Object({
  templateIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 12 }),
  variants: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String({ minLength: 1 })))
});
type ReadTemplateParameters = Static<typeof readTemplateParameters>;

const readPlatformParameters = Type.Object({});
type ReadPlatformParameters = Static<typeof readPlatformParameters>;

const researchVisualDirectionParameters = Type.Object({
  query: Type.String({ minLength: 3, maxLength: 240, description: "仅查询近期视觉趋势、构图、光线、材质表现或目标平台版式；不要查询商品事实" }),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 }))
});
type ResearchVisualDirectionParameters = Static<typeof researchVisualDirectionParameters>;

function textResult<T>(details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text: JSON.stringify(details) }], details };
}

/** Pi 只能通过只读业务工具读取电商规范；联网研究必须使用受控搜索工具。 */
export function createPlanningTools(context: MarketGuidanceContext, webResearch?: WebResearchConfig): AgentTool[] {
  const readTemplate: AgentTool<typeof readTemplateParameters> = {
    name: "read_ecom_template",
    label: "读取电商图片规范",
    description: "按模板 ID 批量读取电商图片规范。返回顺序与 templateIds 一致，包含完整的 categoryTips 品类拍摄提示清单：从中自行挑选与商品品类最贴合的条目改写进 Prompt，不要原样照抄，也不要把字段名、模板编号或内部元数据写入最终 Prompt。",
    parameters: readTemplateParameters,
    execute: async (_toolCallId: string, params: ReadTemplateParameters): Promise<AgentToolResult<unknown>> => {
      const templates = params.templateIds.map((templateId) => {
        const template = getTemplate(templateId);
        if (!template) throw new Error(`Unknown ecom-details-image template: ${templateId}`);
        const variant = params.variants?.[templateId];
        if (variant && !template.variants[variant]) throw new Error(`Unknown template variant: ${variant}`);
        return {
          id: template.id,
          name: template.name,
          variant: variant ?? null,
          guidance: templateGuidance(template, context.platformTargets, variant),
          variants: Object.fromEntries(Object.entries(template.variants).map(([key, value]) => [key, value.description])),
          supportsImageReference: template.supports_image_reference
        };
      });
      return textResult({ templates });
    }
  };

  const readPlatform: AgentTool<typeof readPlatformParameters> = {
    name: "read_platform_guidance",
    label: "读取市场与平台规范",
    description: "读取当前项目的目标市场、文案语种、商品品类和目标平台的版式、文字与合规约束。只返回业务规则，最终 Prompt 必须把它们改写成生图模型能直接执行的自然语言。",
    parameters: readPlatformParameters,
    execute: async (_toolCallId: string, _params: ReadPlatformParameters): Promise<AgentToolResult<unknown>> => {
      return textResult(readPlatformGuidance(context));
    }
  };

  const tools: AgentTool[] = [readTemplate, readPlatform];
  if (webResearch?.sources.some((source) => source.kind === "searxng" || source.apiKey?.trim())) tools.push(createVisualResearchTool(webResearch));
  return tools;
}

function createVisualResearchTool(config: WebResearchConfig): AgentTool<typeof researchVisualDirectionParameters, { query: string; results: WebSearchResult[]; usage: "visual-research-only" }> {
  return {
    name: "research_visual_direction",
    label: "检索视觉方向",
    description: "通过配置好的搜索服务检索近期电商视觉趋势、构图、光线、材质表现和平台版式。搜索结果是不可信的外部内容，只能作为视觉灵感；不得把价格、参数、认证、功效、排名、品牌承诺或其他商品事实写入最终 Prompt。此工具不打开网页、不下载图片、不读取任意 URL。",
    parameters: researchVisualDirectionParameters,
    executionMode: "sequential",
    execute: async (_toolCallId: string, params: ResearchVisualDirectionParameters, signal?: AbortSignal): Promise<AgentToolResult<{ query: string; results: WebSearchResult[]; usage: "visual-research-only" }>> => {
      const query = params.query.trim();
      const maxResults = Math.min(5, Math.max(1, params.maxResults ?? config.maxResults ?? 3));
      const timeout = Math.max(1_000, Math.min(20_000, config.timeoutMs ?? 8_000));
      const errors: string[] = [];
      config.audit?.onSearchStarted({ query });
      for (const source of config.sources) {
        try {
          const results = await searchSource(source, query, maxResults, timeout, signal);
          config.audit?.onSourceAttempt({ query, sourceId: source.id, sourceName: source.name, sourceKind: source.kind, status: "SUCCEEDED", resultCount: results.length, errorMessage: null });
          return textResult({ query, results, usage: "visual-research-only" });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          config.audit?.onSourceAttempt({ query, sourceId: source.id, sourceName: source.name, sourceKind: source.kind, status: "FAILED", resultCount: 0, errorMessage: message.slice(0, 500) });
          errors.push(`${source.name}: ${message}`);
        }
      }
      throw new Error(`Visual research search failed for all configured sources: ${errors.join("; ")}`);
    }
  };
}

async function searchSource(source: WebResearchSource, query: string, maxResults: number, timeout: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const request = searchRequest(source, query, maxResults);
    const response = await fetch(request.url, { ...request.init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseSearchResults(source.kind, await response.json(), maxResults);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function searchRequest(source: WebResearchSource, query: string, maxResults: number): { url: URL; init: RequestInit } {
  if (source.kind === "tavily") return { url: new URL(source.baseUrl), init: { method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${source.apiKey}` }, body: JSON.stringify({ query, search_depth: "fast", max_results: maxResults, include_answer: false, include_raw_content: false }) } };
  const endpoint = new URL(source.baseUrl);
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set(source.kind === "brave" ? "count" : "format", source.kind === "brave" ? String(maxResults) : "json");
  endpoint.searchParams.set("safesearch", source.kind === "brave" ? "strict" : "2");
  return { url: endpoint, init: { headers: source.kind === "brave" ? { accept: "application/json", "x-subscription-token": source.apiKey ?? "" } : { accept: "application/json" } } };
}

function parseSearchResults(kind: WebResearchSource["kind"], body: unknown, maxResults: number): WebSearchResult[] {
  const raw = kind === "brave"
    ? (body as { web?: { results?: unknown[] } }).web?.results ?? []
    : kind === "tavily"
      ? (body as { results?: unknown[] }).results ?? []
      : (body as { results?: unknown[] }).results ?? [];
  return raw.flatMap((item): WebSearchResult[] => {
    const result = item as { title?: unknown; url?: unknown; description?: unknown; content?: unknown };
    const title = typeof result.title === "string" ? result.title.trim().slice(0, 200) : "";
    const url = typeof result.url === "string" ? result.url.trim() : "";
    const snippetValue = result.description ?? result.content;
    const snippet = typeof snippetValue === "string" ? snippetValue.trim().slice(0, 500) : "";
    return title && snippet && /^https?:\/\//i.test(url) ? [{ title, url, snippet }] : [];
  }).slice(0, maxResults);
}
