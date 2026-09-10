import { DEFAULT_MAX_LAYER_EXPORT_ELEMENTS, SEGMENTATION_PROTOCOL_CAPABILITIES, isSegmentationProtocol, type SegmentationProtocol } from "@ecomgen/contracts";

/** 模型选择下拉的最小结构；ProviderConfig（schema.d.ts）与其结构兼容。 */
export interface ModelOptionSource {
  id: string;
  name: string;
  models: Array<{ id: string; supportsVision: boolean; imageApiKind?: string | null; segmentationProtocol?: string | null }>;
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

/** value 约定 `${providerId}::${modelId}`；推理排除生图与分割模型，生图要求 imageApiKind。 */
export function modelOptions(providers: ModelOptionSource[], kind: "reasoning" | "image"): ModelOption[] {
  return providers.flatMap((provider) =>
    provider.models
      .filter((model) => (kind === "image" ? Boolean(model.imageApiKind) : !model.imageApiKind && !model.segmentationProtocol))
      .map((model) => ({
        value: `${provider.id}::${model.id}`,
        label: `${provider.name} / ${model.id}`,
        vision: model.supportsVision,
      })),
  );
}

export type SegmentationProtocolValue = SegmentationProtocol;

// 协议标签唯一事实源在 contracts 能力注册表；web 只做展示层引用。
export const SEGMENTATION_PROTOCOL_LABELS = Object.fromEntries(
  Object.entries(SEGMENTATION_PROTOCOL_CAPABILITIES).map(([protocol, capability]) => [protocol, capability.label])
) as Record<SegmentationProtocol, string>;

export interface SegmentationModelOption {
  value: string;
  label: string;
  providerName: string;
  modelId: string;
  protocol: SegmentationProtocolValue;
}

/** 只列出声明了 segmentationProtocol 的模型；value 约定同 modelOptions。 */
export function segmentationModelOptions(providers: ModelOptionSource[]): SegmentationModelOption[] {
  return providers.flatMap((provider) =>
    provider.models
      .filter((model): model is typeof model & { segmentationProtocol: SegmentationProtocolValue } =>
        isSegmentationProtocol(model.segmentationProtocol))
      .map((model) => ({
        value: `${provider.id}::${model.id}`,
        label: `${provider.name} / ${model.id}（${SEGMENTATION_PROTOCOL_LABELS[model.segmentationProtocol]}）`,
        providerName: provider.name,
        modelId: model.id,
        protocol: model.segmentationProtocol,
      })),
  );
}

/** 当前分割模型允许的单次分层元素上限；未选择模型时按最大默认值放宽，最终由导出接口按协议校验。 */
export function layerElementLimit(options: SegmentationModelOption[], key: string): number {
  const protocol = options.find((option) => option.value === key)?.protocol;
  return protocol ? SEGMENTATION_PROTOCOL_CAPABILITIES[protocol].maxElements : DEFAULT_MAX_LAYER_EXPORT_ELEMENTS;
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
