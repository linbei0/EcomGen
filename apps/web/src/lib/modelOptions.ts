/** 模型选择下拉的最小结构；ProviderConfig（schema.d.ts）与其结构兼容。 */
export interface ModelOptionSource {
  id: string;
  name: string;
  models: Array<{ id: string; supportsVision: boolean; imageApiKind?: string | null }>;
}

export interface ModelOption {
  value: string;
  label: string;
  vision: boolean;
}

export interface ModelPair {
  reasoningProviderId: string;
  reasoningModelId: string;
  imageProviderId: string;
  imageModelId: string;
}

/** value 约定 `${providerId}::${modelId}`；推理排除生图模型，生图要求 imageApiKind。 */
export function modelOptions(providers: ModelOptionSource[], kind: "reasoning" | "image"): ModelOption[] {
  return providers.flatMap((provider) =>
    provider.models
      .filter((model) => (kind === "image" ? Boolean(model.imageApiKind) : !model.imageApiKind))
      .map((model) => ({
        value: `${provider.id}::${model.id}`,
        label: `${provider.name} / ${model.id}`,
        vision: model.supportsVision,
      })),
  );
}

/** 首页一键创建取第一对可用模型；凑不齐一对时返回 null，由调用方引导去设置。 */
export function pickDefaultModels(providers: ModelOptionSource[]): ModelPair | null {
  const reasoning = modelOptions(providers, "reasoning")[0];
  const image = modelOptions(providers, "image")[0];
  if (!reasoning || !image) return null;
  const [reasoningProviderId, reasoningModelId] = reasoning.value.split("::");
  const [imageProviderId, imageModelId] = image.value.split("::");
  if (!reasoningProviderId || !reasoningModelId || !imageProviderId || !imageModelId) return null;
  return { reasoningProviderId, reasoningModelId, imageProviderId, imageModelId };
}
