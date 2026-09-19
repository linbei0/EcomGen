import type { Agent } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import { forgeSystemPrompt } from "@ecomgen/ecom-suite-forge";
import { createAgent, type ReasoningModel } from "./runtime.js";
import { parseJsonResponse } from "./json-response.js";
import { ShotStreamCounter } from "./shot-progress.js";
import { SUITE_FORGE_OUTPUT_SCHEMA } from "./structured-output.js";

/** 用户在页面上可选的反推约束；缺省时由模型按套图自身特征推断。 */
export interface SuiteForgeHints {
  name?: string;
  l1?: string;
  l2?: string;
  leaf?: string;
  productFamily?: string;
  targetShotCount?: number;
  userInstruction?: string;
}

export interface SuiteForgeInput {
  model: ReasoningModel;
  apiKey: string;
  images: ImageContent[];
  hints?: SuiteForgeHints;
  /**
   * 流式反推过程中已生成的分镜数。
   *
   * 在 agent 的订阅链上被同步调用：实现方在其中 await 会把写库往返反压到模型流上，
   * 只应做同步记录，落库交给流之外的节流/串行逻辑。
   */
  onShotProgress?: (shotsGenerated: number) => void;
}

// 套图反推把一组爆款整图拆解为可复用的套图模板 JSON；只产出模板，不生成图片，也不绑定具体产品。
// 因此这里只做视觉理解 + JSON 结构化输出，产出交回 Worker 校验与入库。
export async function forgeSuite(input: SuiteForgeInput): Promise<Record<string, unknown>> {
  const agent = createAgent({ workflow: "SUITE_FORGE", model: input.model, apiKey: input.apiKey, systemPrompt: forgeSystemPrompt(), tools: [], outputSchema: SUITE_FORGE_OUTPUT_SCHEMA });
  // 订阅在 prompt 之前建立、结束后立即解除：它只服务于本次生成的进度观察。
  const unsubscribe = input.onShotProgress ? observeGeneratedShots(agent, input.onShotProgress) : undefined;
  try {
    await agent.prompt(buildInstruction(input.images.length, input.hints), input.model.input.includes("image") ? input.images : undefined);
  } finally {
    unsubscribe?.();
  }
  if (agent.state.errorMessage) throw new Error(`Suite forge model request failed: ${agent.state.errorMessage}`);
  const response = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
  const text = response && response.role === "assistant" ? response.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
  if (!text) throw new Error("Suite forge model returned no text");
  const parsed = parseJsonResponse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Suite forge model did not return a JSON object");
  return parsed as Record<string, unknown>;
}

/**
 * 订阅流式增量并回报已生成的分镜数。
 *
 * Agent 本身已经维护 streamingMessage 并按 delta 发事件，这里不额外缓冲整份响应，
 * 只把每个文本增量喂给计数器。一轮 turn（或一条消息）开始时重置计数：boundedAgentStream
 * 配了瞬时错误重试，重发会让同一段 JSON 再流一遍，不清零就会重复累加。
 */
function observeGeneratedShots(agent: Agent, onShotProgress: (shotsGenerated: number) => void): () => void {
  const counter = new ShotStreamCounter();
  let reported = 0;
  return agent.subscribe((event) => {
    if (event.type === "turn_start" || event.type === "message_start") {
      counter.reset();
      reported = 0;
      return;
    }
    if (event.type !== "message_update" || event.assistantMessageEvent.type !== "text_delta") return;
    const count = counter.push(event.assistantMessageEvent.delta);
    // 只在整数变化时回调：下游按回调次数写库，逐 delta 回调会把写入次数从「分镜数」放大到「token 数」。
    if (count === reported) return;
    reported = count;
    onShotProgress(count);
  });
}

function buildInstruction(imageCount: number, hints: SuiteForgeHints = {}): string {
  const lines = [`Analyze the ${imageCount} reference image${imageCount === 1 ? "" : "s"} of this single product set and forge ONE reusable suite template.`];
  if (hints.l1) lines.push(`Use category L1 exactly: ${hints.l1}`);
  if (hints.l2) lines.push(`Use category L2 exactly: ${hints.l2}`);
  if (hints.leaf) lines.push(`Use this leaf product name: ${hints.leaf}`);
  if (hints.name) lines.push(`Use this suite name: ${hints.name}`);
  if (hints.productFamily) lines.push(`Use productFamily: ${hints.productFamily}`);
  if (hints.targetShotCount) lines.push(`Produce about ${hints.targetShotCount} shots.`);
  if (hints.userInstruction) lines.push(`Additional requirement: ${hints.userInstruction}`);
  lines.push("Return only the suite JSON.");
  return lines.join("\n");
}
