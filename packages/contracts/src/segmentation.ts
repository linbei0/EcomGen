/**
 * 分割协议注册表：新增渠道只需在此登记一条能力记录并实现对应协议适配器，
 * api/worker/web 的协议校验、探测分派、元素上限与显示名都从此派生，
 * 不再在各业务文件里维护逐协议的枚举副本。
 */
export const SEGMENTATION_PROTOCOLS = ["fal", "grounded_sam", "seedream_layerize", "gitee_sam3"] as const;

export type SegmentationProtocol = (typeof SEGMENTATION_PROTOCOLS)[number];

export interface SegmentationProtocolCapability {
  /** Provider 表单与分层面板共用的显示名。 */
  label: string;
  /** 单次分层导出的元素上限，由渠道计费与单次推理性能决定。 */
  maxElements: number;
  /** 协议是否接受像素框提示；决定手动画框元素能否参与该渠道的分割。 */
  supportsBoxPrompts: boolean;
}

export const SEGMENTATION_PROTOCOL_CAPABILITIES: Record<SegmentationProtocol, SegmentationProtocolCapability> = {
  fal: { label: "fal.ai SAM 3", maxElements: 32, supportsBoxPrompts: true },
  grounded_sam: { label: "Grounded-SAM（自部署）", maxElements: 32, supportsBoxPrompts: true },
  seedream_layerize: { label: "Seedream 图层拆分", maxElements: 16, supportsBoxPrompts: true },
  gitee_sam3: { label: "Gitee AI SAM 3", maxElements: 32, supportsBoxPrompts: false }
};

/** 未选择分割模型时的画框数量默认上限，取 fal 渠道的上限。 */
export const DEFAULT_MAX_LAYER_EXPORT_ELEMENTS = SEGMENTATION_PROTOCOL_CAPABILITIES.fal.maxElements;

/** 未知值守卫：api/worker/web 的枚举校验共用，替代逐协议的字面量比较链。 */
export function isSegmentationProtocol(value: unknown): value is SegmentationProtocol {
  return typeof value === "string" && (SEGMENTATION_PROTOCOLS as readonly unknown[]).includes(value);
}
