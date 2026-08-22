import { describe, expect, it } from "vitest";

import { editErrorLabel, editOperationLabel, translateErrorMessage } from "./userText";

describe("用户可见文案映射", () => {
  it("不会把编辑操作枚举直接展示给用户", () => {
    expect(editOperationLabel("SCENE_ADJUST")).toBe("调整场景");
    expect(editOperationLabel("UNKNOWN_OPERATION")).toBe("编辑操作");
  });

  it("将编辑错误码转换为中文提示", () => {
    expect(editErrorLabel("REFERENCE_ASSET_REQUIRED")).toBe("请先选择参考素材");
    expect(editErrorLabel("CAPABILITY_UNSUPPORTED: selected image model cannot execute masked edits")).toBe("当前模型不支持此编辑操作");
  });

  it("将后端英文错误信息转换为中文", () => {
    expect(translateErrorMessage("Selected image model has no image API configured")).toBe("所选生图模型未配置图像接口");
    expect(translateErrorMessage('{"error":{"message":"REFERENCE_ASSET_REQUIRED"}}')).toBe("请先选择参考素材");
  });
});
