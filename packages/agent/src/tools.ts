import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { PlatformTarget } from "@ecomgen/contracts";
import { getTemplate, templateGuidance } from "@ecomgen/ecom-skill";

const readTemplateParameters = Type.Object({
  templateId: Type.String({ minLength: 1 }),
  variant: Type.Optional(Type.String()),
  category: Type.Optional(Type.String())
});
type ReadTemplateParameters = Static<typeof readTemplateParameters>;

const readPlatformParameters = Type.Object({
  targets: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })
});
type ReadPlatformParameters = Static<typeof readPlatformParameters>;

function textResult<T>(details: T): AgentToolResult<T> {
  return { content: [{ type: "text", text: JSON.stringify(details) }], details };
}

/** Pi 只能通过这些只读业务工具读取电商规范，不开放文件、Shell 或网络工具。 */
export function createPlanningTools(platformTargets: readonly PlatformTarget[]): AgentTool[] {
  const readTemplate: AgentTool<typeof readTemplateParameters> = {
    name: "read_ecom_template",
    label: "读取电商图片规范",
    description: "按模板 ID 读取一份电商图片规范。返回的是供 Agent 组织最终生图 Prompt 的结构化视觉约束，不要把字段名、模板编号或内部元数据原样写入最终 Prompt。",
    parameters: readTemplateParameters,
    execute: async (_toolCallId: string, params: ReadTemplateParameters): Promise<AgentToolResult<unknown>> => {
      const template = getTemplate(params.templateId);
      if (!template) throw new Error(`Unknown ecom-details-image template: ${params.templateId}`);
      if (params.variant && !template.variants[params.variant]) throw new Error(`Unknown template variant: ${params.variant}`);
      return textResult({
        id: template.id,
        name: template.name,
        variant: params.variant ?? null,
        guidance: templateGuidance(template, platformTargets, params.variant, params.category),
        variants: Object.fromEntries(Object.entries(template.variants).map(([key, value]) => [key, value.description])),
        supportsImageReference: template.supports_image_reference
      });
    }
  };

  const readPlatform: AgentTool<typeof readPlatformParameters> = {
    name: "read_platform_guidance",
    label: "读取目标平台规范",
    description: "读取目标市场与平台的版式、文字和合规约束。只返回业务规则，最终 Prompt 必须把它们改写成生图模型能直接执行的自然语言。",
    parameters: readPlatformParameters,
    execute: async (_toolCallId: string, params: ReadPlatformParameters): Promise<AgentToolResult<unknown>> => {
      const unknown = params.targets.filter((target) => target !== "DOMESTIC" && target !== "AMAZON");
      if (unknown.length) throw new Error(`Unknown platform targets: ${unknown.join(", ")}`);
      const guidance = params.targets.map((target) => target === "DOMESTIC"
        ? { target, market: "中国大陆电商", rules: ["优先适配中文电商首图与详情页视觉", "如项目需要营销叠加，预留顶部居中的价格区和左上角 Logo 区，但不要让生图模型生成文字、价格或 Logo"] }
        : { target, market: "Amazon 等国际电商", rules: ["优先保持主体清晰、背景克制、产品占比稳定", "避免未经提供的认证、参数、品牌承诺和可读促销文字"] });
      return textResult({ targets: guidance });
    }
  };

  return [readTemplate, readPlatform];
}
