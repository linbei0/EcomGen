import { describe, expect, it } from "vitest";

import { adaptAsset, adaptExport, adaptExportJobBundle, adaptProject, adaptProjectDetail, adaptStoryboardBundle, exportDownloadUrl } from "./projectDetail";
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

  it("素材无 url 时回退 files 路径，并补 kind", () => {
    const asset = adaptAsset({
      id: "asset-1",
      projectId: "p1",
      role: "PRODUCT_TRUTH",
      mimeType: "image/png",
      createdAt: "2026-08-01T00:00:00.000Z",
      storagePath: "local/path.png",
    });
    expect(asset?.url).toBe("http://127.0.0.1:8787/api/v1/files/assets/asset-1");
    expect(asset?.kind).toBe("PRODUCT");
  });

  it("项目详情读取并列嵌套字段并补默认出图参数", () => {
    const detail = adaptProjectDetail({
      id: "p1",
      name: "耳机",
      platformTargets: ["TAOBAO"],
      targetMarket: null,
      copyLanguage: null,
      reasoningProviderId: "r",
      reasoningModelId: "m",
      imageProviderId: "i",
      imageModelId: "img",
      defaultMode: "CREATIVE",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
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
    expect(detail.imageResolution).toBe("1K");
    expect(detail.imageAspectRatio).toBe("AUTO");
    expect(detail.candidatesPerType).toBe(1);
    expect(detail.assets[0]?.url).toContain("/files/assets/a1");
    expect(detail.assets[0]?.kind).toBe("PRODUCT");
    expect(detail.storyboard).toBeNull();
    expect(detail.cover).toEqual({ productAssetId: null, coverOutputId: null, previewOutputIds: [], outputCount: 0 });
  });

  it("项目列表封面解析原图与输出 id，并去掉封面重复项", () => {
    const project = adaptProject({
      id: "p1",
      name: "耳机",
      platformTargets: ["TAOBAO"],
      targetMarket: null,
      copyLanguage: null,
      reasoningProviderId: "r",
      reasoningModelId: "m",
      imageProviderId: "i",
      imageModelId: "img",
      defaultMode: "CREATIVE",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      cover: {
        productAssetId: "a1",
        coverOutputId: "o1",
        previewOutputIds: ["o2", "o1", "o3"],
        outputCount: 4,
      },
    });
    expect(project?.cover).toEqual({
      productAssetId: "a1",
      coverOutputId: "o1",
      previewOutputIds: ["o2", "o3"],
      outputCount: 4,
    });
  });

  it("分镜接口把并列 items 填回 storyboard，忽略 variantScope", () => {
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
          displayName: "白底/纯色底产品主图",
          shotRole: "HERO",
          candidateCount: 2,
          mode: "CREATIVE",
          status: "DRAFT",
          promptInstruction: "白底主图",
          factClaims: ["续航 8 小时"],
          riskFlags: ["angle"],
        },
        {
          id: "item-2",
          assetType: "scene-image",
          displayName: "使用场景",
          shotRole: "NOT_A_ROLE",
          candidateCount: 1,
          mode: "CREATIVE",
          status: "DRAFT",
          promptInstruction: "使用场景",
        },
      ],
    });
    expect(bundle.storyboard?.version).toBe(2);
    expect(bundle.items).toHaveLength(2);
    expect(bundle.storyboard?.items?.[0]?.displayName).toBe("白底/纯色底产品主图");
    expect(bundle.items[0]?.candidateCount).toBe(2);
    expect(bundle.items[0]?.factClaims).toEqual(["续航 8 小时"]);
    expect(bundle.items[0]?.riskFlags).toEqual(["angle"]);
    expect(bundle.items[0]?.shotRole).toBe("HERO");
    // 非法角色值不透传给 UI，归一为 null
    expect(bundle.items[1]?.shotRole).toBeNull();
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
