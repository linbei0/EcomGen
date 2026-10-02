import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import type { AssetRecord, EditReferenceAssetRecord, EditSessionRecord, LocalAssetStore, ProjectRecord } from "@ecomgen/core";
import type { EcomRepository } from "@ecomgen/core";
import { requestFingerprint } from "@ecomgen/core";
import {
  EditGenerationConfigInput,
  MAX_GENERATION_REFERENCE_IMAGES,
  SelectEditSessionOutputInput,
  UpdateEditSessionMemoryInput,
} from "@ecomgen/contracts";
import type { AssetRole, ImageResolution, ReferencePurpose, ReferenceSelection } from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import {
  assertProjectAssetCapacity,
  assertProjectAssetHashUnique,
  clampCandidates,
  contentHash,
  ensureProject,
  missing,
  parseAssetRole,
  verifyModel,
} from "../helpers.js";
import { parseBody } from "../http-input.js";
import { enumValue, parameter, readJsonObject, readJsonTextArray, readObject, readOptionalText, readText, readTextArray } from "../input-normalizers.js";

function publicReferenceAsset(value: AssetRecord | EditReferenceAssetRecord): object {
  const temporary = "sessionId" in value;
  return { id: value.id, source: temporary ? "TEMPORARY" : "PROJECT", purpose: temporary ? value.purpose : defaultPurposeForRole(value.role), role: temporary ? null : value.role, originalName: value.originalName, mimeType: value.mimeType, hash: value.hash, createdAt: value.createdAt, expiresAt: temporary ? value.expiresAt : null, url: temporary ? `/files/edit-reference-assets/${value.id}` : `/files/assets/${value.id}` };
}

function defaultPurposeForRole(role: AssetRole): ReferencePurpose { return role === "PRODUCT_TRUTH" ? "PRODUCT_APPEARANCE" : role === "PACKAGING" ? "PACKAGING" : role === "STYLE_REFERENCE" ? "STYLE" : "LAYOUT"; }

function roleForReferencePurpose(purpose: ReferencePurpose): AssetRole { return purpose === "PRODUCT_APPEARANCE" ? "PRODUCT_TRUTH" : purpose === "PACKAGING" || purpose === "LABEL" ? "PACKAGING" : purpose === "STYLE" ? "STYLE_REFERENCE" : "LAYOUT_REFERENCE"; }

function editSessionDetails(repository: EcomRepository, session: EditSessionRecord): object {
  const editOutputs = repository.listEditOutputs(session.id);
  const rootIds = new Set(editOutputs.map((output) => output.rootOutputId).filter((id): id is string => Boolean(id)));
  const candidates = [...editOutputs, ...[...rootIds].map((id) => repository.getOutput(id)).filter((output): output is NonNullable<typeof output> => Boolean(output)), repository.getOutput(session.currentOutputId)].filter((output): output is NonNullable<typeof output> => Boolean(output)).filter((output, index, all) => all.findIndex((candidate) => candidate.id === output.id) === index);
  const current = repository.getOutput(session.currentOutputId);
  const byId = new Map(candidates.map((output) => [output.id, output]));
  const relatedIds = new Set<string>();
  let ancestor = current;
  while (ancestor) {
    relatedIds.add(ancestor.id);
    ancestor = ancestor.parentOutputId ? byId.get(ancestor.parentOutputId) : undefined;
  }
  const descendants = [current].filter((output): output is NonNullable<typeof output> => Boolean(output));
  while (descendants.length > 0) {
    const parent = descendants.shift();
    if (!parent) continue;
    for (const child of candidates) {
      if (child.parentOutputId !== parent.id || relatedIds.has(child.id)) continue;
      relatedIds.add(child.id);
      descendants.push(child);
    }
  }
  const versions = candidates.filter((output) => relatedIds.has(output.id)).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return { ...session, memorySummary: effectiveEditMemory(repository, session, session.currentOutputId), turns: repository.listEditTurns(session.id), versions };
}

function effectiveEditMemory(repository: EcomRepository, session: EditSessionRecord, outputId: string): { summary?: string; constraints?: string[]; sourceOutputId?: string } {
  const scopes = session.memorySummary.scopes ?? {};
  let current = repository.getOutput(outputId);
  while (current) {
    const scoped = scopes[current.id];
    if (scoped) return { ...scoped, sourceOutputId: current.id };
    current = current.parentOutputId ? repository.getOutput(current.parentOutputId) : undefined;
  }
  const output = repository.getOutput(outputId);
  return output && !output.parentOutputId
    ? { summary: session.memorySummary.summary, constraints: session.memorySummary.constraints, sourceOutputId: output.id }
    : {};
}

interface EditGenerationConfig { reasoningProviderId: string; reasoningModelId: string; imageProviderId: string; imageModelId: string; imageResolution: ImageResolution; candidateCount: number; }

function editGenerationConfigFor(repository: EcomRepository, project: ProjectRecord, annotations: Record<string, unknown>): EditGenerationConfig {
  const raw = annotations.generationConfig;
  if (raw === undefined) {
    // 无注解配置时沿用项目默认；Provider 被删除后引用已置空，这里显式拦截而不是把 null 传给任务
    if (!project.reasoningProviderId || !project.reasoningModelId || !project.imageProviderId || !project.imageModelId) {
      throw new ApiError(422, "PROVIDER_NOT_CONFIGURED", "请先在项目设置中选择推理与图片模型");
    }
    return { reasoningProviderId: project.reasoningProviderId, reasoningModelId: project.reasoningModelId, imageProviderId: project.imageProviderId, imageModelId: project.imageModelId, imageResolution: project.imageResolution, candidateCount: clampCandidates(project.candidatesPerType) };
  }
  const config = parseBody(EditGenerationConfigInput, raw, { pathPrefix: "annotations.generationConfig" });
  const reasoningProviderId = readText(config.reasoningProviderId, "annotations.generationConfig.reasoningProviderId");
  const reasoningModelId = readText(config.reasoningModelId, "annotations.generationConfig.reasoningModelId");
  const imageProviderId = readText(config.imageProviderId, "annotations.generationConfig.imageProviderId");
  const imageModelId = readText(config.imageModelId, "annotations.generationConfig.imageModelId");
  verifyModel(repository, reasoningProviderId, reasoningModelId, "reasoning");
  verifyModel(repository, imageProviderId, imageModelId, "image");
  return { reasoningProviderId, reasoningModelId, imageProviderId, imageModelId, imageResolution: config.imageResolution === undefined ? project.imageResolution : config.imageResolution, candidateCount: config.candidateCount === undefined ? clampCandidates(project.candidatesPerType) : config.candidateCount };
}

function parseReferenceSelections(value: string | undefined): ReferenceSelection[] {
  if (!value) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new ApiError(400, "VALIDATION_ERROR", "referenceSelections must be valid JSON"); }
  if (!Array.isArray(parsed)) throw new ApiError(400, "VALIDATION_ERROR", "referenceSelections must be an array");
  const purposes: ReferencePurpose[] = ["PRODUCT_APPEARANCE", "PACKAGING", "LABEL", "STYLE", "LAYOUT"];
  const seen = new Set<string>();
  const selections = parsed.map((item, index) => {
    const entry = readObject(item, `referenceSelections[${index}]`);
    const id = readText(entry.id, `referenceSelections[${index}].id`); const source = enumValue<"PROJECT" | "TEMPORARY">(entry.source, ["PROJECT", "TEMPORARY"], `referenceSelections[${index}].source`); const purpose = enumValue<ReferencePurpose>(entry.purpose, purposes, `referenceSelections[${index}].purpose`);
    if (seen.has(`${source}:${id}`)) throw new ApiError(400, "VALIDATION_ERROR", "referenceSelections cannot contain duplicates");
    seen.add(`${source}:${id}`); return { id, source, purpose, order: index };
  });
  return selections;
}

async function validateMaskDimensions(sourcePath: string, mask: Buffer, storage: LocalAssetStore): Promise<void> {
  const [source, candidate] = await Promise.all([sharp(await storage.read(sourcePath)).metadata(), sharp(mask).metadata()]);
  if (!source.width || !source.height || source.width !== candidate.width || source.height !== candidate.height) throw new ApiError(400, "VALIDATION_ERROR", "MASK_DIMENSION_MISMATCH");
}

export function registerEditSessionRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository, storage, events, enqueueOrMarkFailed } = ctx;
  app.post("/api/v1/projects/:projectId/outputs/:outputId/edit-sessions", async (request, reply) => {
    const projectId = parameter(request, "projectId"); const outputId = parameter(request, "outputId"); ensureProject(repository, projectId);
    const output = repository.getOutput(outputId); if (!output || output.projectId !== projectId) missing("output", outputId);
    const existing = repository.getActiveEditSession(projectId, outputId);
    if (existing) {
      const selected = existing.currentOutputId === outputId ? existing : repository.updateEditSession(existing.id, { currentOutputId: outputId });
      if (!selected) missing("edit session", existing.id);
      return reply.code(201).send(editSessionDetails(repository, selected));
    }
    return reply.code(201).send(editSessionDetails(repository, repository.createEditSession({ id: randomUUID(), projectId, currentOutputId: outputId, status: "ACTIVE", memorySummary: {} })));
  });
  app.get("/api/v1/edit-sessions/:sessionId", async (request) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    return editSessionDetails(repository, session);
  });
  app.get("/api/v1/edit-sessions/:sessionId/reference-assets", async (request) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    const projectAssets = repository.listAssets(session.projectId).map((asset) => publicReferenceAsset(asset));
    const nowIso = new Date().toISOString();
    const temporaryAssets = repository.listEditReferenceAssets(session.id).filter((asset) => asset.expiresAt > nowIso).map((asset) => publicReferenceAsset(asset));
    const previousTurn = repository.listEditTurns(session.id).at(-1);
    return { items: [...projectAssets, ...temporaryAssets], suggestedSelections: previousTurn?.referenceSelections ?? [] };
  });
  app.post("/api/v1/edit-sessions/:sessionId/reference-assets", async (request, reply) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    const parts = request.parts(); let file: { name: string; mimeType: string; content: Buffer } | undefined; let purpose: ReferencePurpose = "PRODUCT_APPEARANCE";
    for await (const part of parts) {
      if (part.type === "file") {
        if (part.fieldname !== "file" || !part.mimetype.startsWith("image/")) throw new ApiError(400, "VALIDATION_ERROR", "file must be an image");
        file = { name: part.filename, mimeType: part.mimetype, content: await part.toBuffer() };
      } else if (part.fieldname === "purpose") purpose = enumValue<ReferencePurpose>(part.value, ["PRODUCT_APPEARANCE", "PACKAGING", "LABEL", "STYLE", "LAYOUT"], "purpose");
    }
    if (!file) throw new ApiError(400, "VALIDATION_ERROR", "file is required");
    const hash = contentHash(file.content);
    assertProjectAssetHashUnique(repository, session.projectId, hash);
    if (repository.listEditReferenceAssets(session.id).some((asset) => asset.turnId === null && asset.expiresAt > new Date().toISOString() && asset.hash === hash)) {
      throw new ApiError(400, "VALIDATION_ERROR", "相同图片已作为本次编辑的临时参考素材上传");
    }
    const stored = await storage.putEditReferenceAsset(session.projectId, session.id, file.name, file.content);
    const record = repository.createEditReferenceAsset({ id: randomUUID(), projectId: session.projectId, sessionId: session.id, turnId: null, storagePath: stored.path, hash: stored.hash, originalName: file.name, mimeType: file.mimeType, purpose, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() });
    return reply.code(201).send(publicReferenceAsset(record));
  });
  app.delete("/api/v1/edit-sessions/:sessionId/reference-assets/:referenceAssetId", async (request, reply) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    const record = repository.getEditReferenceAsset(parameter(request, "referenceAssetId"));
    if (!record || record.sessionId !== session.id) missing("reference asset", parameter(request, "referenceAssetId"));
    if (record.turnId) throw new ApiError(409, "CONFLICT", "Reference asset is already used by an edit turn");
    repository.deleteEditReferenceAsset(record.id); await storage.delete(record.storagePath); return reply.code(204).send();
  });
  app.post("/api/v1/edit-sessions/:sessionId/reference-assets/:referenceAssetId/promote", async (request, reply) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    const temporary = repository.getEditReferenceAsset(parameter(request, "referenceAssetId"));
    if (!temporary || temporary.sessionId !== session.id) missing("reference asset", parameter(request, "referenceAssetId"));
    const role = roleForReferencePurpose(temporary.purpose); assertProjectAssetCapacity(repository, session.projectId, role);
    assertProjectAssetHashUnique(repository, session.projectId, temporary.hash);
    const content = await storage.read(temporary.storagePath); const stored = await storage.putAsset(session.projectId, temporary.originalName, content);
    const asset = repository.createAsset({ projectId: session.projectId, role, storagePath: stored.path, hash: stored.hash, originalName: temporary.originalName, mimeType: temporary.mimeType, width: null, height: null });
    repository.deleteEditReferenceAsset(temporary.id); await storage.delete(temporary.storagePath); return reply.code(201).send(publicReferenceAsset(asset));
  });
  app.patch("/api/v1/edit-sessions/:sessionId/memory", async (request) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    const body = parseBody(UpdateEditSessionMemoryInput, request.body);
    const outputId = body.outputId === undefined ? session.currentOutputId : readText(body.outputId, "outputId");
    const output = repository.getOutput(outputId);
    if (!output || output.projectId !== session.projectId || !repository.isOutputInEditSession(session.id, outputId)) throw new ApiError(400, "VALIDATION_ERROR", "outputId must belong to the edit session");
    const summary = readOptionalText(body.summary) ?? "";
    const constraints = body.constraints === undefined ? (session.memorySummary.scopes?.[outputId]?.constraints ?? session.memorySummary.constraints ?? []) : readTextArray(body.constraints, "constraints");
    const scopes = { ...(session.memorySummary.scopes ?? {}), [outputId]: { summary, constraints } };
    const updated = repository.updateEditSession(session.id, { memorySummary: { ...session.memorySummary, scopes } });
    if (!updated) missing("edit session", session.id);
    await events.publish(session.projectId, "edit-session.updated", { session: updated });
    return editSessionDetails(repository, updated);
  });
  app.post("/api/v1/edit-sessions/:sessionId/turns", async (request, reply) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    if (session.status !== "ACTIVE") throw new ApiError(409, "CONFLICT", "Edit session is not active");
    const parts = request.parts(); const fields = new Map<string, string>(); let editMask: { content: Buffer; mimeType: string } | undefined; let protectMask: { content: Buffer; mimeType: string } | undefined;
    for await (const part of parts) {
      if (part.type === "file") {
        if (part.fieldname !== "editMask" && part.fieldname !== "protectMask") throw new ApiError(400, "VALIDATION_ERROR", `Unsupported edit file field: ${part.fieldname}`);
        if (part.mimetype !== "image/png") throw new ApiError(400, "VALIDATION_ERROR", `${part.fieldname} must be a PNG image`);
        const value = { content: await part.toBuffer(), mimeType: part.mimetype };
        if (part.fieldname === "editMask") editMask = value; else protectMask = value;
      } else fields.set(part.fieldname, String(part.value));
    }
    const baseOutputId = fields.get("baseOutputId") ?? session.currentOutputId;
    const baseOutput = repository.getOutput(baseOutputId); if (!baseOutput || baseOutput.projectId !== session.projectId) throw new ApiError(400, "VALIDATION_ERROR", "baseOutputId must belong to this project");
    const message = fields.get("message")?.trim(); if (!message) throw new ApiError(400, "VALIDATION_ERROR", "message is required");
    const annotations = readJsonObject(fields.get("annotations"), "annotations");
    const legacyReferenceAssetIds = readJsonTextArray(fields.get("referenceAssetIds"), "referenceAssetIds");
    const submittedReferenceSelections = parseReferenceSelections(fields.get("referenceSelections"));
    const referenceSelections = submittedReferenceSelections.length > 0
      ? submittedReferenceSelections
      : legacyReferenceAssetIds.map((id, order) => ({ id, source: "PROJECT" as const, purpose: "PRODUCT_APPEARANCE" as const, order }));
    const referenceAssetIds = referenceSelections.filter((selection) => selection.source === "PROJECT").map((selection) => selection.id);
    const projectAssets = repository.listAssets(session.projectId); const knownAssets = new Set(projectAssets.map((asset) => asset.id));
    const temporary = repository.listEditReferenceAssets(session.id).filter((asset) => asset.expiresAt > new Date().toISOString()); const knownTemporary = new Set(temporary.map((asset) => asset.id));
    if (referenceSelections.some((selection) => selection.source === "PROJECT" ? !knownAssets.has(selection.id) : !knownTemporary.has(selection.id))) throw new ApiError(400, "VALIDATION_ERROR", "referenceSelections must belong to this project or edit session");
    const nonProductReferences = referenceSelections.filter((selection) => selection.source === "TEMPORARY" || projectAssets.find((asset) => asset.id === selection.id)?.role !== "PRODUCT_TRUTH");
    if (nonProductReferences.length > MAX_GENERATION_REFERENCE_IMAGES) throw new ApiError(400, "VALIDATION_ERROR", `单次编辑最多选择 ${MAX_GENERATION_REFERENCE_IMAGES} 张非商品参考图`);
    if (editMask) await validateMaskDimensions(baseOutput.storagePath, editMask.content, storage);
    if (protectMask) await validateMaskDimensions(baseOutput.storagePath, protectMask.content, storage);
    const turnId = randomUUID();
    const editStored = editMask ? await storage.putEditArtifact(session.projectId, session.id, turnId, "edit-mask.png", editMask.content) : undefined;
    const protectStored = protectMask ? await storage.putEditArtifact(session.projectId, session.id, turnId, "protect-mask.png", protectMask.content) : undefined;
    const fingerprint = requestFingerprint({ type: "EDIT_PLAN", projectId: session.projectId, sessionId: session.id, baseOutputId, message, annotations, editMaskHash: editStored?.hash ?? null, protectMaskHash: protectStored?.hash ?? null, referenceSelections, idempotencyKey: request.headers["idempotency-key"] ?? null });
    const existing = repository.findJobByFingerprint(session.projectId, fingerprint); if (existing) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send({ turnId: existing.input.editTurnId, planJobId: existing.id, status: existing.status });
    const project = repository.getProject(session.projectId); if (!project) missing("project", session.projectId);
    const generationConfig = editGenerationConfigFor(repository, project, annotations);
    const turn = repository.createEditTurn({ id: turnId, sessionId: session.id, projectId: session.projectId, baseOutputId, status: "PLANNING", message, annotations, editMaskPath: editStored?.path ?? null, editMaskHash: editStored?.hash ?? null, protectMaskPath: protectStored?.path ?? null, protectMaskHash: protectStored?.hash ?? null, referenceAssetIds, referenceSelections, plan: null, error: null });
    repository.attachEditReferenceAssets(session.id, turn.id, referenceSelections.filter((selection) => selection.source === "TEMPORARY").map((selection) => selection.id));
    const job = repository.createJob({ id: randomUUID(), projectId: session.projectId, storyboardItemId: null, type: "EDIT_PLAN", input: { editTurnId: turn.id }, requestFingerprint: fingerprint, providerId: generationConfig.reasoningProviderId, modelId: generationConfig.reasoningModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueueOrMarkFailed(job, "edit_plan"); return reply.code(202).send({ turnId: turn.id, planJobId: job.id, status: turn.status });
  });
  app.get("/api/v1/edit-turns/:turnId", async (request) => { const turn = repository.getEditTurn(parameter(request, "turnId")); if (!turn) missing("edit turn", parameter(request, "turnId")); return turn; });
  app.post("/api/v1/edit-turns/:turnId/approve", async (request, reply) => {
    const turn = repository.getEditTurn(parameter(request, "turnId")); if (!turn) missing("edit turn", parameter(request, "turnId"));
    if (turn.status !== "AWAITING_CONFIRMATION" && turn.status !== "PLAN_READY") throw new ApiError(409, "CONFLICT", "Edit turn is not ready for generation");
    const project = repository.getProject(turn.projectId); if (!project) missing("project", turn.projectId);
    const generationConfig = editGenerationConfigFor(repository, project, turn.annotations);
    const fingerprint = requestFingerprint({ type: "EDIT_GENERATE", projectId: turn.projectId, editTurnId: turn.id, plan: turn.plan });
    const existing = repository.findJobByFingerprint(turn.projectId, fingerprint); if (existing) return reply.code(existing.status === "SUCCEEDED" ? 200 : 202).send({ job: existing, turn: repository.getEditTurn(turn.id) });
    repository.updateEditTurn(turn.id, { status: "GENERATING", error: null });
    const job = repository.createJob({ id: randomUUID(), projectId: turn.projectId, storyboardItemId: null, type: "EDIT_GENERATE", input: { editTurnId: turn.id }, requestFingerprint: fingerprint, providerId: generationConfig.imageProviderId, modelId: generationConfig.imageModelId, estimatedCost: { status: "UNKNOWN", unit: "provider-defined" } });
    await enqueueOrMarkFailed(job, "edit_generate"); return reply.code(202).send({ job, turn: repository.getEditTurn(turn.id) });
  });
  app.post("/api/v1/edit-sessions/:sessionId/select-output", async (request) => {
    const session = repository.getEditSession(parameter(request, "sessionId")); if (!session) missing("edit session", parameter(request, "sessionId"));
    const body = parseBody(SelectEditSessionOutputInput, request.body); const outputId = readText(body.outputId, "outputId"); const output = repository.getOutput(outputId); if (!output || output.projectId !== session.projectId) throw new ApiError(400, "VALIDATION_ERROR", "outputId must belong to this project");
    if (!repository.isOutputInEditSession(session.id, output.id)) throw new ApiError(400, "VALIDATION_ERROR", "outputId is not part of this edit session");
    const updated = repository.updateEditSession(session.id, { currentOutputId: outputId });
    if (!updated) missing("edit session", session.id);
    await events.publish(session.projectId, "edit-session.updated", { session: updated });
    return editSessionDetails(repository, updated);
  });
}
