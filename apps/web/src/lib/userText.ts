export const EDIT_OPERATION_LABEL = {
  PRECISE_INPAINT: "局部精确修改",
  PRODUCT_REPLACE: "替换商品",
  SCENE_ADJUST: "调整场景",
  OUTPAINT: "扩展画布",
  NATURAL_FUSION: "自然融合",
} as const;

export const EDIT_EXECUTION_MODE_LABEL = {
  MODEL_DIRECTED: "模型根据图片自行判断修改范围",
  MASKED: "仅修改已标记区域",
  OUTPAINT: "仅生成新增画布区域",
  NEED_INPUT: "需要补充编辑信息",
} as const;

const EDIT_ERROR_LABEL: Record<string, string> = {
  REFERENCE_ASSET_REQUIRED: "请先选择参考素材",
  EDIT_TARGET_REQUIRED: "请先标注要修改的区域",
  OUTPAINT_CANVAS_REQUIRED: "请先选择扩展画布方向",
  EDIT_VISION_REQUIRED: "当前推理模型无法看图，请标注区域或更换支持视觉的模型",
  CAPABILITY_UNSUPPORTED: "当前模型不支持此编辑操作",
};

const ERROR_MESSAGE_LABEL: Array<[string, string]> = [
  ["Selected image model has no image API configured", "所选生图模型未配置图像接口"],
  ["Selected reasoning model must support Vision for AI copywriting", "所选推理模型必须支持视觉能力，才能使用 AI 帮写"],
  ["selected image model cannot execute masked edits", "所选生图模型无法执行蒙版编辑"],
  ["model is not declared by the selected provider", "所选模型未在当前 Provider 中声明"],
];

export function editOperationLabel(operation: string | undefined): string {
  if (!operation) return "编辑操作";
  return EDIT_OPERATION_LABEL[operation as keyof typeof EDIT_OPERATION_LABEL] ?? "编辑操作";
}

export function editExecutionModeLabel(mode: string | undefined): string {
  if (!mode) return "执行方式";
  return EDIT_EXECUTION_MODE_LABEL[mode as keyof typeof EDIT_EXECUTION_MODE_LABEL] ?? "执行方式";
}

export function editErrorLabel(message: string | undefined): string {
  if (!message) return "需要补充编辑区域或参考素材。";
  const code = Object.keys(EDIT_ERROR_LABEL).find((value) => message === value || message.startsWith(`${value}:`));
  return code ? EDIT_ERROR_LABEL[code]! : translateErrorMessage(message);
}

export function translateErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: { message?: unknown } };
      if (typeof parsed.error?.message === "string") return translateErrorMessage(parsed.error.message);
    } catch {
      // 非 JSON 错误文本继续按普通消息处理。
    }
  }
  const code = Object.keys(EDIT_ERROR_LABEL).find((value) => trimmed === value || trimmed.startsWith(`${value}:`));
  if (code) return EDIT_ERROR_LABEL[code]!;
  const match = ERROR_MESSAGE_LABEL.find(([english]) => message.includes(english));
  return match?.[1] ?? message;
}
