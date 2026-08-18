import type { components } from "./schema.d.ts";

export type PlanningJobInput = components["schemas"]["CreatePlanningJobInput"];

/**
 * OpenAPI 要求 imageTypes；运行时 handler 只读 requestedTypes。
 * 双写以满足类型检查，并让本机 API 真正规划所选模板。
 */
export function serializePlanningBody(input: PlanningJobInput): string {
  return JSON.stringify({
    imageTypes: input.imageTypes,
    requestedTypes: input.imageTypes,
    allowAgentRecommendations: input.allowAgentRecommendations,
    userInstruction: input.userInstruction,
  });
}
