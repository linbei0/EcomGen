import type { CreateGenerationJobInput } from "@ecomgen/contracts";

export type GenerationJobInput = CreateGenerationJobInput;

/** 显式列出分镜 ID，排序后序列化，供后端指纹去重。 */
export function serializeGenerationBody(input: GenerationJobInput): string {
  const storyboardItemIds = [...input.storyboardItemIds].sort();
  const body: GenerationJobInput = { storyboardItemIds };
  const revision = input.revision?.trim();
  if (revision) body.revision = revision;
  if (input.generationBatchId) body.generationBatchId = input.generationBatchId;
  if (input.generationConfig) body.generationConfig = input.generationConfig;
  return JSON.stringify(body);
}
