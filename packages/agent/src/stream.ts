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
    const boundedOptions = { ...options, timeoutMs: AGENT_TURN_TIMEOUT_MS, maxRetries: AGENT_TURN_MAX_RETRIES };
    return model.api === "openai-responses"
      ? responses(model, context, boundedOptions)
      : completions(model, context, boundedOptions);
  };
}
