import { describe, expect, it } from "vitest";

import { modelOptions, pickDefaultModels } from "./modelOptions";

const PROVIDERS = [
  {
    id: "p1",
    name: "OpenAI 官方",
    models: [
      { id: "gpt-4o", supportsVision: true, imageApiKind: null },
      { id: "gpt-image-1", supportsVision: false, imageApiKind: "openai_images" },
    ],
  },
  {
    id: "p2",
    name: "中转站",
    models: [
      { id: "image2", supportsVision: false, imageApiKind: "openai_images" },
    ],
  },
];

describe("modelOptions", () => {
  it("reasoning 只保留无 imageApiKind 的模型", () => {
    const options = modelOptions(PROVIDERS, "reasoning");
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      value: "p1::gpt-4o",
      label: "OpenAI 官方 / gpt-4o",
      vision: true,
    });
  });

  it("image 只保留带 imageApiKind 的模型", () => {
    const options = modelOptions(PROVIDERS, "image");
    expect(options.map((item) => item.value)).toEqual(["p1::gpt-image-1", "p2::image2"]);
  });
});

describe("pickDefaultModels", () => {
  it("返回第一对可用的推理+生图模型", () => {
    expect(pickDefaultModels(PROVIDERS)).toEqual({
      reasoningProviderId: "p1",
      reasoningModelId: "gpt-4o",
      imageProviderId: "p1",
      imageModelId: "gpt-image-1",
    });
  });

  it("缺生图模型时返回 null", () => {
    expect(
      pickDefaultModels([
        { ...PROVIDERS[0]!, models: PROVIDERS[0]!.models.filter((m) => !m.imageApiKind) },
      ]),
    ).toBeNull();
  });
});
