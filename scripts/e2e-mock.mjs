import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { crc32, deflateSync, gzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const dataDir = join(root, "data-e2e-mock");
// 生图产物用运行时生成的合法 1x1 PNG：旧的硬编码 base64 实际是损坏的 PNG，此前没有链路真正解码过它。
const onePixelPng = solidPng(26, 58, 46).toString("base64");
const onePixelReferencePng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
// SAM mock 返回的 mask 以亮度表示前景：用 1x1 纯白 PNG（运行时生成，避免依赖解码外部 base64）。
const whiteMaskDataUri = `data:image/png;base64,${solidPng(255, 255, 255).toString("base64")}`;
const layerElements = { elements: [{ name: "保温杯瓶身", promptEn: "thermos bottle body" }, { name: "杯盖", promptEn: "cup lid" }] };
const plan = { campaignStyleLock: "fixed deep green #1A3A2E and clean off-white #FFFFFF ecommerce system", items: [{ assetType: "hero-image", displayName: "通勤杯质感首图", shotRole: "HERO", templateVariant: "luxury", candidateCount: 1, referencedAssets: [], mode: "PIXEL_PROTECTED", promptInstruction: "Create a premium e-commerce hero image of the verified green insulated travel cup. Preserve the exact product identity: shape, silhouette, colors, materials, logo and label placement, and proportions; do not redesign the product. Keep the exact supplied product geometry and visible details. Use a clean off-white background, centered three-quarter product composition, Rembrandt lighting, and restrained deep green accents. Preserve generous whitespace and reserve a blank price-overlay zone without generating readable price, logo, or promotional text. Use the verified fact 304 stainless steel body only as visual material guidance; do not claim keeps hot for 24 hours. No extra props, hands, watermarks, fake logos, or invented product details.", factClaims: ["304 stainless steel body"], riskFlags: [], sortOrder: 0 }] };
// 自定义模板场景：模型按 payload.userTemplates 中注入的 custom_prompt 撰写最终 Prompt；customTemplateId 在运行时由 API 生成后回填
let customTemplateId = "";
const customPlan = () => ({ campaignStyleLock: "warm festive gift box ecommerce system", items: [{ assetType: customTemplateId, displayName: "礼盒丝绒氛围图", shotRole: "SCENE", templateVariant: null, candidateCount: 1, referencedAssets: [], mode: "CREATIVE", promptInstruction: "Create a warm festive e-commerce gift box scene with soft window light, triangular composition, rich red velvet accents and a festive ribbon close-up. Preserve exact product identity: shape, silhouette, colors, materials, logo and label placement, and proportions; do not redesign the product. No readable text, watermarks, or invented product details.", factClaims: [], riskFlags: [], sortOrder: 0 }] });
// 套图反推 mock：EcomGen 输出契约（system prompt 尾部）作为唯一 marker，返回一份可被 EcomSuiteFile 校验的套图 JSON。
const forgeSuite = () => ({
  schemaVersion: 1,
  kind: "ecomgen.suite",
  id: "suite-meizhuang-jiemianru",
  name: "净透氨基酸洁面套图",
  description: "从爆款洗面奶套图反推的通用洁面分镜模板。",
  productFamily: "beauty",
  category: { l1: "美妆", l2: "面部护理", leaf: "洁面乳", leafKeywords: ["洗面奶", "氨基酸", "洁面"] },
  styleLock: { direction: "clean studio", lockText: "clean off-white ecommerce studio system", palette: [{ name: "off-white", hex: "#F7F5F0" }], noDrift: ["no brand logos"] },
  shots: ["HERO", "PAIN_POINT", "DETAIL", "SCENE", "CTA"].map((shotRole, index) => ({
    shotId: `shot-${index + 1}`,
    order: index + 1,
    shotRole,
    displayName: `分镜 ${index + 1}`,
    intent: "funnel step",
    assetType: `suite-meizhuang-jiemianru::shot-${index + 1}`,
    mode: "CREATIVE",
    aspectRatio: "1:1",
    resolution: "2K",
    camera: "50mm",
    lighting: "soft studio light",
    background: "off-white",
    props: "none",
    productOccupancy: "35%",
    whitespace: "top",
    textZone: "bottom",
    promptTemplate: `clean off-white ecommerce studio system, {product}, {product_identity_lock}, clean composition, no logos, no text`,
    supportsImageReference: true
  })),
  provenance: { sourceKind: "viral-reference-set", sourceImageCount: 2, detached: true, notes: "e2e-mock" }
});
const observed = { planningPrompt: "", copywritingPrompt: "", listingPrompt: "", imagePrompt: "", layerPlanPrompt: "", suiteForgePrompt: "", samRequests: [], groundedRequests: [], layerizeRequests: [], giteeRequests: [] };
// 取消场景：带 marker 的生图请求永不响应，用来验证取消是否真正断开在途 HTTP 而不是等超时。
const hangingImagePromptMarker = "e2e-hang-forever";
const cancellation = { hangingRequests: 0, abortedBeforeResponse: 0 };
// 取消场景的规划结果：模式必须是 CREATIVE，PIXEL_PROTECTED 会要求项目存在商品真值图。
const hangingPlan = () => ({ campaignStyleLock: "clean off-white ecommerce system", items: [{ ...plan.items[0], mode: "CREATIVE", promptInstruction: `${plan.items[0].promptInstruction} ${hangingImagePromptMarker}` }] });
const children = [];
// 与 apps/worker 的启动日志配对；改动任一侧都要同步，否则这里会退化成启动超时。
const WORKER_READY_LINE = "ecomgen worker ready";
let workerReady = false;
let mock;

try {
  rmSync(dataDir, { recursive: true, force: true });
  mock = createServer(async (request, response) => {
    const body = await readBody(request);
    if (request.url === "/v1/chat/completions") {
      const requestBody = JSON.parse(body.toString("utf8"));
      const requestText = body.toString("utf8");
      if (requestText.includes("Existing final prompt:")) {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.write(`data: ${JSON.stringify({ id: "mock-revision", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: JSON.stringify({ prompt: plan.items[0].promptInstruction + " Revision applied: initial." }) }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ id: "mock-revision", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }
      if (requestText.includes("Write copy for this project.")) {
        observed.copywritingPrompt = requestText;
        const copy = { productName: "Green travel cup", coreSellingPoints: ["Everyday portable design"], suitableAudience: "Daily commuters", expectedScenarios: "Commuting and desk use" };
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.write(`data: ${JSON.stringify({ id: "mock-copywriting", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: JSON.stringify(copy) }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ id: "mock-copywriting", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }
      // 花型 Listing 文案：系统提示以专属 marker 识别，返回满足 Etsy 硬约束的 JSON（标题 ≤140、13×20 tags）
      if (requestText.includes("cross-border print-on-demand listing copywriter")) {
        observed.listingPrompt = requestText;
        const listing = { platform: "ETSY", title: "Watercolor Wildflower Bouquet T Shirt Design", tags: Array.from({ length: 13 }, (_, index) => `tag${index}`), description: "A watercolor wildflower bouquet artwork for everyday wear and gifts.", bullets: [] };
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.write(`data: ${JSON.stringify({ id: "mock-listing", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: JSON.stringify(listing) }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ id: "mock-listing", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }
      // 套图反推：system prompt 尾部的 EcomGen 输出契约是最稳定的识别 marker
      if (requestText.includes("ECOMGEN OUTPUT CONTRACT (highest priority)")) {
        observed.suiteForgePrompt = requestText;
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.write(`data: ${JSON.stringify({ id: "mock-suite-forge", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: JSON.stringify(forgeSuite()) }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ id: "mock-suite-forge", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }
      // 自定义模板 MANUAL 规划：payload.userTemplates 注入的 custom_prompt 以 marker 识别
      if (requestText.includes("e2e-custom-marker")) {
        observed.planningPrompt = body.toString("utf8");
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.write(`data: ${JSON.stringify({ id: "mock-custom-plan", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: JSON.stringify(customPlan()) }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ id: "mock-custom-plan", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }
      // 图层元素识别：layer-planner 的系统提示以 marker 识别（用户文本可能被客户端编码，不可靠）
      if (requestText.includes("layer planner for an e-commerce image workspace")) {
        observed.layerPlanPrompt = requestText;
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.write(`data: ${JSON.stringify({ id: "mock-layer-plan", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: JSON.stringify(layerElements) }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ id: "mock-layer-plan", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }
      // 取消场景的项目：描述里带 marker 时返回同样带 marker 的 Prompt，让生图请求命中"永不返回"分支
      if (requestText.includes(hangingImagePromptMarker)) {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.write(`data: ${JSON.stringify({ id: "mock-hanging-plan", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: JSON.stringify(hangingPlan()) }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ id: "mock-hanging-plan", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }
      observed.planningPrompt = body.toString("utf8");
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write(`data: ${JSON.stringify({ id: "mock-plan", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: JSON.stringify(plan) }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: "mock-plan", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }
    if (request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "mock-reasoner" }, { id: "mock-image" }] }));
      return;
    }
    if (request.url === "/v1/images/edits" || request.url === "/v1/images/generations") {
      // edits 走 multipart、generations 走 JSON；只有 JSON 载荷才按 model 分流到 Seedream 图层拆分
      const contentType = String(request.headers["content-type"] ?? "");
      const imageBody = contentType.includes("application/json") ? JSON.parse(body.toString("utf8") || "{}") : {};
      if (imageBody.model === "doubao-seedream-5.0-pro-layerize") {
        observed.layerizeRequests.push(imageBody);
        // 火山方舟同步协议：data 下标 0 是已补绘底图（z_index 0）、后续是带 alpha 的图层
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          model: imageBody.model, data: [
            { url: `data:image/png;base64,${solidPng(24, 32, 40).toString("base64")}`, z_index: 0 },
            { url: whiteMaskDataUri, z_index: 1, name: "保温杯瓶身", bounding_box: { absolute: [0, 0, 1, 1], normalized: [0, 0, 1000, 1000] } }
          ]
        }));
        return;
      }
      observed.imagePrompt = body.toString("utf8");
      // 取消场景：上游一直不返回。若 Worker 取消没有真正中断连接，这里永远不会观测到 abort。
      if (observed.imagePrompt.includes(hangingImagePromptMarker)) {
        cancellation.hangingRequests += 1;
        let abortRecorded = false;
        const recordAbort = () => { if (abortRecorded) return; abortRecorded = true; cancellation.abortedBeforeResponse += 1; };
        request.on("aborted", recordAbort);
        response.on("close", () => { if (!response.writableEnded) recordAbort(); });
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "mock-image", data: [{ b64_json: onePixelPng }] }));
      return;
    }
    // fal SAM 3 同步分割端点：FalSegmentationProvider 默认 POST {baseUrl}/fal-ai/sam-3/image
    if (request.url === "/v1/fal-ai/sam-3/image") {
      const samBody = JSON.parse(body.toString("utf8"));
      observed.samRequests.push(samBody);
      // 空请求模拟 fal 校验层直接拒绝（探测只验证连通性与认证，不执行模型、不产生费用）
      if (!samBody.image_url) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ detail: "image_url is required" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ request_id: "mock-sam", masks: [{ url: whiteMaskDataUri, content_type: "image/png", width: 1, height: 1 }], scores: [0.99], boxes: [[0.5, 0.5, 1, 1]] }));
      return;
    }
    // 自部署 grounded_sam 协议端点：GroundedSamSegmentationProvider POST {baseUrl}/，Bearer 认证
    if (request.url === "/v1/" || request.url === "/v1") {
      observed.groundedRequests.push({ authorization: request.headers.authorization, body: JSON.parse(body.toString("utf8")) });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ request_id: "mock-gs", masks: [{ data: whiteMaskDataUri.split(",")[1], mime_type: "image/png", width: 1, height: 1, bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, score: 0.95 }] }));
      return;
    }
    // Gitee AI（模力方舟）SAM3 pipeline 端点：POST {baseUrl}/images/segmentation，Bearer 认证，multipart 表单（model/image/prompt）
    if (request.url === "/v1/images/segmentation") {
      const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(String(request.headers["content-type"] ?? ""));
      const fields = boundary ? multipartFields(body, boundary[1] ?? boundary[2]) : {};
      observed.giteeRequests.push({ authorization: request.headers.authorization, fields });
      // 空表单模拟校验层直接拒绝（探测只验证连通性与认证，不执行模型、不产生费用）
      if (!fields.image) {
        response.writeHead(422, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "image is required" }));
        return;
      }
      // counts 是 pycocotools 变长编码的 [0,1]（1x1 全前景）经 gzip 的 base64：走适配器 gunzip+LEB 解码主路径
      const counts = gzipSync(Buffer.from("01", "ascii")).toString("base64");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ num_segments: 1, segments: [{ id: 1, label: fields.prompt.toString("utf8"), confidence: 0.95, bbox: [0, 0, 1, 1], mask: { encoding: "rle", size: [1, 1], counts } }] }));
      return;
    }
    response.writeHead(404).end();
  });
  const mockPort = await listen(mock);
  const apiPort = await freePort();
  const environment = {
    ...process.env,
    ECOMGEN_MASTER_KEY: randomBytes(32).toString("base64"),
    ECOMGEN_DATA_DIR: dataDir,
    REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    ECOMGEN_QUEUE_NAME: `ecomgen-e2e-${Date.now()}`,
    PORT: String(apiPort),
    HOST: "127.0.0.1",
    WORKER_CONCURRENCY: "1"
  };
  children.push(start("apps/api/dist/server.js", environment));
  await waitFor(async () => (await fetch(`http://127.0.0.1:${apiPort}/health`)).ok);
  children.push(start("apps/worker/dist/worker.js", environment));
  // Worker 未就绪时提交的任务只会停在队列里，直到下一个 waitJob 超时；这里等它自己报告已连接，
  // 把启动竞态暴露成明确的启动失败，而不是误导性的任务超时。
  await waitFor(() => workerReady, 15_000, "worker readiness");
  const base = `http://127.0.0.1:${apiPort}/api/v1`;
  const provider = await requestJson(`${base}/providers`, "POST", {
    name: "Mock OpenAI provider",
    baseUrl: `http://127.0.0.1:${mockPort}/v1`,
    reasoningProtocol: "openai",
    apiKey: "mock-key",
    models: [
      { id: "mock-reasoner", supportsVision: true, supportsThinking: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null },
      { id: "mock-text", supportsVision: false, supportsThinking: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null },
      { id: "mock-image", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: "openai_images" },
      { id: "sam-3", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: null, segmentationProtocol: "fal" },
      { id: "grounded-sam-2", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: null, segmentationProtocol: "grounded_sam" },
      { id: "doubao-seedream-5.0-pro-layerize", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: null, segmentationProtocol: "seedream_layerize" },
      { id: "sam3", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: null, segmentationProtocol: "gitee_sam3" }
    ]
  });
  const reasoningProbe = await requestJson(`${base}/providers/${provider.id}/test`, "POST", { modelId: "mock-reasoner", kind: "reasoning" });
  assert.equal(reasoningProbe.ok, true);
  const probe = await requestJson(`${base}/providers/${provider.id}/test`, "POST", { modelId: "mock-image", kind: "image" });
  assert.equal(probe.modelAvailable, true);
  // 分割探测只做零费用连通性检查
  const segmentationProbe = await requestJson(`${base}/providers/${provider.id}/test`, "POST", { modelId: "sam-3", kind: "segmentation" });
  assert.equal(segmentationProbe.ok, true);
  const project = await requestJson(`${base}/projects`, "POST", {
    name: "Travel cup",
    category: "home",
    productDescription: "A green insulated travel cup for everyday commuting.",
    verifiedFacts: ["304 stainless steel body"],
    prohibitedClaims: ["keeps hot for 24 hours"],
    brandGuidelines: { accent: "#1A3A2E", tone: "premium practical" },
    platformTargets: ["AMAZON"],
    targetMarket: "UNITED_STATES",
    copyLanguage: "en-US",
    reasoningProviderId: provider.id,
    reasoningModelId: "mock-reasoner",
    imageProviderId: provider.id,
    imageModelId: "mock-image",
    defaultMode: "PIXEL_PROTECTED",
    imageResolution: "1K",
    imageAspectRatio: "AUTO",
    candidatesPerType: 1
  });
  assert.deepEqual(project.platformTargets, ["AMAZON"]);
  assert.equal(project.targetMarket, "UNITED_STATES");
  assert.equal(project.copyLanguage, "en-US");
  const missingProductCopywriting = await fetch(`${base}/projects/${project.id}/copywriting-jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: "PRODUCT_DESCRIPTION", regenerationKey: "missing-product" }) });
  assert.equal(missingProductCopywriting.status, 400);
  const form = new FormData();
  form.append("role", "PRODUCT_TRUTH");
  form.append("file", new Blob([Buffer.from(onePixelPng, "base64")], { type: "image/png" }), "cup.png");
  const assetResponse = await fetch(`${base}/projects/${project.id}/assets`, { method: "POST", body: form });
  assert.equal(assetResponse.status, 200, await assetResponse.text());
  const referenceForm = new FormData();
  referenceForm.append("role", "STYLE_REFERENCE");
  referenceForm.append("file", new Blob([Buffer.from(onePixelReferencePng, "base64")], { type: "image/png" }), "reference.png");
  const referenceResponse = await fetch(`${base}/projects/${project.id}/assets`, { method: "POST", body: referenceForm });
  assert.equal(referenceResponse.status, 200, await referenceResponse.text());
  await requestJson(`${base}/projects/${project.id}`, "PATCH", { reasoningModel: { providerId: provider.id, modelId: "mock-text" } });
  const unsupportedCopywriting = await fetch(`${base}/projects/${project.id}/copywriting-jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: "PRODUCT_DESCRIPTION", regenerationKey: "unsupported-model" }) });
  assert.equal(unsupportedCopywriting.status, 422);
  await requestJson(`${base}/projects/${project.id}`, "PATCH", { reasoningModel: { providerId: provider.id, modelId: "mock-reasoner" } });
  const copywriting = await requestJson(`${base}/projects/${project.id}/copywriting-jobs`, "POST", { target: "PRODUCT_DESCRIPTION", regenerationKey: "copywriting-1" });
  const duplicateCopywriting = await requestJson(`${base}/projects/${project.id}/copywriting-jobs`, "POST", { target: "PRODUCT_DESCRIPTION", regenerationKey: "copywriting-1" });
  assert.equal(duplicateCopywriting.id, copywriting.id);
  const copywritingJob = await waitJob(base, copywriting.id);
  assert.equal(copywritingJob.status, "SUCCEEDED");
  const copywritingResult = await requestJson(`${base}/copywriting-jobs/${copywriting.id}/result`, "GET");
  assert.equal(copywritingResult.target, "PRODUCT_DESCRIPTION");
  assert.match(copywritingResult.content, /产品名称：Green travel cup/);
  assert.match(observed.copywritingPrompt, /PRODUCT_TRUTH/);
  assert.match(observed.copywritingPrompt, /STYLE_REFERENCE/);
  await requestJson(`${base}/projects/${project.id}/planning-jobs`, "POST", { planningMode: "AI", requestedTypes: ["hero-image"], candidatesPerType: 1, targetImageCount: 1 });
  const planningJob = await waitForJob(base, project.id, "PLAN");
  assert.equal(planningJob.status, "SUCCEEDED");
  const snapshots = await requestJson(`${base}/projects/${project.id}/planning-config-snapshots`, "GET");
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].sourceJobId, planningJob.id);
  assert.match(observed.planningPrompt, /allowedTemplateIds/);
  assert.match(observed.planningPrompt, /304 stainless steel body/);
  const storyboard = await requestJson(`${base}/projects/${project.id}/storyboard`, "GET");
  assert.equal(storyboard.items.length, 1);
  assert.equal(storyboard.items[0].assetType, "hero-image");
  assert.equal(storyboard.items[0].templateVariant, "luxury");
  assert.equal(storyboard.items[0].displayName, "通勤杯质感首图");
  // 确认携带当前版本；过期版本必须被 409 拒绝（乐观并发控制）
  await assert.rejects(requestJson(`${base}/projects/${project.id}/storyboard/confirm`, "POST", { version: storyboard.storyboard.version + 1 }), /failed \(409\)/);
  await requestJson(`${base}/projects/${project.id}/storyboard/confirm`, "POST", { version: storyboard.storyboard.version });
  const generation = await requestJson(`${base}/projects/${project.id}/generation-jobs`, "POST", { storyboardItemIds: [storyboard.items[0].id], revision: "initial" });
  const duplicateGeneration = await requestJson(`${base}/projects/${project.id}/generation-jobs`, "POST", { storyboardItemIds: [storyboard.items[0].id], revision: "initial" });
  assert.equal(duplicateGeneration.jobs[0].id, generation.jobs[0].id);
  const generationJob = await waitJob(base, generation.jobs[0].id);
  assert.equal(generationJob.status, "SUCCEEDED");
  assert.match(observed.imagePrompt, /Rembrandt lighting/);
  assert.match(observed.imagePrompt, /304 stainless steel body/);
  assert.match(observed.imagePrompt, /keeps hot for 24 hours/);
  assert.match(observed.imagePrompt, /price-overlay zone/);
  assert.doesNotMatch(observed.imagePrompt, /Upstream template|Template fields/);
  const outputs = await requestJson(`${base}/projects/${project.id}/outputs`, "GET");
  assert.equal(outputs.length, 1);
  assert.equal(typeof outputs[0].generationBatchId, "string");
  const queuedExport = await requestJson(`${base}/projects/${project.id}/export-jobs`, "POST", { outputIds: [outputs[0].id] });
  const exportJob = await waitJob(base, queuedExport.job.id);
  assert.equal(exportJob.status, "SUCCEEDED");
  const exportRecord = await requestJson(`${base}/exports/${queuedExport.export.id}`, "GET");
  const zip = await fetch(`${base}/files/exports/${exportRecord.id}`);
  assert.equal(zip.status, 200);
  const archive = Buffer.from(await zip.arrayBuffer());
  assert.equal(archive.subarray(0, 2).toString("utf8"), "PK");
  assert.match(archive.toString("binary"), /manifest\.json/);
  // 分层导出链路：PATCH 分割模型 → vision 识别元素 → SAM 分割 → 图层 PNG / 背景层 / PSD 下载
  await requestJson(`${base}/projects/${project.id}`, "PATCH", { segmentationModel: { providerId: provider.id, modelId: "sam-3" } });
  assert.deepEqual((await requestJson(`${base}/projects/${project.id}`, "GET")).segmentationModel, { providerId: provider.id, modelId: "sam-3", protocol: "fal" });
  const layerPlan = await requestJson(`${base}/outputs/${outputs[0].id}/layer-plan`, "POST", {});
  const layerPlanJob = await waitJob(base, layerPlan.jobId);
  assert.equal(layerPlanJob.status, "SUCCEEDED");
  const layerPlanResult = await requestJson(`${base}/outputs/${outputs[0].id}/layer-plan`, "GET");
  assert.equal(layerPlanResult.status, "SUCCEEDED");
  assert.equal(layerPlanResult.outputHash, outputs[0].hash);
  assert.deepEqual(layerPlanResult.elements.map((element) => element.name), ["保温杯瓶身", "杯盖"]);
  assert.match(observed.layerPlanPrompt, /layer planner for an e-commerce image workspace/);
  const layerExport = await requestJson(`${base}/outputs/${outputs[0].id}/layer-exports`, "POST", { planId: layerPlan.id, elements: [{ id: "el-1", name: "保温杯瓶身", source: "auto" }, { id: "manual-1", name: "自定义元素", source: "manual", bbox: { x: 0, y: 0, width: 0.5, height: 0.5 } }] });
  assert.equal(layerExport.job.type, "LAYER_EXPORT");
  const layerExportJob = await waitJob(base, layerExport.job.id);
  assert.equal(layerExportJob.status, "SUCCEEDED");
  const layerExportResult = await requestJson(`${base}/outputs/${outputs[0].id}/layer-exports`, "GET");
  assert.equal(layerExportResult.status, "SUCCEEDED");
  assert.equal(layerExportResult.includeBackground, true);
  // 落盘顺序跟随 PSD 层序：背景是 children[0]，先 append 先写入
  assert.deepEqual(layerExportResult.layerFiles.map((file) => file.kind), ["background", "element", "element", "composite"]);
  assert.equal(observed.samRequests.length, 3);
  // 第 1 条是连通性探测的空请求（4xx 校验层拒绝，无模型执行无费用）；随后才是逐元素的分割请求
  assert.deepEqual(observed.samRequests[0], {});
  assert.match(JSON.stringify(observed.samRequests[1]), /"image_url":"data:image\/png;base64,/);
  assert.match(JSON.stringify(observed.samRequests[2]), /"box_prompts":\[/);
  const psdResponse = await fetch(`${base}${layerExportResult.psdDownloadUrl}`);
  assert.equal(psdResponse.status, 200);
  const psdBytes = Buffer.from(await psdResponse.arrayBuffer());
  assert.equal(psdBytes.subarray(0, 4).toString("binary"), "8BPS");
  // 解析 PSD 内部图层记录验证真实层序。这里 mask 覆盖整张 1x1 图，挖空背景完全透明被正确省略
  const requireWorker = createRequire(join(root, "apps/worker/package.json"));
  const { readPsd } = requireWorker("ag-psd");
  const parsedPsd = readPsd(psdBytes, { skipLayerImageData: true, skipCompositeImageData: true });
  assert.deepEqual(parsedPsd.children.map((layer) => layer.name), ["01 保温杯瓶身", "02 自定义元素"]);
  const layerPngResponse = await fetch(`${base}${layerExportResult.layerFiles[0].downloadUrl}`);
  assert.equal(layerPngResponse.status, 200);
  const layerPng = Buffer.from(await layerPngResponse.arrayBuffer());
  assert.equal(layerPng.subarray(1, 4).toString("binary"), "PNG");
  // grounded_sam 协议链路：自部署 Grounded-SAM 服务适配器（Bearer 认证 + text_prompt 契约 + 无背景层）
  await requestJson(`${base}/projects/${project.id}`, "PATCH", { segmentationModel: { providerId: provider.id, modelId: "grounded-sam-2", protocol: "grounded_sam" } });
  const groundedExport = await requestJson(`${base}/outputs/${outputs[0].id}/layer-exports`, "POST", { planId: layerPlan.id, elements: [{ id: "el-1", name: "保温杯瓶身", source: "auto" }], includeBackground: false });
  const groundedExportJob = await waitJob(base, groundedExport.job.id);
  assert.equal(groundedExportJob.status, "SUCCEEDED");
  const groundedResult = await requestJson(`${base}/outputs/${outputs[0].id}/layer-exports`, "GET");
  assert.equal(groundedResult.includeBackground, false);
  assert.deepEqual(groundedResult.layerFiles.map((file) => file.kind), ["element", "composite"]);
  assert.equal(observed.groundedRequests.length, 1);
  assert.match(observed.groundedRequests[0].authorization, /^Bearer /);
  assert.equal(observed.groundedRequests[0].body.text_prompt, "thermos bottle body");
  assert.match(observed.groundedRequests[0].body.image.data, /^[A-Za-z0-9+/=]+$/);
  // seedream_layerize 协议链路：单次提交拆分全部元素，底图作已补绘背景层，图层 alpha 回贴原图抠像
  await requestJson(`${base}/projects/${project.id}`, "PATCH", { segmentationModel: { providerId: provider.id, modelId: "doubao-seedream-5.0-pro-layerize", protocol: "seedream_layerize" } });
  const seedreamExport = await requestJson(`${base}/outputs/${outputs[0].id}/layer-exports`, "POST", { planId: layerPlan.id, elements: [{ id: "el-1", name: "保温杯瓶身", source: "auto" }] });
  const seedreamExportJob = await waitJob(base, seedreamExport.job.id);
  assert.equal(seedreamExportJob.status, "SUCCEEDED");
  const seedreamResult = await requestJson(`${base}/outputs/${outputs[0].id}/layer-exports`, "GET");
  assert.deepEqual(seedreamResult.layerFiles.map((file) => file.kind), ["background", "element", "composite"]);
  assert.equal(observed.layerizeRequests.length, 1);
  assert.equal(observed.layerizeRequests[0].model, "doubao-seedream-5.0-pro-layerize");
  assert.match(observed.layerizeRequests[0].prompt, /保温杯瓶身/);
  // Seedream 的补绘底图非空，PSD 中背景必须位于 children[0]（最底层），元素叠加在其上
  const seedreamPsdResponse = await fetch(`${base}${seedreamResult.psdDownloadUrl}`);
  assert.equal(seedreamPsdResponse.status, 200);
  const seedreamPsd = readPsd(Buffer.from(await seedreamPsdResponse.arrayBuffer()), { skipLayerImageData: true, skipCompositeImageData: true });
  assert.deepEqual(seedreamPsd.children.map((layer) => layer.name), ["背景", "01 保温杯瓶身"]);
  // 提示词免识别直接分层：prompt 元素只有语义名称（无 bbox）；输出已有成功方案时按现行语义挂接 planId，无方案时 planId 为空（api 单测覆盖）
  const promptExport = await requestJson(`${base}/outputs/${outputs[0].id}/layer-exports`, "POST", { elements: [{ id: "p-1", name: "保温杯文案", source: "prompt" }], includeBackground: false });
  assert.equal(promptExport.layerExport.planId, layerPlan.id);
  const promptExportJob = await waitJob(base, promptExport.job.id);
  assert.equal(promptExportJob.status, "SUCCEEDED");
  assert.match(observed.layerizeRequests[1].prompt, /保温杯文案/);
  // 历史导出：每次导出都有独立记录（新→旧），旧记录的 PSD 下载地址按记录 id 寻址仍可用
  const layerExportHistory = await requestJson(`${base}/outputs/${outputs[0].id}/layer-exports/history`, "GET");
  assert.equal(layerExportHistory.exports.length, 4);
  assert.equal(layerExportHistory.exports[0].id, promptExport.layerExport.id);
  const historicalPsd = await fetch(`${base}${layerExportHistory.exports[2].psdDownloadUrl}`);
  assert.equal(historicalPsd.status, 200);
  // gitee_sam3 协议链路：Gitee AI（模力方舟）SAM3 pipeline，Bearer 认证 + multipart 表单，只支持文本提示（无框输入）
  const giteeProbe = await requestJson(`${base}/providers/${provider.id}/test`, "POST", { modelId: "sam3", kind: "segmentation" });
  assert.equal(giteeProbe.ok, true);
  await requestJson(`${base}/projects/${project.id}`, "PATCH", { segmentationModel: { providerId: provider.id, modelId: "sam3", protocol: "gitee_sam3" } });
  const giteeExport = await requestJson(`${base}/outputs/${outputs[0].id}/layer-exports`, "POST", { planId: layerPlan.id, elements: [{ id: "el-1", name: "保温杯瓶身", source: "auto" }] });
  const giteeExportJob = await waitJob(base, giteeExport.job.id);
  assert.equal(giteeExportJob.status, "SUCCEEDED");
  const giteeResult = await requestJson(`${base}/outputs/${outputs[0].id}/layer-exports`, "GET");
  assert.deepEqual(giteeResult.layerFiles.map((file) => file.kind), ["background", "element", "composite"]);
  assert.equal(observed.giteeRequests.length, 2);
  // 第 1 条是连通性探测的空请求（422 校验层拒绝，无模型执行无费用）；随后才是分割请求
  assert.match(observed.giteeRequests[0].authorization, /^Bearer /);
  assert.equal(observed.giteeRequests[1].fields.model.toString("utf8"), "sam3");
  assert.equal(observed.giteeRequests[1].fields.prompt.toString("utf8"), "thermos bottle body");
  assert.ok(observed.giteeRequests[1].fields.image.length > 0);
  const giteePsdResponse = await fetch(`${base}${giteeResult.psdDownloadUrl}`);
  assert.equal(giteePsdResponse.status, 200);
  // 重复识别同内容输出应复用同一方案（200 而不是新任务）
  const reusedLayerPlan = await requestJson(`${base}/outputs/${outputs[0].id}/layer-plan`, "POST", {});
  assert.equal(reusedLayerPlan.id, layerPlan.id);
  // 自定义模板场景：创建模板 → MANUAL 规划（custom_prompt 注入规划上下文）→ 生图（Worker 回退解析自定义模板）
  const customTemplate = await requestJson(`${base}/user-templates`, "POST", { name: "Festive gift box scene", prompt: "Festive gift box hero scene with e2e-custom-marker ribbon detail, soft window light, triangular composition.", defaultSize: "1024x1024", supportsImageReference: false });
  assert.match(customTemplate.id, /^custom-/);
  customTemplateId = customTemplate.id;
  const customProject = await requestJson(`${base}/projects`, "POST", {
    name: "Gift box",
    category: "home",
    productDescription: "A red velvet gift box for festive seasons.",
    verifiedFacts: [],
    prohibitedClaims: [],
    brandGuidelines: {},
    platformTargets: ["AMAZON"],
    targetMarket: "UNITED_STATES",
    copyLanguage: "en-US",
    reasoningProviderId: provider.id,
    reasoningModelId: "mock-reasoner",
    imageProviderId: provider.id,
    imageModelId: "mock-image",
    defaultMode: "CREATIVE",
    imageResolution: "1K",
    imageAspectRatio: "AUTO",
    candidatesPerType: 1
  });
  await requestJson(`${base}/projects/${customProject.id}/planning-jobs`, "POST", { planningMode: "MANUAL", requestedTypes: [customTemplate.id], candidatesPerType: 1 });
  const customPlanningJob = await waitForJob(base, customProject.id, "PLAN");
  assert.equal(customPlanningJob.status, "SUCCEEDED");
  assert.match(observed.planningPrompt, /e2e-custom-marker/);
  const customStoryboard = await requestJson(`${base}/projects/${customProject.id}/storyboard`, "GET");
  assert.equal(customStoryboard.items.length, 1);
  assert.equal(customStoryboard.items[0].assetType, customTemplate.id);
  assert.equal(customStoryboard.items[0].displayName, "礼盒丝绒氛围图");
  await requestJson(`${base}/projects/${customProject.id}/storyboard/confirm`, "POST", { version: customStoryboard.storyboard.version });
  const customGeneration = await requestJson(`${base}/projects/${customProject.id}/generation-jobs`, "POST", { storyboardItemIds: [customStoryboard.items[0].id] });
  const customGenerationJob = await waitJob(base, customGeneration.jobs[0].id);
  assert.equal(customGenerationJob.status, "SUCCEEDED");
  assert.match(observed.imagePrompt, /festive ribbon close-up/);
  // 全局套图反推链路：脱离项目上传源图 → Worker 视觉反推 → 草稿预览 → 确认入库 → 套图目录可见
  const forgeForm = new FormData();
  forgeForm.append("providerId", provider.id);
  forgeForm.append("modelId", "mock-reasoner");
  forgeForm.append("name", "净透氨基酸洁面套图");
  forgeForm.append("l1", "美妆");
  forgeForm.append("targetShotCount", "5");
  forgeForm.append("files", new Blob([Buffer.from(onePixelPng, "base64")], { type: "image/png" }), "viral-1.png");
  forgeForm.append("files", new Blob([Buffer.from(onePixelReferencePng, "base64")], { type: "image/png" }), "viral-2.png");
  const forgeResponse = await fetch(`${base}/suite-forge-jobs`, { method: "POST", body: forgeForm });
  const forgeText = await forgeResponse.text();
  assert.equal(forgeResponse.status, 202, forgeText);
  const forgeJob = JSON.parse(forgeText);
  assert.equal(forgeJob.type, "SUITE_FORGE");
  assert.equal(forgeJob.projectId, null);
  const forgeDone = await waitJob(base, forgeJob.id);
  assert.equal(forgeDone.status, "SUCCEEDED");
  // 反推的流式分镜计数要从 agent 一路落到 job 记录：mock Provider 把整份 JSON 放在一个
  // SSE chunk 里，因此这里断言的是"单块也能数全"，而不是中间值。
  assert.equal(forgeDone.progressDetail.shotsGenerated, 5);
  assert.equal(forgeDone.progressDetail.shotsTarget, 5);
  assert.match(observed.suiteForgePrompt, /ECOMGEN OUTPUT CONTRACT/);
  const forgeResult = await requestJson(`${base}/suite-forge-jobs/${forgeJob.id}/result`, "GET");
  assert.equal(forgeResult.status, "DRAFT");
  assert.equal(forgeResult.suite.name, "净透氨基酸洁面套图");
  assert.equal(forgeResult.suite.shots.length, 5);
  // 最近反推列表是刷新后找回任务的唯一入口，必须带上草稿摘要
  const forgeList = await requestJson(`${base}/suite-forge-jobs`, "GET");
  const listedForgeJob = forgeList.items.find((item) => item.jobId === forgeJob.id);
  assert.ok(listedForgeJob, "recent forge jobs should include the current job");
  assert.equal(listedForgeJob.status, "SUCCEEDED");
  assert.equal(listedForgeJob.draft.shotCount, 5);
  assert.equal(listedForgeJob.draft.suiteId, null);
  // 同源图重复提交命中请求指纹，复用同一任务而不重复计费
  const duplicateForgeForm = new FormData();
  duplicateForgeForm.append("providerId", provider.id);
  duplicateForgeForm.append("modelId", "mock-reasoner");
  duplicateForgeForm.append("name", "净透氨基酸洁面套图");
  duplicateForgeForm.append("l1", "美妆");
  duplicateForgeForm.append("targetShotCount", "5");
  duplicateForgeForm.append("files", new Blob([Buffer.from(onePixelPng, "base64")], { type: "image/png" }), "viral-1.png");
  duplicateForgeForm.append("files", new Blob([Buffer.from(onePixelReferencePng, "base64")], { type: "image/png" }), "viral-2.png");
  const duplicateForge = await fetch(`${base}/suite-forge-jobs`, { method: "POST", body: duplicateForgeForm });
  assert.equal((await duplicateForge.json()).id, forgeJob.id);
  // commit 接受整份套图：预览面板的编辑随请求回传并覆盖草稿，所以这里改名后提交并校验落库内容
  const editedForgeSuite = { ...forgeResult.suite, name: "净透氨基酸洁面套图（已编辑）" };
  const committedForge = await requestJson(`${base}/suite-forge-jobs/${forgeJob.id}/commit`, "POST", editedForgeSuite);
  assert.equal(committedForge.status, "COMMITTED");
  assert.equal(committedForge.suite.name, editedForgeSuite.name);
  assert.match(committedForge.suiteId, /^custom-suite-/);
  // 内置套图数量远超单页，用 ids 精确回读校验落库套图，不依赖默认首页位置。
  const suites = await requestJson(`${base}/suites?ids=${committedForge.suiteId}`, "GET");
  const committedSuiteSummary = suites.items.find((suite) => suite.id === committedForge.suiteId);
  assert.ok(committedSuiteSummary, "committed suite should be listed");
  assert.equal(committedSuiteSummary.name, editedForgeSuite.name);
  // 全局模特库链路：建模 → 参考脸上传 → 选角生成（参考脸身份锚点进入生图 Prompt）→ 候选落库 → 选定切换
  const ecomModel = await requestJson(`${base}/models`, "POST", {
    name: "小满",
    spec: {
      gender: "FEMALE", age: "LATE_20S", heritage: "EAST_ASIAN", stature: "STANDARD_165", build: "SLENDER",
      faceShape: "OVAL", eyeShape: "ALMOND", eyeColor: "DARK_BROWN", browShape: "STRAIGHT_SOFT", noseShape: "DELICATE", lipShape: "NATURAL",
      hairLength: "SHOULDER", hairstyle: "SOFT_WAVE", hairColor: "INK_BLACK", hairTexture: "NATURAL_VOLUME", hairline: "ROUNDED",
      complexion: "LIGHT_NEUTRAL", skinTexture: "NATURAL_PORES", facialHair: "NONE",
      distinctiveMarks: ["DIMPLES"], expression: "SOFT_SMILE", gaze: "DIRECT_TO_CAMERA", aura: ["WARM_APPROACHABLE"], makeup: "MINIMAL_DEWY", baseWardrobe: "WHITE_TANK",
      framing: "WAIST_UP", pose: "HANDS_RELAXED", backdrop: "SEAMLESS_GREY", lighting: "SOFTBOX_THREE_POINT", lens: "LENS_50"
    },
    notes: "e2e model cast"
  });
  assert.equal(ecomModel.hasReferenceFace, false);
  assert.equal(ecomModel.portraitCount, 0);
  // 参考脸可选；上传后即成为该模特后续生成的唯一身份基准
  const faceForm = new FormData();
  faceForm.append("file", new Blob([Buffer.from(onePixelReferencePng, "base64")], { type: "image/png" }), "face.png");
  const faceResponse = await fetch(`${base}/models/${ecomModel.id}/reference-face`, { method: "POST", body: faceForm });
  const faceText = await faceResponse.text();
  assert.equal(faceResponse.status, 201, faceText);
  const faceModel = JSON.parse(faceText);
  assert.equal(faceModel.hasReferenceFace, true);
  // 模特类 url 是含 /api/v1 前缀的浏览器直连路径，与 thumbnails 的约定一致
  assert.equal((await fetch(new URL(faceModel.referenceFaceUrl, base))).status, 200);
  const castBody = { providerId: provider.id, imageModelId: "mock-image", aspectRatio: "AUTO", candidateCount: 1 };
  const modelCast = await requestJson(`${base}/models/${ecomModel.id}/cast-jobs`, "POST", castBody);
  assert.equal(modelCast.type, "MODEL_CAST");
  assert.equal(modelCast.projectId, null);
  // 同 spec + 同参考脸 + 同参数命中请求指纹：任务在途时复用同一任务（202），不重复计费
  const inFlightDuplicate = await fetch(`${base}/models/${ecomModel.id}/cast-jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(castBody) });
  assert.equal(inFlightDuplicate.status, 202);
  assert.equal((await inFlightDuplicate.json()).id, modelCast.id);
  const castDone = await waitJob(base, modelCast.id);
  assert.equal(castDone.status, "SUCCEEDED");
  // 已成功后再提交同样参数：200 而非 202，表示「复用了结果、不会有新候选」，前端据此不再轮询也不再报“已生成”
  const reusedCast = await fetch(`${base}/models/${ecomModel.id}/cast-jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(castBody) });
  assert.equal(reusedCast.status, 200);
  assert.equal((await reusedCast.json()).id, modelCast.id);
  // 参考脸存在时，worker 在生图 Prompt 前置身份锚点
  assert.match(observed.imagePrompt, /Identity reference/);
  const castPortraits = await requestJson(`${base}/models/${ecomModel.id}/portraits`, "GET");
  assert.equal(castPortraits.items.length, 1);
  assert.equal((await fetch(new URL(castPortraits.items[0].url, base))).status, 200);
  // 候选同样进资产库（MODEL 条目、模特名可检索）；此处只验证库视图与缩略图地址可用，
  // 缩略图惰性兜底的「按 hash 反查模特候选」由 packages/core 的用例精确覆盖（e2e 里同 hash 的缩略图已被先生成的产物预热）。
  const castLibraryItems = await requestJson(`${base}/library-assets?kind=MODEL&q=${encodeURIComponent("小满")}`, "GET");
  assert.equal(castLibraryItems.items.length, 1);
  assert.equal((await fetch(new URL(castLibraryItems.items[0].thumbnailUrl, base))).status, 200);
  // 局部更新：只改名字时 spec/notes 必须原样保留（PATCH 曾把缺省字段写成 NULL）
  const renamedModel = await requestJson(`${base}/models/${ecomModel.id}`, "PATCH", { name: "小满 v2" });
  assert.equal(renamedModel.name, "小满 v2");
  assert.equal(renamedModel.notes, "e2e model cast");
  assert.equal(renamedModel.portraitCount, 1);
  // 选定切换：select 返回带 selectedPortrait 的模特详情，列表视图同步可见
  const selectedCastModel = await requestJson(`${base}/model-portraits/${castPortraits.items[0].id}/select`, "POST");
  assert.equal(selectedCastModel.selectedPortrait.id, castPortraits.items[0].id);
  assert.equal(selectedCastModel.portraitCount, 1);
  const modelsAfterCast = await requestJson(`${base}/models`, "GET");
  assert.equal(modelsAfterCast.items.find((item) => item.id === ecomModel.id)?.selectedPortrait.id, castPortraits.items[0].id);
  // 花型工坊链路：商品图提取（SAM 单主体抠图）→ 规格包（确定性排版）→ Listing 文案（看图写跨境文案）
  const printSpecs = await requestJson(`${base}/pod/print-specs`, "GET");
  assert.equal(printSpecs.specVersion, "2026.09");
  assert.equal(printSpecs.items.length, 6);
  const extractForm = new FormData();
  extractForm.append("providerId", provider.id);
  extractForm.append("modelId", "sam-3");
  extractForm.append("name", "水彩野花");
  extractForm.append("brief", "只留杯壁图案");
  extractForm.append("file", new Blob([patternSourcePng()], { type: "image/png" }), "cup.png");
  const extractResponse = await fetch(`${base}/patterns/extract-jobs`, { method: "POST", body: extractForm });
  const extractText = await extractResponse.text();
  assert.equal(extractResponse.status, 202, extractText);
  const extractJob = JSON.parse(extractText);
  assert.equal(extractJob.type, "PATTERN_EXTRACT");
  assert.equal(extractJob.projectId, null);
  const extractDone = await waitJob(base, extractJob.id);
  assert.equal(extractDone.status, "SUCCEEDED");
  // 提取复用分割 Provider 三元组（显式快照，不继承项目配置）；请求到达 fal 端点并携带内联源图
  assert.match(JSON.stringify(observed.samRequests.at(-1)), /"image_url":"data:image\/png;base64,/);
  // 同源图同参数命中请求指纹：200 复用既有任务，不重复计费
  const duplicateExtract = await fetch(`${base}/patterns/extract-jobs`, { method: "POST", body: extractForm });
  assert.equal(duplicateExtract.status, 200);
  assert.equal((await duplicateExtract.json()).id, extractJob.id);
  const patterns = await requestJson(`${base}/patterns`, "GET");
  assert.equal(patterns.items.length, 1);
  const pattern = patterns.items[0];
  assert.equal(pattern.source, "EXTRACTED");
  assert.equal(pattern.name, "水彩野花");
  assert.equal((await fetch(new URL(pattern.imageUrl, base))).status, 200);
  assert.equal((await fetch(new URL(pattern.thumbUrl, base))).status, 200);
  // 花型进资产库：PATTERN 条目按 pattern: 前缀寻址
  const patternLibrary = await requestJson(`${base}/library-assets?kind=PATTERN`, "GET");
  assert.equal(patternLibrary.items.length, 1);
  assert.equal(patternLibrary.items[0].id, `pattern:${pattern.id}`);
  // 规格包：一任务一记录，PRINT_FILE + manifest 双产物，只有 PRINT_FILE 进资产库
  const packResponse = await requestJson(`${base}/patterns/${pattern.id}/print-pack-jobs`, "POST", { specId: "mug-11oz-wrap" });
  assert.equal(packResponse.job.type, "PRINT_PACK");
  assert.equal(packResponse.printPack.status, "QUEUED");
  const packJob = await waitJob(base, packResponse.job.id);
  assert.equal(packJob.status, "SUCCEEDED");
  const packs = await requestJson(`${base}/patterns/${pattern.id}/print-packs`, "GET");
  assert.equal(packs.items[0].status, "SUCCEEDED");
  // 居中版式：PRINT_FILE + MOCKUP（品类示意图）+ MANIFEST 三件产物
  assert.deepEqual(packs.items[0].files.map((file) => file.kind), ["PRINT_FILE", "MOCKUP", "MANIFEST"]);
  const packPng = await fetch(new URL(packs.items[0].files[0].url, base));
  assert.equal(packPng.status, 200);
  assert.equal(Buffer.from(await packPng.arrayBuffer()).subarray(1, 4).toString("binary"), "PNG");
  const packMockup = await fetch(new URL(packs.items[0].files[1].url, base));
  assert.equal(packMockup.status, 200);
  assert.equal(Buffer.from(await packMockup.arrayBuffer()).subarray(1, 4).toString("binary"), "PNG");
  const packManifest = await fetch(new URL(packs.items[0].files[2].url, base));
  assert.match(await packManifest.text(), /"kind":\s*"ecomgen\.print-pack"/);
  const packLibrary = await requestJson(`${base}/library-assets?kind=PRINT_PACK`, "GET");
  assert.equal(packLibrary.items.length, 1);
  assert.equal((await fetch(new URL(packLibrary.items[0].url, base))).status, 200);
  // 已成功的同规格请求复用（200），不重复合成
  const reusedPack = await fetch(`${base}/patterns/${pattern.id}/print-pack-jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ specId: "mug-11oz-wrap" }) });
  assert.equal(reusedPack.status, 200);
  assert.equal((await reusedPack.json()).job.id, packResponse.job.id);
  // Listing 文案：看图写 Etsy 文案，平台硬约束在 Prompt 与结果校验两侧生效
  const listingBody = { providerId: provider.id, modelId: "mock-reasoner", platform: "ETSY", sellingPoints: "gift for plant lovers", bannedWords: "disney" };
  const listingJob = await requestJson(`${base}/patterns/${pattern.id}/listing-jobs`, "POST", listingBody);
  assert.equal(listingJob.type, "COPYWRITE");
  const listingDone = await waitJob(base, listingJob.id);
  assert.equal(listingDone.status, "SUCCEEDED");
  assert.match(observed.listingPrompt, /Etsy rules/);
  assert.match(observed.listingPrompt, /disney/); // 禁用词随 payload 注入生成提示，由结果校验保证不出现
  const listingResult = await requestJson(`${base}/patterns/${pattern.id}/listing-jobs/${listingJob.id}/result`, "GET");
  assert.equal(listingResult.platform, "ETSY");
  assert.ok(listingResult.copy.title.length <= 140, "Etsy title must satisfy the 140-char cap");
  assert.equal(listingResult.copy.tags.length, 13);
  assert.doesNotMatch(listingResult.copy.title, /disney/i);
  const reusedListing = await fetch(`${base}/patterns/${pattern.id}/listing-jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(listingBody) });
  assert.equal(reusedListing.status, 200);
  assert.equal((await reusedListing.json()).id, listingJob.id);
  // AI 起稿：主题一句话直达生图，每张候选各自成为独立花型
  const forgePatternJob = await requestJson(`${base}/patterns/forge-jobs`, "POST", { providerId: provider.id, imageModelId: "mock-image", theme: "水彩野花束，奶油色底，留白呼吸感", candidateCount: 1 });
  assert.equal(forgePatternJob.type, "PATTERN_FORGE");
  const forgePatternDone = await waitJob(base, forgePatternJob.id);
  assert.equal(forgePatternDone.status, "SUCCEEDED");
  const patternsAfterForge = await requestJson(`${base}/patterns`, "GET");
  assert.equal(patternsAfterForge.items.length, 2);
  assert.equal(patternsAfterForge.items.find((item) => item.id !== pattern.id)?.source, "GENERATED");
  // 上传花型文件：跳过提取直接入库（来源 UPLOADED）
  const uploadForm = new FormData();
  uploadForm.append("name", "上传的几何花型");
  uploadForm.append("tags", JSON.stringify(["几何"]));
  uploadForm.append("file", new Blob([Buffer.from(onePixelReferencePng, "base64")], { type: "image/png" }), "geo.png");
  const uploadResponse = await fetch(`${base}/patterns/upload`, { method: "POST", body: uploadForm });
  const uploadText = await uploadResponse.text();
  assert.equal(uploadResponse.status, 201, uploadText);
  const uploadedPattern = JSON.parse(uploadText);
  assert.equal(uploadedPattern.source, "UPLOADED");
  assert.equal((await requestJson(`${base}/patterns`, "GET")).items.length, 3);
  // 花型衍生：改色为确定性本地运算，产出新花型（source DERIVED、血缘指向源）
  const recolorJob = await requestJson(`${base}/patterns/${pattern.id}/derive-jobs`, "POST", { hueShift: 40, saturationPct: 120 });
  assert.equal(recolorJob.type, "PATTERN_DERIVE");
  const recolorDone = await waitJob(base, recolorJob.id);
  assert.equal(recolorDone.status, "SUCCEEDED");
  const recolorPattern = (await requestJson(`${base}/patterns`, "GET")).items.find((item) => item.sourceJobId === recolorJob.id);
  assert.ok(recolorPattern, "recolor derive must produce a visible pattern");
  assert.equal(recolorPattern.source, "DERIVED");
  assert.equal(recolorPattern.parentPatternId, pattern.id);
  // 同参数复用（200），不重复产出花型
  const reusedRecolor = await fetch(`${base}/patterns/${pattern.id}/derive-jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hueShift: 40, saturationPct: 120 }) });
  assert.equal(reusedRecolor.status, 200);
  assert.equal((await reusedRecolor.json()).id, recolorJob.id);
  // 平铺满印版式：对改色产物成 TILE 包，产物为 PRINT_FILE + MOCKUP + SEAMLESS_TILE + MANIFEST 四件；
  // 再以半落排列成包：文件四件齐全，manifest 记录 repeatLayout 与无缝单元尺寸，无缝单元可下载。
  const tilePack = await requestJson(`${base}/patterns/${recolorPattern.id}/print-pack-jobs`, "POST", { specId: "tshirt-front-12x16", layout: "TILE" });
  const tilePackJob = await waitJob(base, tilePack.job.id);
  assert.equal(tilePackJob.status, "SUCCEEDED");
  const tilePacks = await requestJson(`${base}/patterns/${recolorPattern.id}/print-packs`, "GET");
  assert.deepEqual(tilePacks.items[0].files.map((file) => file.kind), ["PRINT_FILE", "MOCKUP", "SEAMLESS_TILE", "MANIFEST"]);
  assert.equal((await fetch(new URL(tilePacks.items[0].files[0].url, base))).status, 200);
  assert.equal((await fetch(new URL(tilePacks.items[0].files[1].url, base))).status, 200);
  const dropPack = await requestJson(`${base}/patterns/${recolorPattern.id}/print-pack-jobs`, "POST", { specId: "tshirt-front-12x16", layout: "TILE", repeatLayout: "HALF_DROP" });
  const dropPackJob = await waitJob(base, dropPack.job.id);
  assert.equal(dropPackJob.status, "SUCCEEDED");
  const dropPacks = await requestJson(`${base}/patterns/${recolorPattern.id}/print-packs`, "GET");
  const dropFiles = dropPacks.items.find((pack) => pack.jobId === dropPack.job.id).files;
  assert.deepEqual(dropFiles.map((file) => file.kind), ["PRINT_FILE", "MOCKUP", "SEAMLESS_TILE", "MANIFEST"]);
  const dropManifestFile = dropFiles.find((file) => file.kind === "MANIFEST");
  const dropManifest = JSON.parse(await (await fetch(new URL(dropManifestFile.url, base))).text());
  assert.equal(dropManifest.repeatLayout, "HALF_DROP");
  assert.equal(dropManifest.seam, "depends-on-source-tileability");
  // 无缝单元尺寸在源图原生分辨率下（与印刷画布无关），几何由 worker 单测锁定，这里只验非零与可下载。
  assert.ok(dropManifest.seamlessTile.width > 0);
  assert.ok(dropManifest.seamlessTile.height > 0);
  const dropTileFile = dropFiles.find((file) => file.kind === "SEAMLESS_TILE");
  assert.equal((await fetch(new URL(dropTileFile.url, base))).status, 200);
  // 成包流水线（满印链跑完）：三问只答一次，worker 按 position 把「验缝 → 规格包 → 文案」推到底。
  // 均匀底花型的验缝判定是确定性的 VERIFIED，所以这条链不该在任何一步停下。
  const pipelineForm = new FormData();
  pipelineForm.append("name", "流水线满印底纹");
  pipelineForm.append("pipeline", JSON.stringify({ specId: "tshirt-front-12x16", layout: "TILE", listingPlatform: "ETSY", listingProviderId: provider.id, listingModelId: "mock-reasoner" }));
  pipelineForm.append("file", new Blob([uniformPatternPng(64)], { type: "image/png" }), "uniform.png");
  const pipelineUpload = await fetch(`${base}/patterns/upload`, { method: "POST", body: pipelineForm });
  const pipelineUploadText = await pipelineUpload.text();
  assert.equal(pipelineUpload.status, 201, pipelineUploadText);
  const pipelinePattern = JSON.parse(pipelineUploadText);
  // 上传没有来源任务可等：步骤表里没有 SOURCE，直接起跑验缝
  const startedPipelines = await requestJson(`${base}/patterns/${pipelinePattern.id}/pipelines`, "GET");
  assert.equal(startedPipelines.items.length, 1);
  const startedPipeline = startedPipelines.items[0];
  assert.deepEqual(startedPipeline.steps.map((step) => step.step), ["TILE_CHECK", "PRINT_PACK", "LISTING"]);
  const sealedPipeline = await waitPipeline(base, startedPipeline.id);
  assert.equal(sealedPipeline.status, "SUCCEEDED");
  assert.deepEqual(sealedPipeline.steps.map((step) => step.status), ["SUCCEEDED", "SUCCEEDED", "SUCCEEDED"]);
  // 验缝判定回写花型：这一步的产物就是属性本身
  const sealedPattern = (await requestJson(`${base}/patterns`, "GET")).items.find((item) => item.id === pipelinePattern.id);
  assert.equal(sealedPattern.tileable, "VERIFIED");
  // 规格包与文案两步的产物都能按步骤 jobId 取回（收据不是空壳）
  const pipelinePacks = await requestJson(`${base}/patterns/${pipelinePattern.id}/print-packs`, "GET");
  assert.equal(pipelinePacks.items.length, 1);
  assert.deepEqual(pipelinePacks.items[0].files.map((file) => file.kind), ["PRINT_FILE", "MOCKUP", "SEAMLESS_TILE", "MANIFEST"]);
  const listingStep = sealedPipeline.steps.find((step) => step.step === "LISTING");
  const pipelineListing = await requestJson(`${base}/patterns/${pipelinePattern.id}/listing-jobs/${listingStep.jobId}/result`, "GET");
  assert.equal(pipelineListing.platform, "ETSY");
  assert.ok(pipelineListing.copy.tags.length > 0);

  // 成包流水线（接缝裁决）：1×1 花型的验缝必然 FAILED，满印链必须停在 AWAITING_INPUT 等裁决，
  // 既不静默降级成居中，也不越权先把规格包跑出来。
  const seamPipeline = await requestJson(`${base}/patterns/${uploadedPattern.id}/pipelines`, "POST", { specId: "tshirt-front-12x16", layout: "TILE", listingPlatform: "ETSY", listingProviderId: provider.id, listingModelId: "mock-reasoner" });
  assert.equal(seamPipeline.status, "RUNNING");
  const waiting = await waitPipeline(base, seamPipeline.id, "AWAITING_INPUT");
  assert.equal(waiting.blockReason, "SEAM_RISK");
  const waitingTileStep = waiting.steps.find((step) => step.step === "TILE_CHECK");
  assert.equal(waitingTileStep.status, "SUCCEEDED");
  assert.match(String(waitingTileStep.detail.warning), /接缝/);
  const waitingPackStep = waiting.steps.find((step) => step.step === "PRINT_PACK");
  assert.equal(waitingPackStep.status, "PENDING");
  assert.equal(waitingPackStep.jobId, null);
  // 裁决零（换镜像）：镜像排列构造性无缝，闸门对它放行——版式保持满印、排列改写为 MIRROR，
  // 规格包带 SEAMLESS_TILE，manifest 标注 seam=by-construction。
  // sellingPoints 进流水线指纹：不带区分字段会复用上面停在 AWAITING_INPUT 的同参数流水线，而不是新建一条。
  const mirrorPipeline = await requestJson(`${base}/patterns/${uploadedPattern.id}/pipelines`, "POST", { specId: "tshirt-front-12x16", layout: "TILE", sellingPoints: "mirror verdict case", listingPlatform: "ETSY", listingProviderId: provider.id, listingModelId: "mock-reasoner" });
  await waitPipeline(base, mirrorPipeline.id, "AWAITING_INPUT");
  const mirrored = await requestJson(`${base}/pattern-pipelines/${mirrorPipeline.id}/continue`, "POST", { resolution: "USE_MIRROR" });
  assert.equal(mirrored.layout, "TILE");
  assert.equal(mirrored.repeatLayout, "MIRROR");
  const mirroredDone = await waitPipeline(base, mirrorPipeline.id);
  assert.equal(mirroredDone.status, "SUCCEEDED");
  const mirrorPackStep = mirroredDone.steps.find((step) => step.step === "PRINT_PACK");
  const mirrorPackJob = await requestJson(`${base}/jobs/${mirrorPackStep.jobId}`, "GET");
  assert.equal(mirrorPackJob.input.repeatLayout, "MIRROR");
  const mirrorPacks = await requestJson(`${base}/patterns/${uploadedPattern.id}/print-packs`, "GET");
  const mirrorPack = mirrorPacks.items.find((pack) => pack.jobId === mirrorPackStep.jobId);
  assert.ok(mirrorPack.files.some((file) => file.kind === "SEAMLESS_TILE"), `mirror pack files: ${JSON.stringify(mirrorPack.files.map((file) => file.kind))}`);
  const mirrorManifest = JSON.parse(await (await fetch(new URL(mirrorPack.files.find((file) => file.kind === "MANIFEST").url, base))).text());
  assert.equal(mirrorManifest.repeatLayout, "MIRROR");
  assert.equal(mirrorManifest.seam, "by-construction");

  // 裁决一：改用居中继续 → 版式落库后规格包按新版式出图，链跑完
  const resolved = await requestJson(`${base}/pattern-pipelines/${seamPipeline.id}/continue`, "POST", { resolution: "USE_CENTERED" });
  assert.equal(resolved.layout, "CENTERED");
  assert.equal(resolved.status, "RUNNING");
  const resolvedDone = await waitPipeline(base, seamPipeline.id);
  assert.equal(resolvedDone.status, "SUCCEEDED");
  const resolvedPackStep = resolvedDone.steps.find((step) => step.step === "PRINT_PACK");
  const resolvedPackJob = await requestJson(`${base}/jobs/${resolvedPackStep.jobId}`, "GET");
  assert.equal(resolvedPackJob.input.layout, "CENTERED");
  // 生成式提取：同一端点带 mode=GENERATE，走生图模型重绘（mock 的 images/edits 端点）。
  // mock-image 不支持透明底（按 id 家族判定），底版按白底提交，验证生图路径的编排与落库。
  const generateExtractForm = new FormData();
  generateExtractForm.append("mode", "GENERATE");
  generateExtractForm.append("providerId", provider.id);
  generateExtractForm.append("modelId", "mock-image");
  generateExtractForm.append("background", "WHITE");
  generateExtractForm.append("name", "生成提取的花型");
  generateExtractForm.append("file", new Blob([patternSourcePng()], { type: "image/png" }), "cup.png");
  const generateExtractResponse = await fetch(`${base}/patterns/extract-jobs`, { method: "POST", body: generateExtractForm });
  const generateExtractText = await generateExtractResponse.text();
  assert.equal(generateExtractResponse.status, 202, generateExtractText);
  const generateExtractJob = JSON.parse(generateExtractText);
  assert.equal(generateExtractJob.type, "PATTERN_EXTRACT");
  const generateExtractDone = await waitJob(base, generateExtractJob.id);
  assert.equal(generateExtractDone.status, "SUCCEEDED");
  const generateExtractPattern = (await requestJson(`${base}/patterns`, "GET")).items.find((item) => item.sourceJobId === generateExtractJob.id);
  assert.ok(generateExtractPattern, "generate extract must produce a visible pattern");
  assert.equal((await fetch(new URL(generateExtractPattern.imageUrl, base))).status, 200);
  // 同表单重发命中请求指纹：200 复用既有任务，不重复计费
  const duplicateGenerateExtract = await fetch(`${base}/patterns/extract-jobs`, { method: "POST", body: generateExtractForm });
  assert.equal(duplicateGenerateExtract.status, 200);
  // 取消传播：上游永不返回时，取消必须真正断开在途请求，而不是等超时后再丢弃已计费的结果。
  // 已生成的分镜被服务端冻结 Prompt，因此这里用一个独立项目构造该请求，顺带不干扰主链路的产物计数。
  const cancelProject = await requestJson(`${base}/projects`, "POST", {
    name: "Cancel case",
    category: "home",
    productDescription: `A cup used to verify cancellation behaviour. ${hangingImagePromptMarker}`,
    verifiedFacts: [],
    prohibitedClaims: [],
    brandGuidelines: { accent: "#1A3A2E", tone: "premium practical" },
    platformTargets: ["AMAZON"],
    targetMarket: "UNITED_STATES",
    copyLanguage: "en-US",
    reasoningProviderId: provider.id,
    reasoningModelId: "mock-reasoner",
    imageProviderId: provider.id,
    imageModelId: "mock-image",
    defaultMode: "CREATIVE",
    imageResolution: "1K",
    imageAspectRatio: "AUTO",
    candidatesPerType: 1
  });
  await requestJson(`${base}/projects/${cancelProject.id}/planning-jobs`, "POST", { planningMode: "AI", requestedTypes: ["hero-image"], candidatesPerType: 1, targetImageCount: 1 });
  const cancelPlanJob = await waitForJob(base, cancelProject.id, "PLAN");
  assert.equal(cancelPlanJob.status, "SUCCEEDED");
  const cancelStoryboard = await requestJson(`${base}/projects/${cancelProject.id}/storyboard`, "GET");
  await requestJson(`${base}/projects/${cancelProject.id}/storyboard/confirm`, "POST", { version: cancelStoryboard.storyboard.version });
  const cancelGeneration = await requestJson(`${base}/projects/${cancelProject.id}/generation-jobs`, "POST", { storyboardItemIds: [cancelStoryboard.items[0].id] });
  const cancelJobId = cancelGeneration.jobs[0].id;
  await waitFor(() => cancellation.hangingRequests === 1, 15_000, "hanging generation request");
  // 取消之前请求必须仍在途，否则这条断言无法证明取消"中断"了什么。
  assert.equal(cancellation.abortedBeforeResponse, 0);
  await requestJson(`${base}/jobs/${cancelJobId}/cancel`, "POST");
  const cancelledGeneration = await waitJob(base, cancelJobId);
  assert.equal(cancelledGeneration.status, "CANCELLED");
  await waitFor(() => cancellation.abortedBeforeResponse === 1, 15_000, "aborted provider connection");
  // 取消不是瞬时错误：重发一次就是再付一次费，因此上游只允许收到一次请求。
  assert.equal(cancellation.hangingRequests, 1);
  assert.equal((await requestJson(`${base}/projects/${cancelProject.id}/outputs`, "GET")).length, 0);
  console.log("Mock E2E passed: plan -> confirm -> generate -> export -> custom template MANUAL plan & generate -> suite forge -> model cast & select -> pattern extract (segment + generate) /forge/upload/derive & print pack (centered + tile + mockup) & listing & packaging pipeline (full chain + seam-risk stop & resolution) -> cancel aborts in-flight generation");
} finally {
  await Promise.all(children.map(stop));
  if (mock) await new Promise((resolveClose) => mock.close(resolveClose));
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* A prior crashed child can leave a Windows file handle briefly. */ }
}

function start(script, env) { const child = spawn(process.execPath, [script], { cwd: root, env, stdio: "pipe" }); child.stderr.on("data", (data) => process.stderr.write(`[${script}] ${data}`)); child.stdout.on("data", (data) => { if (data.toString("utf8").includes(WORKER_READY_LINE)) workerReady = true; }); return child; }
function pngChunk(type, data) { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const typeBuffer = Buffer.from(type, "ascii"); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0); return Buffer.concat([length, typeBuffer, data, crc]); }
function solidPng(red, green, blue) {
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.from([0, red, green, blue, 255]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
// 提取链路的源图：3×3 双色图（sharp trim 的下限就是 3×3），边框与中心异色保证抠像裁边后仍有产物
// 均匀底 PNG：验缝对它是确定性的 VERIFIED（四周无差、内部也无差），用来走通"满印链一路跑完"
function uniformPatternPng(size) {
  const pixel = Buffer.from([120, 140, 90, 255]);
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: size }, () => pixel)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
function patternSourcePng() {
  const ring = [26, 58, 46, 255];
  const center = [204, 102, 61, 255];
  const header = Buffer.alloc(13); header.writeUInt32BE(3, 0); header.writeUInt32BE(3, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.from([
    0, ...ring, ...ring, ...ring,
    0, ...ring, ...center, ...ring,
    0, ...ring, ...ring, ...ring,
  ]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
function stop(child) { if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(); return new Promise((resolveStop) => { child.once("exit", resolveStop); child.kill(); }); }
function readBody(request) { return new Promise((resolveBody, reject) => { const chunks = []; request.on("data", (chunk) => chunks.push(Buffer.from(chunk))); request.on("end", () => resolveBody(Buffer.concat(chunks))); request.on("error", reject); }); }
// 解析 multipart 表单的 name→payload 映射；payload 保留原始字节（文本字段调用方自行 toString）
function multipartFields(body, boundary) {
  const fields = {};
  const delimiter = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const next = body.indexOf(delimiter, cursor + delimiter.length);
    if (next === -1) break;
    const chunk = body.subarray(cursor + delimiter.length, next);
    const headerEnd = chunk.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const name = /name="([^"]*)"/.exec(chunk.subarray(0, headerEnd).toString("utf8"))?.[1];
      if (name) fields[name] = chunk.subarray(headerEnd + 4, chunk.length - 2);
    }
    cursor = next;
  }
  return fields;
}
function listen(server) { return new Promise((resolvePort, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolvePort(server.address().port)); }); }
async function freePort() { const server = createServer(); const port = await listen(server); await new Promise((resolveClose) => server.close(resolveClose)); return port; }
async function requestJson(url, method, body) { const response = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await response.text(); assert.ok(response.ok, `${method} ${url} failed (${response.status}): ${text}`); return text ? JSON.parse(text) : undefined; }
async function waitFor(predicate, timeoutMs = 15_000, label = "condition") { const end = Date.now() + timeoutMs; let lastError; while (Date.now() < end) { try { if (await predicate()) return; } catch (error) { lastError = error; } await delay(100); } throw lastError ?? new Error(`Timed out waiting for ${label}`); }
async function waitJob(base, id) { let final; await waitFor(async () => { final = await requestJson(`${base}/jobs/${id}`, "GET"); return ["SUCCEEDED", "FAILED", "CANCELLED"].includes(final.status); }); return final; }
// 流水线终态：AWAITING_INPUT 不是终态（等用户裁决），默认等"跑完或失败"；需要停在裁决点就显式传目标状态
async function waitPipeline(base, id, stopAt) { let current; await waitFor(async () => { current = await requestJson(`${base}/pattern-pipelines/${id}`, "GET"); if (stopAt) return current.status === stopAt; return ["SUCCEEDED", "FAILED", "CANCELLED"].includes(current.status); }, 20_000, `pattern pipeline ${id}`); return current; }
async function waitForJob(base, projectId, type) { let found; await waitFor(async () => { const detail = await requestJson(`${base}/projects/${projectId}`, "GET"); found = detail.jobs.find((job) => job.type === type); return Boolean(found && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(found.status)); }); return found; }
function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
