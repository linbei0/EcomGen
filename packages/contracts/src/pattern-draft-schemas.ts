import { Type, type Static } from "@sinclair/typebox";
import { ImageAspectRatio } from "./enums.js";
import { stringEnumSchema } from "./enums.js";
import { schemaRef } from "./ref.js";
import {
  DRAFT_SEAM_BAND_MAX,
  MAX_DRAFT_INSTRUCTION_LENGTH,
  MAX_PATTERN_BRIEF_LENGTH,
  MAX_PATTERN_DRAFT_NAME_LENGTH,
  PATTERN_DRAFT_CANDIDATES_MAX,
  PATTERN_DRAFT_REFERENCES_MAX,
} from "./limits.js";
import { Pattern, TileableStatus } from "./pod-schemas.js";
import { PodRepeatLayout } from "./pod-repeat.js";

/**
 * AI 起稿工作台契约：创作草稿、参考媒体、批次/槽位与创作候选。
 *
 * 与正式花型（patterns）严格分离：候选只有经过显式定稿才会成为 Pattern。
 * 这些 schema 只描述草稿域自身的状态，不承载生产规格包或文案流水线。
 */

/** 创作目标：单幅印花或连续花型；决定预览/验收内容，不表示接缝已合格。 */
export const DRAFT_COMPOSE_TYPES = ["PLACEMENT", "REPEAT"] as const;
export const DraftComposeType = stringEnumSchema(DRAFT_COMPOSE_TYPES, "#/components/schemas/DraftComposeType");
export type DraftComposeType = Static<typeof DraftComposeType>;

/** 草稿媒体的角色：编辑参考或已绘制选区蒙版；蒙版与参考坐标语义不同，必须分开。 */
export const DRAFT_MEDIA_ROLES = ["REFERENCE", "MASK"] as const;
export const DraftMediaRole = stringEnumSchema(DRAFT_MEDIA_ROLES, "#/components/schemas/DraftMediaRole");
export type DraftMediaRole = Static<typeof DraftMediaRole>;

/** 参考来源：本地上传或从正式花型库拷贝快照。 */
export const DRAFT_MEDIA_SOURCES = ["UPLOAD", "PATTERN"] as const;
export const DraftMediaSource = stringEnumSchema(DRAFT_MEDIA_SOURCES, "#/components/schemas/DraftMediaSource");
export type DraftMediaSource = Static<typeof DraftMediaSource>;

/** 起稿底色：只允许白底或透明底；连续花型的透明底仍需真实 alpha 校验。 */
export const DRAFT_BACKGROUNDS = ["WHITE", "TRANSPARENT"] as const;
export const DraftBackground = stringEnumSchema(DRAFT_BACKGROUNDS, "#/components/schemas/DraftBackground");
export type DraftBackground = Static<typeof DraftBackground>;

/**
 * 批次操作类型：一次提交对应一种操作。
 * GENERATE 从条件与参考生成；EDIT_* 基于父候选产生新候选；RECOLOR 为本地确定性处理；
 * CUTOUT 走分割产生真实 alpha；SEAM_EDIT 为定向接缝改稿（成对边合并为跨边选区）。
 */
export const DRAFT_BATCH_OPERATIONS = ["GENERATE", "EDIT_WHOLE", "EDIT_LOCAL", "RECOLOR", "PALETTE_VARIANT", "CUTOUT", "SEAM_EDIT"] as const;
export const DraftBatchOperation = stringEnumSchema(DRAFT_BATCH_OPERATIONS, "#/components/schemas/DraftBatchOperation");
export type DraftBatchOperation = Static<typeof DraftBatchOperation>;

/** 槽位状态：批次的展示由槽位聚合，不引入含混的全局 PARTIAL 状态。 */
export const DRAFT_SLOT_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export const DraftSlotStatus = stringEnumSchema(DRAFT_SLOT_STATUSES, "#/components/schemas/DraftSlotStatus");
export type DraftSlotStatus = Static<typeof DraftSlotStatus>;

/** 接缝改稿的目标边：左右成对、上下成对；角点由两条边共同覆盖。 */
export const DRAFT_SEAM_EDGES = ["LEFT_RIGHT", "TOP_BOTTOM"] as const;
export const DraftSeamEdge = stringEnumSchema(DRAFT_SEAM_EDGES, "#/components/schemas/DraftSeamEdge");
export type DraftSeamEdge = Static<typeof DraftSeamEdge>;

/** 本地整体调色参数；HSL 调制为确定性运算，不承诺精确色值。 */
export const DraftRecolorParams = Type.Object({
  hueShift: Type.Number({ minimum: -180, maximum: 180, default: 0 }),
  saturationPct: Type.Number({ minimum: 0, maximum: 300, default: 100 }),
  brightnessPct: Type.Number({ minimum: 10, maximum: 400, default: 100 }),
}, { $id: "#/components/schemas/DraftRecolorParams" });
export type DraftRecolorParams = Static<typeof DraftRecolorParams>;

/** 接缝改稿参数：band 为跨边选区带宽（像素），成对边同时改。 */
export const DraftSeamEdit = Type.Object({
  edge: schemaRef(DraftSeamEdge),
  band: Type.Integer({ minimum: 4, maximum: DRAFT_SEAM_BAND_MAX, default: 48 }),
}, { $id: "#/components/schemas/DraftSeamEdit" });
export type DraftSeamEdit = Static<typeof DraftSeamEdit>;

/** 草稿创作条件；由服务端按 revision 自动保存，提交批次时整体拷入不可变快照。 */
export const DraftConditions = Type.Object({
  theme: Type.String({ maxLength: MAX_PATTERN_BRIEF_LENGTH, default: "" }),
  aspectRatio: schemaRef(ImageAspectRatio),
  background: schemaRef(DraftBackground),
  candidateCount: Type.Integer({ minimum: 1, maximum: PATTERN_DRAFT_CANDIDATES_MAX, default: 1 }),
  providerId: Type.Optional(Type.String({ format: "uuid" })),
  imageModelId: Type.Optional(Type.String({ minLength: 1 })),
  repeatLayout: Type.Optional(schemaRef(PodRepeatLayout)),
}, { $id: "#/components/schemas/DraftConditions" });
export type DraftConditions = Static<typeof DraftConditions>;

export const PatternDraft = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String(),
  composeType: schemaRef(DraftComposeType),
  conditions: schemaRef(DraftConditions),
  revision: Type.Integer(),
  selectedCandidateId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  compareCandidateId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  archivedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  // 列表卡片用的派生视图：候选总数与最近一张候选的缩略图地址。服务端聚合，避免前端逐草稿再拉候选。
  // 卡片只需要小图；要看原图走候选自身的 url。
  candidateCount: Type.Integer({ default: 0 }),
  previewUrl: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
}, { $id: "#/components/schemas/PatternDraft" });
export type PatternDraft = Static<typeof PatternDraft>;

export const PatternDraftList = Type.Object({ items: Type.Array(schemaRef(PatternDraft)) }, { $id: "#/components/schemas/PatternDraftList" });
export type PatternDraftList = Static<typeof PatternDraftList>;

export const CreatePatternDraftInput = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PATTERN_DRAFT_NAME_LENGTH })),
  composeType: Type.Optional(schemaRef(DraftComposeType)),
}, { $id: "#/components/schemas/CreatePatternDraftInput" });
export type CreatePatternDraftInput = Static<typeof CreatePatternDraftInput>;

export const UpdatePatternDraftInput = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PATTERN_DRAFT_NAME_LENGTH })),
  conditions: Type.Optional(schemaRef(DraftConditions)),
  selectedCandidateId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()])),
  compareCandidateId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()])),
  archived: Type.Optional(Type.Boolean()),
}, { $id: "#/components/schemas/UpdatePatternDraftInput" });
export type UpdatePatternDraftInput = Static<typeof UpdatePatternDraftInput>;

export const DraftMedia = Type.Object({
  id: Type.String({ format: "uuid" }),
  draftId: Type.String({ format: "uuid" }),
  role: schemaRef(DraftMediaRole),
  source: schemaRef(DraftMediaSource),
  sourcePatternId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  /**
   * 引用编号：上传时分配、只升不降，删除参考图不回填，所以编号可能出现空档。
   * 输入框里的 `@图N` 指的就是它；蒙版不参与引用，编号为 null。
   */
  ordinal: Type.Union([Type.Integer(), Type.Null()]),
  url: Type.String(),
  /** 按内容 hash 寻址的缩略图；参考图轨与候选轨只加载它，不拉全分辨率原图。 */
  thumbUrl: Type.String(),
  fileName: Type.String(),
  mimeType: Type.String(),
  width: Type.Union([Type.Integer(), Type.Null()]),
  height: Type.Union([Type.Integer(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }),
}, { $id: "#/components/schemas/DraftMedia" });
export type DraftMedia = Static<typeof DraftMedia>;

export const DraftMediaList = Type.Object({ items: Type.Array(schemaRef(DraftMedia)) }, { $id: "#/components/schemas/DraftMediaList" });
export type DraftMediaList = Static<typeof DraftMediaList>;

/** 候选的确定性验缝结果；逐轴分数指出是哪条边接不上，算法版本不同即视为过期需重算。 */
export const DraftCandidateTileable = Type.Object({
  status: schemaRef(TileableStatus),
  score: Type.Union([Type.Number(), Type.Null()]),
  algorithmVersion: Type.Union([Type.String(), Type.Null()]),
  horizontal: Type.Union([Type.Number(), Type.Null()]),
  vertical: Type.Union([Type.Number(), Type.Null()]),
}, { $id: "#/components/schemas/DraftCandidateTileable" });
export type DraftCandidateTileable = Static<typeof DraftCandidateTileable>;

export const DraftCandidate = Type.Object({
  id: Type.String({ format: "uuid" }),
  draftId: Type.String({ format: "uuid" }),
  batchId: Type.String({ format: "uuid" }),
  slotIndex: Type.Integer(),
  parentCandidateId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  url: Type.String(),
  /** 按内容 hash 寻址的缩略图；候选轨只加载它，舞台才用 url 取原图。 */
  thumbUrl: Type.String(),
  width: Type.Union([Type.Integer(), Type.Null()]),
  height: Type.Union([Type.Integer(), Type.Null()]),
  mimeType: Type.String(),
  transform: schemaRef(DraftBatchOperation),
  hasAlpha: Type.Boolean(),
  tileable: schemaRef(DraftCandidateTileable),
  createdAt: Type.String({ format: "date-time" }),
}, { $id: "#/components/schemas/DraftCandidate" });
export type DraftCandidate = Static<typeof DraftCandidate>;

export const DraftCandidateList = Type.Object({ items: Type.Array(schemaRef(DraftCandidate)) }, { $id: "#/components/schemas/DraftCandidateList" });
export type DraftCandidateList = Static<typeof DraftCandidateList>;

export const DraftSlot = Type.Object({
  index: Type.Integer(),
  status: schemaRef(DraftSlotStatus),
  attempt: Type.Integer(),
  jobId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  candidateId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  error: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  updatedAt: Type.String({ format: "date-time" }),
}, { $id: "#/components/schemas/DraftSlot" });
export type DraftSlot = Static<typeof DraftSlot>;

export const DraftBatch = Type.Object({
  id: Type.String({ format: "uuid" }),
  draftId: Type.String({ format: "uuid" }),
  operation: schemaRef(DraftBatchOperation),
  parentCandidateId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  providerId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  imageModelId: Type.Union([Type.String(), Type.Null()]),
  candidateCount: Type.Integer(),
  instruction: Type.Union([Type.String(), Type.Null()]),
  estimatedCost: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  actualCost: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  snapshot: Type.Record(Type.String(), Type.Unknown()),
  createdAt: Type.String({ format: "date-time" }),
  slots: Type.Array(schemaRef(DraftSlot)),
}, { $id: "#/components/schemas/DraftBatch" });
export type DraftBatch = Static<typeof DraftBatch>;

export const DraftBatchList = Type.Object({ items: Type.Array(schemaRef(DraftBatch)) }, { $id: "#/components/schemas/DraftBatchList" });
export type DraftBatchList = Static<typeof DraftBatchList>;

/**
 * 提交批次：把当前表单完整快照 + 参考用途一并下发。
 * 生成/生成式改稿需要 providerId + imageModelId；RECOLOR 等本地处理可省略模型。
 */
export const CreateDraftBatchInput = Type.Object({
  clientKey: Type.String({ minLength: 1, maxLength: 120 }),
  operation: schemaRef(DraftBatchOperation),
  candidateCount: Type.Integer({ minimum: 1, maximum: PATTERN_DRAFT_CANDIDATES_MAX, default: 1 }),
  providerId: Type.Optional(Type.String({ format: "uuid" })),
  imageModelId: Type.Optional(Type.String({ minLength: 1 })),
  theme: Type.Optional(Type.String({ maxLength: MAX_PATTERN_BRIEF_LENGTH })),
  aspectRatio: Type.Optional(schemaRef(ImageAspectRatio)),
  background: Type.Optional(schemaRef(DraftBackground)),
  repeatLayout: Type.Optional(schemaRef(PodRepeatLayout)),
  // 参考图只按媒体 id 声明：上传即参与，不再要求调用方先给用途分类。
  references: Type.Optional(Type.Array(Type.String({ format: "uuid" }), { maxItems: PATTERN_DRAFT_REFERENCES_MAX })),
  parentCandidateId: Type.Optional(Type.String({ format: "uuid" })),
  instruction: Type.Optional(Type.String({ maxLength: MAX_DRAFT_INSTRUCTION_LENGTH })),
  maskMediaId: Type.Optional(Type.String({ format: "uuid" })),
  invertMask: Type.Optional(Type.Boolean()),
  recolor: Type.Optional(schemaRef(DraftRecolorParams)),
  palette: Type.Optional(Type.Array(Type.String({ minLength: 4, maxLength: 9 }), { maxItems: 8 })),
  seam: Type.Optional(schemaRef(DraftSeamEdit)),
}, { $id: "#/components/schemas/CreateDraftBatchInput" });
export type CreateDraftBatchInput = Static<typeof CreateDraftBatchInput>;

export const DraftJobRef = Type.Object({
  id: Type.String({ format: "uuid" }),
  type: Type.String(),
  status: Type.String(),
  progress: Type.Integer(),
}, { $id: "#/components/schemas/DraftJobRef" });
export type DraftJobRef = Static<typeof DraftJobRef>;

export const CreateDraftBatchResponse = Type.Object({
  batch: schemaRef(DraftBatch),
  job: Type.Union([schemaRef(DraftJobRef), Type.Null()]),
  reused: Type.Boolean(),
}, { $id: "#/components/schemas/CreateDraftBatchResponse" });
export type CreateDraftBatchResponse = Static<typeof CreateDraftBatchResponse>;

export const RetryDraftBatchResponse = Type.Object({
  batch: schemaRef(DraftBatch),
  job: schemaRef(DraftJobRef),
  reused: Type.Boolean(),
}, { $id: "#/components/schemas/RetryDraftBatchResponse" });
export type RetryDraftBatchResponse = Static<typeof RetryDraftBatchResponse>;

export const FinalizeDraftCandidateInput = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PATTERN_DRAFT_NAME_LENGTH })),
  clientKey: Type.String({ minLength: 1, maxLength: 120 }),
}, { $id: "#/components/schemas/FinalizeDraftCandidateInput" });
export type FinalizeDraftCandidateInput = Static<typeof FinalizeDraftCandidateInput>;

export const FinalizeDraftCandidateResponse = Type.Object({
  pattern: schemaRef(Pattern),
  reused: Type.Boolean(),
}, { $id: "#/components/schemas/FinalizeDraftCandidateResponse" });
export type FinalizeDraftCandidateResponse = Static<typeof FinalizeDraftCandidateResponse>;
