import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { crc32, deflateSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const dataDir = join(root, "data-e2e-mock");
// 生图产物用运行时生成的合法 1x1 PNG：旧的硬编码 base64 实际是损坏的 PNG，此前没有链路真正解码过它。
const onePixelPng = solidPng(26, 58, 46).toString("base64");
const onePixelReferencePng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
// SAM mock 返回的 mask 以亮度表示前景：用 1x1 纯白 PNG（运行时生成，避免依赖解码外部 base64）。
const whiteMaskDataUri = `data:image/png;base64,${solidPng(255, 255, 255).toString("base64")}`;
const layerElements = { elements: [{ name: "保温杯瓶身" }, { name: "杯盖" }] };
const plan = { campaignStyleLock: "fixed deep green #1A3A2E and clean off-white #FFFFFF ecommerce system", items: [{ assetType: "hero-image", displayName: "通勤杯质感首图", shotRole: "HERO", templateVariant: "luxury", candidateCount: 1, referencedAssets: [], mode: "PIXEL_PROTECTED", promptInstruction: "Create a premium e-commerce hero image of the verified green insulated travel cup. Preserve the exact product identity: shape, silhouette, colors, materials, logo and label placement, and proportions; do not redesign the product. Keep the exact supplied product geometry and visible details. Use a clean off-white background, centered three-quarter product composition, Rembrandt lighting, and restrained deep green accents. Preserve generous whitespace and reserve a blank price-overlay zone without generating readable price, logo, or promotional text. Use the verified fact 304 stainless steel body only as visual material guidance; do not claim keeps hot for 24 hours. No extra props, hands, watermarks, fake logos, or invented product details.", factClaims: ["304 stainless steel body"], riskFlags: [], sortOrder: 0 }] };
// 自定义模板场景：模型按 payload.userTemplates 中注入的 custom_prompt 撰写最终 Prompt；customTemplateId 在运行时由 API 生成后回填
let customTemplateId = "";
const customPlan = () => ({ campaignStyleLock: "warm festive gift box ecommerce system", items: [{ assetType: customTemplateId, displayName: "礼盒丝绒氛围图", shotRole: "SCENE", templateVariant: null, candidateCount: 1, referencedAssets: [], mode: "CREATIVE", promptInstruction: "Create a warm festive e-commerce gift box scene with soft window light, triangular composition, rich red velvet accents and a festive ribbon close-up. Preserve exact product identity: shape, silhouette, colors, materials, logo and label placement, and proportions; do not redesign the product. No readable text, watermarks, or invented product details.", factClaims: [], riskFlags: [], sortOrder: 0 }] });
const observed = { planningPrompt: "", copywritingPrompt: "", imagePrompt: "", layerPlanPrompt: "", samRequests: [], groundedRequests: [], layerizeRequests: [] };
const children = [];
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
        response.end(JSON.stringify({ model: imageBody.model, data: [
          { url: `data:image/png;base64,${solidPng(24, 32, 40).toString("base64")}`, z_index: 0 },
          { url: whiteMaskDataUri, z_index: 1, name: "保温杯瓶身", bounding_box: { absolute: [0, 0, 1, 1], normalized: [0, 0, 1000, 1000] } }
        ] }));
        return;
      }
      observed.imagePrompt = body.toString("utf8");
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
      { id: "doubao-seedream-5.0-pro-layerize", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: null, segmentationProtocol: "seedream_layerize" }
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
  await requestJson(`${base}/projects/${project.id}/storyboard/confirm`, "POST", {});
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
  assert.equal(observed.groundedRequests[0].body.text_prompt, "保温杯瓶身");
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
  await requestJson(`${base}/projects/${customProject.id}/storyboard/confirm`, "POST", {});
  const customGeneration = await requestJson(`${base}/projects/${customProject.id}/generation-jobs`, "POST", { storyboardItemIds: [customStoryboard.items[0].id] });
  const customGenerationJob = await waitJob(base, customGeneration.jobs[0].id);
  assert.equal(customGenerationJob.status, "SUCCEEDED");
  assert.match(observed.imagePrompt, /festive ribbon close-up/);
  console.log("Mock E2E passed: plan -> confirm -> generate -> export -> custom template MANUAL plan & generate");
} finally {
  await Promise.all(children.map(stop));
  if (mock) await new Promise((resolveClose) => mock.close(resolveClose));
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* A prior crashed child can leave a Windows file handle briefly. */ }
}

function start(script, env) { const child = spawn(process.execPath, [script], { cwd: root, env, stdio: "pipe" }); child.stderr.on("data", (data) => process.stderr.write(`[${script}] ${data}`)); return child; }
function pngChunk(type, data) { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const typeBuffer = Buffer.from(type, "ascii"); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0); return Buffer.concat([length, typeBuffer, data, crc]); }
function solidPng(red, green, blue) {
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.from([0, red, green, blue, 255]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
function stop(child) { if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(); return new Promise((resolveStop) => { child.once("exit", resolveStop); child.kill(); }); }
function readBody(request) { return new Promise((resolveBody, reject) => { const chunks = []; request.on("data", (chunk) => chunks.push(Buffer.from(chunk))); request.on("end", () => resolveBody(Buffer.concat(chunks))); request.on("error", reject); }); }
function listen(server) { return new Promise((resolvePort, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolvePort(server.address().port)); }); }
async function freePort() { const server = createServer(); const port = await listen(server); await new Promise((resolveClose) => server.close(resolveClose)); return port; }
async function requestJson(url, method, body) { const response = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await response.text(); assert.ok(response.ok, `${method} ${url} failed (${response.status}): ${text}`); return text ? JSON.parse(text) : undefined; }
async function waitFor(predicate, timeoutMs = 15_000) { const end = Date.now() + timeoutMs; let lastError; while (Date.now() < end) { try { if (await predicate()) return; } catch (error) { lastError = error; } await delay(100); } throw lastError ?? new Error("Timed out waiting for condition"); }
async function waitJob(base, id) { let final; await waitFor(async () => { final = await requestJson(`${base}/jobs/${id}`, "GET"); return ["SUCCEEDED", "FAILED", "CANCELLED"].includes(final.status); }); return final; }
async function waitForJob(base, projectId, type) { let found; await waitFor(async () => { const detail = await requestJson(`${base}/projects/${projectId}`, "GET"); found = detail.jobs.find((job) => job.type === type); return Boolean(found && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(found.status)); }); return found; }
function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
