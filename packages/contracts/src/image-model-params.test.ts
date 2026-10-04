import { describe, expect, it } from "vitest";

import {
  imageParamSupportFor,
  isSeedreamImageModel,
  resolveImageSize,
  resolveOpenAiImageSize,
  supportsOpenAiImageOutputFormat,
  supportsOpenAiImageQuality,
} from "./index.js";

describe("Seedream 尺寸映射（火山方舟官方推荐表）", () => {
  it("固定比例按档位 × 比例命中官方推荐像素", () => {
    const model = "doubao-seedream-4-0-250828";
    expect(resolveOpenAiImageSize(model, "1K", "1:1", "1024x1024")).toBe("1024x1024");
    expect(resolveOpenAiImageSize(model, "2K", "3:4", "1024x1024")).toBe("1728x2304");
    expect(resolveOpenAiImageSize(model, "4K", "16:9", "1024x1024")).toBe("5504x3040");
    expect(resolveOpenAiImageSize("doubao-seedream-4.5", "2K", "16:9", "1024x1024")).toBe("2560x1440");
  });

  it("AUTO 比例退回档位关键词，画布交给模型", () => {
    expect(resolveOpenAiImageSize("doubao-seedream-4-0-250828", "2K", "AUTO", "1024x1024")).toBe("2K");
  });

  it("官方未给推荐值的比例按档位预算现算，结果落在该家族总像素区间内", () => {
    for (const model of ["doubao-seedream-4-0-250828", "doubao-seedream-4.5"]) {
      for (const tier of ["1K", "2K", "4K"] as const) {
        for (const ratio of ["4:5", "5:4"] as const) {
          const size = resolveOpenAiImageSize(model, tier, ratio, "1024x1024");
          const [width, height] = size.split("x").map(Number);
          const total = width! * height!;
          expect(total).toBeGreaterThanOrEqual(model.includes("4.5") ? 3_686_400 : 921_600);
          expect(total).toBeLessThanOrEqual(16_777_216);
          // 与官方推荐值同一步长，保证结果稳定可复现。
          expect(width! % 16).toBe(0);
          expect(height! % 16).toBe(0);
        }
      }
    }
  });

  it("请求档位超出模型支持范围时收敛到最接近的受支持档位，而不是发出会被拒绝的值", () => {
    // 4.5 / 5.0 没有 1K 档（显式像素下限 2560x1440）。
    expect(resolveOpenAiImageSize("doubao-seedream-4.5", "1K", "1:1", "1024x1024")).toBe("2048x2048");
    // 5.0-pro 上限约 4.6M 像素，没有 4K 档。
    expect(resolveOpenAiImageSize("dola-seedream-5-0-pro-260628", "4K", "1:1", "1024x1024")).toBe("2048x2048");
    expect(resolveOpenAiImageSize("dola-seedream-5-0-pro-260628", "2K", "3:4", "1024x1024")).toBe("1728x2304");
  });

  it("gpt-image-1.x 与未知模型维持 1024 家族折叠，与旧行为逐字节一致", () => {
    for (const model of ["gpt-image-1", "gpt-image-1.5", "某聚合站的自定义模型"]) {
      expect(resolveOpenAiImageSize(model, "4K", "AUTO", "1024x1536")).toBe(resolveImageSize("4K", "AUTO", "1024x1536"));
      expect(resolveOpenAiImageSize(model, "2K", "3:4", "1024x1536")).toBe("1024x1536");
      expect(resolveOpenAiImageSize(model, "1K", "16:9", "1024x1536")).toBe("1536x1024");
    }
  });

  it("gpt-image-2 起支持任意宽高：1K 保持既有折叠值，2K/4K 按真实比例放大并夹紧官方上限", () => {
    // 1K 与旧行为逐字节一致，存量产物不受影响。
    expect(resolveOpenAiImageSize("gpt-image-2", "1K", "16:9", "1024x1536")).toBe("1536x1024");
    expect(resolveOpenAiImageSize("gpt-image-2", "1K", "AUTO", "1024x1536")).toBe("1024x1536");
    // 官方预算（OpenAI API Reference：宽高被 16 整除、最大 3840x2160）下 16:9 正好命中
    // 官方锚点 2560x1440 / 3840x2160。
    expect(resolveOpenAiImageSize("gpt-image-2", "2K", "16:9", "1024x1536")).toBe("2560x1440");
    expect(resolveOpenAiImageSize("gpt-image-2", "4K", "16:9", "1024x1536")).toBe("3840x2160");
    expect(resolveOpenAiImageSize("gpt-image-2.5-1k", "2K", "AUTO", "1024x1536")).toBe("1552x2336");
    // 竖版 4K：官方预算（总像素 ≤ 3840x2160）下的真实结果。曾观察到兼容渠道返回 2352x3520
    // 并被误判为“4K 映射失效”，实为旧预算 4096² 超出官方上限——此断言就是那个回归锚点。
    expect(resolveOpenAiImageSize("gpt-image-2", "4K", "AUTO", "1024x1536")).toBe("2352x3520");
    // 全档位 × 全比例扫一遍官方约束：16px 对齐、单边 ≤ 3840、总像素 ≤ 3840x2160、比例不越 1:3..3:1。
    for (const tier of ["2K", "4K"] as const) {
      for (const ratio of ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9"] as const) {
        const size = resolveOpenAiImageSize("gpt-image-2", tier, ratio, "1024x1536");
        const [width, height] = size.split("x").map(Number);
        expect(width! % 16).toBe(0);
        expect(height! % 16).toBe(0);
        expect(Math.max(width!, height!)).toBeLessThanOrEqual(3840);
        expect(width! * height!).toBeLessThanOrEqual(3840 * 2160);
        expect(Math.max(width!, height!) / Math.min(width!, height!)).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe("模型参数能力判定", () => {
  it("Seedream 家族：watermark 语义生效、quality 不下发、output_format 仅 4.5+/5.x 支持", () => {
    expect(isSeedreamImageModel("doubao-seedream-4-0-250828")).toBe(true);
    expect(isSeedreamImageModel("doubao-seedream-4.5")).toBe(true);
    expect(isSeedreamImageModel("dola-seedream-5-0-pro-260628")).toBe(true);
    expect(isSeedreamImageModel("gpt-image-1")).toBe(false);
    // 型号里的数字段（如 4-0-250828）不得误判成更高版本。
    expect(isSeedreamImageModel("doubao-seedream-4-0-250828")).toBe(true);

    expect(supportsOpenAiImageQuality("doubao-seedream-4-0-250828")).toBe(false);
    expect(supportsOpenAiImageOutputFormat("doubao-seedream-4-0-250828")).toBe(false);
    expect(supportsOpenAiImageOutputFormat("doubao-seedream-4.5")).toBe(true);
    expect(supportsOpenAiImageOutputFormat("dola-seedream-5-0-pro-260628")).toBe(true);
  });

  it("quality 仅 gpt-image 家族支持", () => {
    expect(supportsOpenAiImageQuality("gpt-image-1")).toBe(true);
    expect(supportsOpenAiImageQuality("gpt-image-1-mini")).toBe(true);
    expect(supportsOpenAiImageQuality("doubao-seedream-4-0-250828")).toBe(false);
    expect(supportsOpenAiImageQuality("自定义聚合模型")).toBe(false);
  });

  it("UI 能力矩阵：无真实档位的维度返回单元素，让前端直接隐藏选择器", () => {
    expect(imageParamSupportFor("doubao-seedream-4-0-250828", "openai_images")).toEqual({
      resolutionTiers: ["1K", "2K", "4K"],
      quality: false,
      outputFormat: false,
    });
    expect(imageParamSupportFor("doubao-seedream-4.5", "openai_images")!.resolutionTiers).toEqual(["2K", "4K"]);
    expect(imageParamSupportFor("gpt-image-1", "openai_images")).toEqual({ resolutionTiers: ["1K"], quality: true, outputFormat: true });
    // gpt-image-2 起（含 2.5 等后缀变体）分辨率真实可调。
    expect(imageParamSupportFor("gpt-image-2", "openai_images")).toEqual({ resolutionTiers: ["1K", "2K", "4K"], quality: true, outputFormat: true });
    expect(imageParamSupportFor("gpt-image-2.5-1k", "openai_images")!.resolutionTiers).toEqual(["1K", "2K", "4K"]);
    // imageSize 只有 Gemini 3 生图模型真正消费。
    expect(imageParamSupportFor("gemini-3-pro-image-preview", "gemini")!.resolutionTiers).toEqual(["1K", "2K", "4K"]);
    expect(imageParamSupportFor("gemini-2.5-flash-image", "gemini")!.resolutionTiers).toEqual(["1K"]);
    expect(imageParamSupportFor("未声明模型", "custom")!.quality).toBe(false);
  });
});
