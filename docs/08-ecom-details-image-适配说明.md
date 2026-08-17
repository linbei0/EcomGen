# ecom-details-image 适配说明

## 上游固定来源

本项目已将上游核心规则与 25 个 JSON 模板内置到 `packages/ecom-skill/`，固定来源 commit 为 `1ec867b743179af3598db55388f65287c4e04de1`。追溯记录见 [UPSTREAM.md](../packages/ecom-skill/UPSTREAM.md)。

该 commit 的核心由 `.claude/skills/ecom-details-image/SKILL.md` 与 `references/templates/` 下 25 个 JSON 模板共同组成。运行时直接读取 JSON 的 `prompt_template`、`defaults`、`variants`、`category_tips`、`examples`、`anti_ai_tips` 与参考图支持标记。

## 本项目的改造方式

[packages/ecom-skill](../packages/ecom-skill/src/catalog.ts) 是对上游 Skill 的结构化、后端可执行适配，并不是重新发明一套视觉规则：

- 直接读取上游 01-25 模板编号、名称、关键词、触发词、Prompt 字段、变体与品类提示。
- 将模板转为稳定的 `templateId`，例如 `hero-image`、`detail-macro`、`infographic`、`livestream`。
- 将上游的产品占比、留白、镜头语言、国内平台价格/Logo 预留区、UGC 反 AI 约束转为模板 Prompt Contract。
- 保留 Campaign Style Lock、转化驱动力和像素保护的上游规则，并与本项目的 SKU scope 和事实约束结合。

## 运行时路径

1. 前端请求 `GET /api/v1/ecom-templates`，取得上游来源信息与可选模板。
2. 用户选择模板后，以 `requestedTypes` 传入 `POST /projects/{projectId}/planning-jobs`。
3. Pi Planner 只可从这些上游模板 ID 生成分镜；未知模板或越权模板会被校验拒绝。
4. Worker 按分镜的模板调用 `templatePromptContract`，将原始规则加入最终 Prompt，并使用模板指定的正方形或详情页竖图画幅。

## 与上游的差异

上游面向命令行 Agent 和本地 Python 脚本；本项目面向 Web 前后端分离、SQLite、Redis 队列和可恢复任务。因此不直接执行其 Python 脚本，也不读取其 `.env`。用户的 OpenAI 兼容 API Key 经本项目 Provider 接口加密保存，所有生图都在 Worker 内执行并有任务记录。

上游的“优惠、物流、保障、功效”类示例在本项目被收紧：没有用户输入的可核验事实时，只允许生成占位符或视觉构图，不能编造成图片文字或事实主张。
