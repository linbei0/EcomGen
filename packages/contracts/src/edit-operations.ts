import type { CompositePolicy, EditExecutionMode, EditOperation } from "./enums.js";

/**
 * 编辑操作的能力注册表：显示名、规划期硬约束、需要人工确认与否都从这里派生。
 * 此前同一份操作清单分散在 agent 的校验、给模型的 JSON schema、worker 的能力判定
 * 和 Web 的标签表里，任一处增删都会让其它层静默失配；新增操作只改这里和
 * enums.ts 的 EDIT_OPERATIONS。
 */
export interface EditOperationCapability {
  /** 计划卡片与结果说明共用的显示名。 */
  label: string;
  /** 计划卡片上"影响范围"的说明；缺省表示该操作不需要额外提示。 */
  impactHint?: string;
  /** 缺少参考素材时规划必须失败：替换商品需要参考图才能确定替换目标。 */
  requiresReferenceAssets: boolean;
  /** 缺少画布扩张时规划必须失败。 */
  requiresCanvasExpansion: boolean;
  /** 必须使用 MASKED 执行方式，否则规划失败。 */
  requiresMaskedExecution: boolean;
  /** 除澄清态外是否需要人工确认后才进入生成。 */
  requiresConfirmation: boolean;
  /** 该操作需要 Provider 声明自然融合能力。 */
  requiresNaturalBlend: boolean;
}

export const EDIT_OPERATION_CAPABILITIES: Record<EditOperation, EditOperationCapability> = {
  PRECISE_INPAINT: { label: "局部精确修改", requiresReferenceAssets: false, requiresCanvasExpansion: false, requiresMaskedExecution: true, requiresConfirmation: false, requiresNaturalBlend: false },
  PRODUCT_REPLACE: { label: "替换商品", requiresReferenceAssets: true, requiresCanvasExpansion: false, requiresMaskedExecution: false, requiresConfirmation: true, requiresNaturalBlend: false },
  SCENE_ADJUST: { label: "调整场景", impactHint: "整张场景，主体尽量保持", requiresReferenceAssets: false, requiresCanvasExpansion: false, requiresMaskedExecution: false, requiresConfirmation: true, requiresNaturalBlend: true },
  OUTPAINT: { label: "扩展画布", impactHint: "新增画布区域，原图区域锁定", requiresReferenceAssets: false, requiresCanvasExpansion: true, requiresMaskedExecution: false, requiresConfirmation: true, requiresNaturalBlend: false },
  NATURAL_FUSION: { label: "自然融合", impactHint: "选中区域及其边缘，保护标记优先", requiresReferenceAssets: false, requiresCanvasExpansion: false, requiresMaskedExecution: false, requiresConfirmation: true, requiresNaturalBlend: true },
};

export interface EditExecutionModeCapability {
  /** 计划卡片上的执行方式说明。 */
  label: string;
}

export const EDIT_EXECUTION_MODE_CAPABILITIES: Record<EditExecutionMode, EditExecutionModeCapability> = {
  MODEL_DIRECTED: { label: "模型根据图片自行判断修改范围" },
  MASKED: { label: "仅修改已标记区域" },
  OUTPAINT: { label: "仅生成新增画布区域" },
  NEED_INPUT: { label: "需要补充编辑信息" },
};

/** 执行方式决定合成策略：蒙版锁定、扩图，其余交给 Provider 返回结果。 */
export function compositePolicyFor(executionMode: EditExecutionMode): CompositePolicy {
  if (executionMode === "MASKED") return "MASK_LOCKED";
  if (executionMode === "OUTPAINT") return "OUTPAINT";
  return "PROVIDER_RESULT";
}

/** 澄清态不进入生成，其余情况下模型自选范围或操作本身有歧义时都需要人工确认。 */
export function requiresConfirmationFor(operation: EditOperation, executionMode: EditExecutionMode): boolean {
  if (executionMode === "NEED_INPUT") return false;
  return executionMode === "MODEL_DIRECTED" || EDIT_OPERATION_CAPABILITIES[operation].requiresConfirmation;
}
