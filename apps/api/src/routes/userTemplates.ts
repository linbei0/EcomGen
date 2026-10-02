import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { UserTemplateRecord } from "@ecomgen/core";
import { CreateUserTemplateInput, UpdateUserTemplateInput } from "@ecomgen/contracts";
import type { ApiContext } from "../context.js";
import { ApiError } from "../errors.js";
import { missing } from "../helpers.js";
import { parseBody } from "../http-input.js";
import { enumValue, parameter, readBoolean, readText } from "../input-normalizers.js";

function publicUserTemplate(value: UserTemplateRecord): object { return { ...value }; }

export function registerUserTemplateRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { repository } = ctx;
  app.get("/api/v1/user-templates", async () => ({ items: repository.listUserTemplates().map(publicUserTemplate), nextCursor: null }));
  app.post("/api/v1/user-templates", async (request, reply) => {
    const body = parseBody(CreateUserTemplateInput, request.body);
    // custom- 前缀与内置 ID 空间隔离；8 位 hex 撞库概率可忽略，仍做一次冲突重试保证唯一
    let id = `custom-${randomBytes(4).toString("hex")}`;
    if (repository.getUserTemplate(id)) id = `custom-${randomBytes(4).toString("hex")}`;
    const record = repository.saveUserTemplate({
      id,
      name: readText(body.name, "name"),
      prompt: readText(body.prompt, "prompt"),
      defaultSize: body.defaultSize === undefined ? "1024x1024" : enumValue(body.defaultSize, ["1024x1024", "1024x1536"], "defaultSize"),
      supportsImageReference: body.supportsImageReference === undefined ? true : readBoolean(body.supportsImageReference, "supportsImageReference")
    });
    return reply.code(201).send(publicUserTemplate(record));
  });
  app.patch("/api/v1/user-templates/:templateId", async (request) => {
    const id = parameter(request, "templateId"); const current = repository.getUserTemplate(id); if (!current) missing("user template", id);
    const body = parseBody(UpdateUserTemplateInput, request.body);
    const record = repository.saveUserTemplate({
      id,
      name: body.name === undefined ? current.name : readText(body.name, "name"),
      prompt: body.prompt === undefined ? current.prompt : readText(body.prompt, "prompt"),
      defaultSize: body.defaultSize === undefined ? current.defaultSize : enumValue(body.defaultSize, ["1024x1024", "1024x1536"], "defaultSize"),
      supportsImageReference: body.supportsImageReference === undefined ? current.supportsImageReference : readBoolean(body.supportsImageReference, "supportsImageReference")
    });
    return publicUserTemplate(record);
  });
  app.delete("/api/v1/user-templates/:templateId", async (request, reply) => {
    const id = parameter(request, "templateId"); if (!repository.getUserTemplate(id)) missing("user template", id);
    // 模板是规划期资产：允许删除，引用它的旧分镜在生成期显式报错（见 worker 模板解析），不做静默降级
    repository.deleteUserTemplate(id);
    return reply.code(204).send();
  });
}
