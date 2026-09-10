import type { SegmentationProtocol } from "@ecomgen/contracts";

import type { FalSegmentationInput, FalSegmentationResult } from "./fal.js";
import { FalSegmentationProvider } from "./fal.js";
import { GroundedSamSegmentationProvider } from "./grounded-sam.js";
import { GiteeSam3SegmentationProvider } from "./gitee-sam3.js";
import type { ProviderConnection } from "./openai-compatible.js";

/**
 * 逐元素文本/框提示分割协议（seedream_layerize 走整图图层合成，不经过此接口）。
 * 新增协议时在 contracts 注册能力记录，并在此工厂加一个 case——业务代码不再按协议分支。
 */
export type PromptSegmentationProtocol = Exclude<SegmentationProtocol, "seedream_layerize">;

export interface SegmentationProviderLike {
  segment(input: FalSegmentationInput): Promise<FalSegmentationResult>;
  probe(): Promise<{ latencyMs: number; models: null }>;
}

export function createSegmentationProvider(protocol: PromptSegmentationProtocol, connection: ProviderConnection): SegmentationProviderLike {
  switch (protocol) {
    case "grounded_sam": return new GroundedSamSegmentationProvider(connection);
    case "gitee_sam3": return new GiteeSam3SegmentationProvider(connection);
    case "fal": return new FalSegmentationProvider(connection);
  }
}
