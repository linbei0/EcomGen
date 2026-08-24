import { describe, expect, it } from "vitest";

import { editErrorLabel, editExecutionModeLabel, editOperationLabel, translateErrorMessage } from "./userText";

describe("用户可见文案映射", () => {
  it("不会把编辑操作枚举直接展示给用户", () => {
    expect(editOperationLabel("SCENE_ADJUST")).toBe("调整场景");
    expect(editOperationLabel("UNKNOWN_OPERATION")).toBe("编辑操作");
  });

  it("将执行方式转换为用户可理解的文案", () => {
    expect(editExecutionModeLabel("MODEL_DIRECTED")).toBe("模型根据图片自行判断修改范围");
    expect(editExecutionModeLabel("UNKNOWN_MODE")).toBe("执行方式");
  });

  it("将编辑错误码转换为中文提示", () => {
    expect(editErrorLabel("REFERENCE_ASSET_REQUIRED")).toBe("请先选择参考素材");
    expect(editErrorLabel("EDIT_VISION_REQUIRED")).toBe("当前推理模型无法看图，请标注区域或更换支持视觉的模型");
    expect(editErrorLabel("CAPABILITY_UNSUPPORTED: selected image model cannot execute masked edits")).toBe("当前模型不支持此编辑操作");
  });

  it("将后端英文错误信息转换为中文", () => {
    expect(translateErrorMessage("Selected image model has no image API configured")).toBe("所选生图模型未配置图像接口");
    expect(translateErrorMessage('{"error":{"message":"REFERENCE_ASSET_REQUIRED"}}')).toBe("请先选择参考素材");
  });
});
