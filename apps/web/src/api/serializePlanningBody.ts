import type { components } from "./schema.d.ts";

export type PlanningJobInput = components["schemas"]["CreatePlanningJobInput"];

export function serializePlanningBody(input: PlanningJobInput): string {
  const types = input.requestedTypes ?? input.imageTypes;
  return JSON.stringify({
    planningMode: input.planningMode,
    requestedTypes: types,
    imageTypes: types,
    userInstruction: input.userInstruction,
    candidatesPerType: input.candidatesPerType,
    imageResolution: input.imageResolution,
    imageAspectRatio: input.imageAspectRatio,
    regenerationKey: input.regenerationKey,
  });
}
