import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const dataDir = join(root, "data-e2e-mock");
const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7WQAAAABJRU5ErkJggg==";
const onePixelReferencePng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const plan = { campaignStyleLock: "fixed deep green #1A3A2E and clean off-white #FFFFFF ecommerce system", items: [{ assetType: "hero-image", displayName: "通勤杯质感首图", templateVariant: "luxury", candidateCount: 1, referencedAssets: [], mode: "PIXEL_PROTECTED", promptInstruction: "Create a premium e-commerce hero image of the verified green insulated travel cup. Keep the exact supplied product geometry and visible details. Use a clean off-white background, centered three-quarter product composition, Rembrandt lighting, and restrained deep green accents. Preserve generous whitespace and reserve a blank price-overlay zone without generating readable price, logo, or promotional text. Use the verified fact 304 stainless steel body only as visual material guidance; do not claim keeps hot for 24 hours. No extra props, hands, watermarks, fake logos, or invented product details.", factClaims: ["304 stainless steel body"], riskFlags: [], sortOrder: 0 }] };
const observed = { planningPrompt: "", copywritingPrompt: "", imagePrompt: "" };
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
      observed.imagePrompt = body.toString("utf8");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "mock-image", data: [{ b64_json: onePixelPng }] }));
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
      { id: "mock-image", supportsVision: false, supportsThinking: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: "openai_images" }
    ]
  });
  const reasoningProbe = await requestJson(`${base}/providers/${provider.id}/test`, "POST", { modelId: "mock-reasoner", kind: "reasoning" });
  assert.equal(reasoningProbe.ok, true);
  const probe = await requestJson(`${base}/providers/${provider.id}/test`, "POST", { modelId: "mock-image", kind: "image" });
  assert.equal(probe.modelAvailable, true);
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
  console.log("Mock E2E passed: plan -> confirm -> generate -> export");
} finally {
  await Promise.all(children.map(stop));
  if (mock) await new Promise((resolveClose) => mock.close(resolveClose));
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* A prior crashed child can leave a Windows file handle briefly. */ }
}

function start(script, env) { const child = spawn(process.execPath, [script], { cwd: root, env, stdio: "pipe" }); child.stderr.on("data", (data) => process.stderr.write(`[${script}] ${data}`)); return child; }
function stop(child) { if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(); return new Promise((resolveStop) => { child.once("exit", resolveStop); child.kill(); }); }
function readBody(request) { return new Promise((resolveBody, reject) => { const chunks = []; request.on("data", (chunk) => chunks.push(Buffer.from(chunk))); request.on("end", () => resolveBody(Buffer.concat(chunks))); request.on("error", reject); }); }
function listen(server) { return new Promise((resolvePort, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolvePort(server.address().port)); }); }
async function freePort() { const server = createServer(); const port = await listen(server); await new Promise((resolveClose) => server.close(resolveClose)); return port; }
async function requestJson(url, method, body) { const response = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await response.text(); assert.ok(response.ok, `${method} ${url} failed (${response.status}): ${text}`); return text ? JSON.parse(text) : undefined; }
async function waitFor(predicate, timeoutMs = 15_000) { const end = Date.now() + timeoutMs; let lastError; while (Date.now() < end) { try { if (await predicate()) return; } catch (error) { lastError = error; } await delay(100); } throw lastError ?? new Error("Timed out waiting for condition"); }
async function waitJob(base, id) { let final; await waitFor(async () => { final = await requestJson(`${base}/jobs/${id}`, "GET"); return ["SUCCEEDED", "FAILED", "CANCELLED"].includes(final.status); }); return final; }
async function waitForJob(base, projectId, type) { let found; await waitFor(async () => { const detail = await requestJson(`${base}/projects/${projectId}`, "GET"); found = detail.jobs.find((job) => job.type === type); return Boolean(found && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(found.status)); }); return found; }
function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
