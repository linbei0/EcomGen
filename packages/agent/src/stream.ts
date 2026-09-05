import type { StreamFn } from "@earendil-works/pi-agent-core";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";

// pi-ai 的流式调用默认无每轮超时且 maxRetries=0，长连接挂起会一直阻塞到任务失败；
// 大项目（多图、多分镜）的 Agent 轮次可能持续数分钟，显式给出超时与瞬时错误重试。
const AGENT_TURN_TIMEOUT_MS = 240_000;
const AGENT_TURN_MAX_RETRIES = 2;

/** 包装 pi-ai 流式调用，为每轮请求注入超时上限与瞬时错误重试。 */
export function boundedAgentStream(): StreamFn {
  const completions = openAICompletionsApi().stream;
  const responses = openAIResponsesApi().stream;
  return (model, context, options) => {
    // pi-ai 的 stream 只读 reasoningEffort，而 Agent 传入的是 reasoning（thinkingLevel）；
    // 直接透传会被静默丢弃，zai 家族（如直连智谱）会退化为显式关闭思考，始终思考的
    // 模型（glm-5.3-flash）因此报 1210。此处按 streamSimple 的语义转换档位。
    const { reasoning, ...boundedOptions } = options ?? {};
    const finalOptions = {
      ...boundedOptions,
      ...(reasoning !== undefined ? { reasoningEffort: reasoning } : {}),
      timeoutMs: AGENT_TURN_TIMEOUT_MS,
      maxRetries: AGENT_TURN_MAX_RETRIES,
    };
    return model.api === "openai-responses"
      ? responses(model, context, finalOptions)
      : completions(model, context, finalOptions);
  };
}
