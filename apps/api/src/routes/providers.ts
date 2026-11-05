import type { FastifyInstance } from "fastify";
import {
  GeminiImageProvider,
  OpenAiCompatibleImageProvider,
  ProviderError,
  SeedreamLayerizeProvider,
  createSegmentationProvider,
  discoverProviderModels,
  probeReasoning,
  type PromptSegmentationProtocol,
} from "@ecomgen/providers";
import type { ProviderRecord } from "@ecomgen/core";
import { CreateProviderInput, DiscoverProviderModelsInput, TestProviderInput, UpdateProviderInput } from "@ecomgen/contracts";
import type { ReasoningProtocolProfile } from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import { missing } from "../helpers.js";
import { parseBody } from "../http-input.js";
import { enumValue, normalizeModels, parameter, readOptionalText, readText } from "../input-normalizers.js";

function publicProvider(value: ProviderRecord): object { const { encryptedApiKey, ...provider } = value; return { ...provider, hasApiKey: Boolean(encryptedApiKey) }; }

export function registerProviderRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, secrets, events } = ctx;
  app.get("/api/v1/providers", async () => ({ items: repository.listProviders().map(publicProvider), nextCursor: null }));
  app.post("/api/v1/providers", async (request, reply) => {
    const body = parseBody(CreateProviderInput, request.body);
    const models = normalizeModels(body.models);
    const apiKey = readText(body.apiKey, "apiKey");
    const reasoningProtocol = enumValue<ReasoningProtocolProfile>(body.reasoningProtocol ?? "openai", ["openai", "dashscope_qwen", "openai_responses"], "reasoningProtocol");
    const record = repository.saveProvider({ name: readText(body.name, "name"), baseUrl: readText(body.baseUrl, "baseUrl"), reasoningProtocol, encryptedApiKey: secrets.encrypt(apiKey), models });
    await events.publish("system", "provider.updated", publicProvider(record)); return reply.code(201).send(publicProvider(record));
  });
  app.patch("/api/v1/providers/:providerId", async (request) => {
    const id = parameter(request, "providerId"); const current = repository.getProvider(id); if (!current) missing("provider", id);
    const body = parseBody(UpdateProviderInput, request.body);
    const reasoningProtocol = body.reasoningProtocol === undefined ? current.reasoningProtocol : enumValue<ReasoningProtocolProfile>(body.reasoningProtocol, ["openai", "dashscope_qwen", "openai_responses"], "reasoningProtocol");
    const record = repository.saveProvider({ id, name: readOptionalText(body.name) ?? current.name, baseUrl: readOptionalText(body.baseUrl) ?? current.baseUrl, reasoningProtocol, encryptedApiKey: body.apiKey ? secrets.encrypt(readText(body.apiKey, "apiKey")) : current.encryptedApiKey, models: body.models ? normalizeModels(body.models) : current.models });
    await events.publish("system", "provider.updated", publicProvider(record)); return publicProvider(record);
  });
  app.post("/api/v1/providers/discover-models", async (request) => {
    const body = parseBody(DiscoverProviderModelsInput, request.body);
    // providerId 命中已保存记录时允许省略 baseUrl/apiKey（编辑表单不回显密钥也能拉取）；
    // 显式提供的值覆盖存储值，覆盖的是表单里已修改但尚未保存的连接信息。
    let baseUrl = readOptionalText(body.baseUrl);
    let apiKey = readOptionalText(body.apiKey);
    if (body.providerId !== undefined) {
      const providerId = readText(body.providerId, "providerId");
      const provider = repository.getProvider(providerId);
      if (!provider) missing("provider", providerId);
      baseUrl = baseUrl ?? provider.baseUrl;
      apiKey = apiKey ?? secrets.decrypt(provider.encryptedApiKey);
    }
    if (!baseUrl) throw new ApiError(400, "VALIDATION_ERROR", "baseUrl is required when providerId is absent");
    if (!apiKey) throw new ApiError(400, "VALIDATION_ERROR", "apiKey is required when providerId is absent");
    // 零费用 GET /models，与 test 路由一样在 API 内同步完成，不经过队列
    try {
      return await discoverProviderModels({ baseUrl, apiKey });
    } catch (error) { if (error instanceof ProviderError) throw new ApiError(502, "PROVIDER_ERROR", error.message); throw error; }
  });
  app.post("/api/v1/providers/:providerId/test", async (request) => {
    const providerId = parameter(request, "providerId"); const provider = repository.getProvider(providerId); if (!provider) missing("provider", providerId);
    const body = parseBody(TestProviderInput, request.body); const modelId = readText(body.modelId, "modelId"); const kind = enumValue<"reasoning" | "image" | "segmentation">(body.kind ?? "image", ["reasoning", "image", "segmentation"], "kind");
    const model = provider.models.find((candidate) => candidate.id === modelId); if (!model) throw new ApiError(400, "VALIDATION_ERROR", "modelId is not declared by the selected provider");
    if (kind === "image" && !model.imageApiKind) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected image model has no image API configured");
    if (kind === "segmentation" && !model.segmentationProtocol) throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected segmentation model has no segmentation API configured");
    try {
      if (kind === "reasoning") {
        const probeModel = model;
        const probe = await probeReasoning({ providerId, modelId, baseUrl: provider.baseUrl, protocol: provider.reasoningProtocol, supportsVision: probeModel.supportsVision, supportsThinking: probeModel.supportsThinking, supportsStructuredOutput: probeModel.supportsStructuredOutput, apiKey: secrets.decrypt(provider.encryptedApiKey) });
        return { ok: true, providerId, modelId, kind, latencyMs: probe.latencyMs, models: null, modelAvailable: true };
      }
      if (kind === "segmentation") {
        // 分割探测只做零费用连通性检查（/models 或最小请求），不调用真实分割
        const apiKey = secrets.decrypt(provider.encryptedApiKey);
        // seedream 走整图图层合成协议（无逐元素接口），其余文本提示协议统一由工厂选择适配器
        const probe = model.segmentationProtocol === "seedream_layerize"
          ? await new SeedreamLayerizeProvider({ baseUrl: provider.baseUrl, apiKey }).probe()
          : await createSegmentationProvider(model.segmentationProtocol as PromptSegmentationProtocol, { baseUrl: provider.baseUrl, apiKey }).probe();
        return { ok: true, providerId, modelId, kind, ...probe, modelAvailable: null };
      }
      const probe = model.imageApiKind === "gemini"
        ? await new GeminiImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) }).probe()
        : await new OpenAiCompatibleImageProvider({ baseUrl: provider.baseUrl, apiKey: secrets.decrypt(provider.encryptedApiKey) }).probe();
      return { ok: true, providerId, modelId, kind, ...probe, modelAvailable: probe.models === null ? null : probe.models.includes(modelId) };
    }
    catch (error) { if (error instanceof ProviderError) throw new ApiError(502, "PROVIDER_ERROR", error.message); throw error; }
  });
  app.delete("/api/v1/providers/:providerId", async (request, reply) => { const id = parameter(request, "providerId"); const result = repository.deleteProvider(id); if (result === "missing") missing("provider", id); return reply.code(204).send(); });
}
