import { describe, expect, it } from "vitest";

import { adaptAsset, adaptExport, adaptExportJobBundle, adaptProjectDetail, adaptStoryboardBundle, exportDownloadUrl } from "./projectDetail";
import { adaptTemplate } from "./templates";

describe("adapters", () => {
  it("模板 snake_case 转为 camelCase", () => {
    const adapted = adaptTemplate({
      id: "hero-image",
      upstreamNumber: 1,
      name: "白底/纯色底产品主图",
      keywords: ["主图"],
      trigger_phrases: ["产品主图"],
      prompt_template: { zh: "x" },
      defaults: {},
      variants: {},
      category_tips: { electronics: "轮廓" },
      defaultSize: "1024x1024",
    });
    expect(adapted.triggerPhrases).toEqual(["产品主图"]);
    expect(adapted.categoryTips.electronics).toBe("轮廓");
  });

  it("素材无 url 时回退 files 路径", () => {
    const asset = adaptAsset({
      id: "asset-1",
      projectId: "p1",
      role: "PRODUCT_TRUTH",
      mimeType: "image/png",
      createdAt: "2026-08-01T00:00:00.000Z",
      storagePath: "local/path.png",
    });
    expect(asset?.url).toBe("http://127.0.0.1:8787/api/v1/files/assets/asset-1");
  });

  it("项目详情读取并列嵌套字段", () => {
    const detail = adaptProjectDetail({
      id: "p1",
      name: "耳机",
      platformTargets: ["DOMESTIC"],
      reasoningProviderId: "r",
      reasoningModelId: "m",
      imageProviderId: "i",
      imageModelId: "img",
      defaultMode: "CREATIVE",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      variants: [{ id: "v1", projectId: "p1", name: "黑", createdAt: "2026-08-01T00:00:00.000Z" }],
      assets: [
        {
          id: "a1",
          projectId: "p1",
          role: "PRODUCT_TRUTH",
          mimeType: "image/png",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      items: [],
      outputs: [],
      jobs: [],
    });
    expect(detail.variants).toHaveLength(1);
    expect(detail.assets[0]?.url).toContain("/files/assets/a1");
    expect(detail.storyboard).toBeNull();
  });

  it("分镜接口把并列 items 填回 storyboard", () => {
    const bundle = adaptStoryboardBundle({
      storyboard: {
        projectId: "p1",
        version: 2,
        status: "DRAFT",
        campaignStyleLock: "冷白商业摄影",
      },
      items: [
        {
          id: "item-1",
          assetType: "hero-image",
          variantScope: "COMMON",
          mode: "CREATIVE",
          status: "DRAFT",
          promptInstruction: "白底主图",
          factClaims: [{ claim: "续航 8 小时" }],
          riskFlags: ["angle"],
        },
      ],
    });
    expect(bundle.storyboard?.version).toBe(2);
    expect(bundle.items).toHaveLength(1);
    expect(bundle.storyboard?.items[0]?.assetType).toBe("hero-image");
    expect(bundle.items[0]?.riskFlags).toEqual(["angle"]);
  });

  it("导出记录优先 downloadUrl，否则回退 files 路径", () => {
    expect(
      exportDownloadUrl({ id: "e1", downloadUrl: "https://cdn.example/a.zip" }),
    ).toBe("https://cdn.example/a.zip");
    expect(exportDownloadUrl({ id: "e1", downloadUrl: null })).toBe(
      "http://127.0.0.1:8787/api/v1/files/exports/e1",
    );
    const bundle = adaptExportJobBundle({
      job: {
        id: "j1",
        type: "EXPORT",
        status: "QUEUED",
        progress: 0,
        retryable: false,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      export: {
        id: "e1",
        projectId: "p1",
        status: "QUEUED",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    });
    expect(bundle.job?.type).toBe("EXPORT");
    expect(adaptExport(bundle.export)?.id).toBe("e1");
  });
});
