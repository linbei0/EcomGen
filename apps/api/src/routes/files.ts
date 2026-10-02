import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../context.js";
import { missing, renderThumbnail, sendStored } from "../helpers.js";
import { parameter } from "../input-normalizers.js";

export function registerFileRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, storage } = ctx;
  app.get("/api/v1/files/assets/:assetId", async (request, reply) => sendStored(request, reply, storage, repository.getAsset(parameter(request, "assetId")), "asset", parameter(request, "assetId")));
  app.get("/api/v1/files/edit-reference-assets/:referenceAssetId", async (request, reply) => sendStored(request, reply, storage, repository.getEditReferenceAsset(parameter(request, "referenceAssetId")), "reference asset", parameter(request, "referenceAssetId")));
  app.get("/api/v1/files/outputs/:outputId", async (request, reply) => sendStored(request, reply, storage, repository.getOutput(parameter(request, "outputId")), "output", parameter(request, "outputId")));
  // 缩略图按内容 hash 寻址，跨项目共享；命中缓存直接流式返回，未命中（含历史图片）现场生成后落盘。
  app.get("/api/v1/files/thumbnails/:hash", async (request, reply) => {
    const hash = parameter(request, "hash");
    const thumbnailPath = storage.thumbnailPath(hash);
    if (!(await storage.exists(thumbnailPath))) {
      const sourcePath = repository.findLibrarySourcePath(hash);
      if (!sourcePath) missing("library image", hash);
      await storage.putThumbnail(hash, await renderThumbnail(await storage.read(sourcePath)));
    }
    return sendStored(request, reply, storage, { storagePath: thumbnailPath, mimeType: "image/webp", hash }, "thumbnail", hash);
  });
  app.get("/api/v1/files/exports/:exportId", async (request, reply) => sendStored(request, reply, storage, repository.getExport(parameter(request, "exportId")), "export", parameter(request, "exportId")));
  app.get("/api/v1/files/models/:modelId/reference-face", async (request, reply) => {
    const model = repository.getModel(parameter(request, "modelId"));
    if (!model?.referenceFacePath) missing("reference face", parameter(request, "modelId"));
    return sendStored(request, reply, storage, { storagePath: model.referenceFacePath, hash: model.referenceFaceHash ?? undefined }, "reference face", parameter(request, "modelId"));
  });
  app.get("/api/v1/files/model-portraits/:portraitId", async (request, reply) => {
    const portrait = repository.getModelPortrait(parameter(request, "portraitId"));
    if (!portrait) missing("model portrait", parameter(request, "portraitId"));
    return sendStored(request, reply, storage, portrait, "model portrait", parameter(request, "portraitId"));
  });
  app.get("/api/v1/files/patterns/:patternId", async (request, reply) => {
    const pattern = repository.getPattern(parameter(request, "patternId"));
    if (!pattern) missing("pattern", parameter(request, "patternId"));
    return sendStored(request, reply, storage, { storagePath: pattern.storagePath, hash: pattern.fileHash ?? undefined, mimeType: "image/png" }, "pattern", parameter(request, "patternId"));
  });
  app.get("/api/v1/files/print-packs/:printPackId/files/:index", async (request, reply) => {
    const pack = repository.getPrintPack(parameter(request, "printPackId"));
    if (!pack) missing("print pack", parameter(request, "printPackId"));
    const index = Number(parameter(request, "index"));
    const file = Number.isInteger(index) && index >= 0 ? pack.files?.[index] : undefined;
    if (!file) missing("print pack file", `${parameter(request, "printPackId")}/${index}`);
    return sendStored(request, reply, storage, { storagePath: file.storagePath, hash: file.hash }, "print pack file", file.name);
  });
  app.get("/api/v1/files/layer-exports/:layerExportId", async (request, reply) => {
    const record = repository.getLayerExport(parameter(request, "layerExportId"));
    return sendStored(request, reply, storage, record?.psdStoragePath ? { storagePath: record.psdStoragePath } : undefined, "layer export", parameter(request, "layerExportId"));
  });
  app.get("/api/v1/files/layer-exports/:layerExportId/layers/:layerIndex", async (request, reply) => {
    const layerExportId = parameter(request, "layerExportId");
    const index = Number(parameter(request, "layerIndex"));
    const file = repository.getLayerExport(layerExportId)?.layerFiles?.[index];
    if (!file || !Number.isInteger(index) || index < 0) missing("layer file", `${layerExportId}#${parameter(request, "layerIndex")}`);
    return sendStored(request, reply, storage, { storagePath: file.storagePath, hash: file.hash }, "layer file", `${layerExportId}#${parameter(request, "layerIndex")}`);
  });
}
