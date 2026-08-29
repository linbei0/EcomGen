import { Type, type Static } from "@sinclair/typebox";

export const EventEnvelope = Type.Object({ id: Type.String({ format: "uuid" }), type: Type.Union([Type.Literal("job.updated"), Type.Literal("storyboard.updated"), Type.Literal("output.created"), Type.Literal("edit-session.updated"), Type.Literal("edit-turn.updated"), Type.Literal("export.updated"), Type.Literal("provider.updated")]), projectId: Type.String({ format: "uuid" }), occurredAt: Type.String({ format: "date-time" }), data: Type.Unknown() }, { $id: "#/components/schemas/EventEnvelope" });
export type EventEnvelope = Static<typeof EventEnvelope>;
export const ModelCapabilities = Type.Object({ supportsVision: Type.Boolean(), supportsThinking: Type.Boolean(), supportsTools: Type.Boolean(), supportsStructuredOutput: Type.Boolean(), imageApiKind: Type.Union([Type.Literal("openai_images"), Type.Literal("gemini"), Type.Literal("custom"), Type.Null()]) }, { $id: "#/components/schemas/ModelCapabilities" });
export type ModelCapabilities = Static<typeof ModelCapabilities>;
export const ModelDefinition = Type.Intersect([Type.Object({ id: Type.String({ minLength: 1 }) }), ModelCapabilities], { $id: "#/components/schemas/ModelDefinition" });
export type ModelDefinition = Static<typeof ModelDefinition>;
