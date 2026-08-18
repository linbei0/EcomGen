import { ApiError } from "./errors.js";

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export type VerifyModel = (providerId: string, modelId: string, kind: "reasoning" | "image") => void;

/** OpenAPI UpdateProjectInput.reasoningModel / imageModel 的 ModelRef 校验。 */
export function parseModelRef(value: unknown, path: string): ModelRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${path} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const { providerId, modelId } = record;
  if (typeof providerId !== "string" || !providerId.trim() || typeof modelId !== "string" || !modelId.trim()) {
    throw new ApiError(400, "VALIDATION_ERROR", `${path} must contain non-empty providerId and modelId`);
  }
  return { providerId: providerId.trim(), modelId: modelId.trim() };
}

/** 把 body 里的 ModelRef 展开为 repository.updateProject 需要的四个列字段；校验语义与创建项目一致。 */
export function applyModelFields(
  body: Record<string, unknown>,
  update: Record<string, unknown>,
  verify: VerifyModel,
): void {
  if (body.reasoningModel !== undefined) {
    const ref = parseModelRef(body.reasoningModel, "reasoningModel");
    verify(ref.providerId, ref.modelId, "reasoning");
    update.reasoningProviderId = ref.providerId;
    update.reasoningModelId = ref.modelId;
  }
  if (body.imageModel !== undefined) {
    const ref = parseModelRef(body.imageModel, "imageModel");
    verify(ref.providerId, ref.modelId, "image");
    update.imageProviderId = ref.providerId;
    update.imageModelId = ref.modelId;
  }
}
