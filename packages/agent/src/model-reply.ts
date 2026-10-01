import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * 文案链路共用的模型应答读取：项目域（copywriter）与花型 Listing（listing-copywriter）
 * 的结构化校验都从"最后一条 assistant 文本"起步。错误文案携带调用方前缀以区分链路。
 */

/** 取最后一条 assistant 消息的纯文本；空文本是模型链路故障，按错误处理而不是返回空串。 */
export function latestAssistantText(messages: readonly AgentMessage[], errorPrefix: string): string {
  const response = [...messages].reverse().find((message) => message.role === "assistant");
  const text = response
    ? response.content.filter((part) => part.type === "text").map((part) => ("text" in part ? part.text : "")).join("\n")
    : "";
  if (!text) throw new Error(`${errorPrefix} model returned no text`);
  return text;
}

/** 读取必填字符串字段：空白视为缺失，trim 后返回。 */
export function requiredText(value: unknown, field: string, errorPrefix: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${errorPrefix} model returned an invalid ${field}`);
  return value.trim();
}
