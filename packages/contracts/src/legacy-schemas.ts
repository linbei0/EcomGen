import { Type, type Static } from "@sinclair/typebox";

import { SEGMENTATION_PROTOCOLS } from "./segmentation.js";

export const EventEnvelope = Type.Object({ id: Type.String({ format: "uuid" }), type: Type.Union([Type.Literal("job.updated"), Type.Literal("storyboard.updated"), Type.Literal("output.created"), Type.Literal("edit-session.updated"), Type.Literal("edit-turn.updated"), Type.Literal("export.updated"), Type.Literal("provider.updated"), Type.Literal("layer-plan.updated"), Type.Literal("layer-export.updated")]), projectId: Type.String({ format: "uuid" }), occurredAt: Type.String({ format: "date-time" }), data: Type.Unknown() }, { $id: "#/components/schemas/EventEnvelope" });
export type EventEnvelope = Static<typeof EventEnvelope>;
// imageApiKind 与 segmentationProtocol 互斥：都不设为推理模型，设 imageApiKind 为生图模型，
// 设 segmentationProtocol 为分割模型（枚举与 SegmentationModelRef.protocol 同源，见 segmentation.ts 注册表）。
export const ModelCapabilities = Type.Object({ supportsVision: Type.Boolean(), supportsThinking: Type.Boolean(), supportsTools: Type.Boolean(), supportsStructuredOutput: Type.Boolean(), imageApiKind: Type.Union([Type.Literal("openai_images"), Type.Literal("gemini"), Type.Literal("custom"), Type.Null()]), segmentationProtocol: Type.Optional(Type.Union(SEGMENTATION_PROTOCOLS.map((protocol) => Type.Literal(protocol)), { description: "Segmentation API protocol declared for this model; mutually exclusive with imageApiKind." })) }, { $id: "#/components/schemas/ModelCapabilities" });
export type ModelCapabilities = Static<typeof ModelCapabilities>;
export const ModelDefinition = Type.Intersect([Type.Object({ id: Type.String({ minLength: 1 }) }), ModelCapabilities], { $id: "#/components/schemas/ModelDefinition" });
export type ModelDefinition = Static<typeof ModelDefinition>;
