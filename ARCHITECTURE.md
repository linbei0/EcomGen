# 运行时架构与不变量

本文档描述已经落地到代码中的运行时约定。它不是产品规划稿；新增功能时，应先检查本文档和对应模块代码，再决定是否需要修改契约。

## 一句话模型

Pi Agent 把项目事实和电商规范转换成一份可以直接交给生图模型的最终 Prompt，Worker 只检查执行条件并原样发送这份 Prompt。

```mermaid
flowchart LR
  A[项目事实与素材] --> B[API 校验并创建规划任务]
  B --> C[Worker 调用 Pi Agent]
  C --> D[读取电商模板与平台规范工具]
  D --> E[最终生图 Prompt]
  E --> F[分镜 promptInstruction]
  F --> G[用户编辑并确认]
  G --> H[Worker 资源/状态/参数检查]
  H --> I[Provider 原样接收 Prompt]
  I --> J[compiledPrompt 与实际请求一致]
```

## 模块职责

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| `apps/api` | HTTP 校验、SQLite 持久化、请求指纹、入队 | 调用推理模型或生图模型 |
| `packages/agent` | Pi Agent、只读业务工具、受控视觉研究、规划输出校验、Prompt 改写 | 访问文件、Shell、浏览器、任意 URL 抓取；直接保存数据库 |
| `packages/ecom-skill` | 固定来源的模板目录和结构化视觉规范 | 运行模型调用；向生图 Provider 发送请求 |
| `apps/worker` | BullMQ 消费、取消检查、资源/状态检查、尺寸计算、Provider 调用、导出 | 把模板字符串、Campaign Style Lock 或隐含规则追加到 Prompt |
| `packages/providers` | Provider 配置、能力声明和 OpenAI-compatible 适配 | 修改业务 Prompt 语义 |
| `packages/core` | SQLite、文件存储、密钥加密和领域状态 | 了解具体模型 Prompt 规则 |

## Prompt 生命周期

### 规划阶段

`packages/agent/src/planner.ts` 创建 Pi `Agent`，只注入 `packages/agent/src/tools.ts` 中的业务工具：

- `read_ecom_template`：按稳定模板 ID 返回结构化的构图、镜头、占比、留白、平台预留区和反幻觉规则。
- `read_platform_guidance`：返回当前选中平台的构图/文字/推流规则，以及商品品类对应的模板偏好；市场只定文案语种，不定场景。
- `research_visual_direction`：仅在配置搜索 API Key 时启用，检索近期视觉趋势与版式灵感；不打开网页、不下载图片，结果不能升级为商品事实。

工具返回的是给 Agent 使用的知识，不是要原样发送给生图模型的 Prompt。外部搜索结果始终按不可信内容处理；最终 Prompt 必须由 Agent 改写成完整、自然、可执行的图像指令。

联网开关是项目级设置。搜索源由全局设置管理，按数值从小到大的优先级串行调用，当前源失败才切换备用源，任一成功即停止；项目不能选择特定供应商。所有源失败时，搜索调用作为工具错误交给 Pi Agent，Agent 可以继续使用项目上下文完成规划；只有模型请求、输出解析或契约校验失败才进入 BullMQ 的任务重试，不伪造搜索成功结果。

### 分镜阶段

`StoryboardItem.promptInstruction` 的语义是“最终生图 Prompt”，而不是模板草稿或中间片段。用户在确认前可以编辑它；编辑后的文本仍然是后续生成的直接输入。

`assetType` 是不可变的内部模板 ID，用于查找模板和默认尺寸；它不应被写入 Prompt。`displayName` 是给用户看的中文场景名称，也不应替代 Prompt。

### 生图阶段

Worker 执行以下顺序：

1. 检查任务未取消，且分镜属于当前项目。
2. 检查 Provider、模型、模型能力和模板 ID。
3. 检查 `PIXEL_PROTECTED` 是否有当前项目的 `PRODUCT_TRUTH` 图片。
4. 根据项目参数和模板默认尺寸计算输出尺寸。
5. 无 revision 时，将 `item.promptInstruction.trim()` 原样传给 Provider。
6. 有 revision 时，调用 Pi Agent 的 Prompt 改写函数，再将改写后的完整文本传给 Provider。
7. 把实际发送的文本保存到 `compiledPrompt`，用于结果追溯和导出 manifest。

Worker 必须拒绝包含 `Upstream template`、`Template fields` 等内部模板标记的旧 Prompt，并要求重新规划；不能静默替用户清洗旧数据。

图像生成的每个候选都有稳定的 `generationKey`。Worker 将它作为 Provider 的 `Idempotency-Key`，并写入输出记录和确定性文件路径；重复消费同一个 Job 时先查已有输出，避免重复落库。图像生成任务不使用 BullMQ 自动重试。Worker 在外部请求发起前写入“请求已开始”标记；进程在 Provider 返回前退出时，启动恢复会将任务标记为不可自动重试的失败，避免未知计费状态导致再次调用。

## 字段不变量

| 字段 | 含义 | 约束 |
| --- | --- | --- |
| `assetType` | 模板稳定 ID | 规划后不可修改；未知 ID 必须失败 |
| `templateVariant` | 模板已声明的变体 | 只能使用模板目录中存在的 key |
| `promptInstruction` | 用户可编辑的最终 Prompt | 直接发送给生图模型；不能包含内部模板元数据 |
| `compiledPrompt` | 本次实际发送的 Prompt 快照 | 普通生成时等于 `promptInstruction`；revision 生成时等于 Agent 改写后的完整 Prompt |
| `referencedAssets` | 分镜建议使用的素材 ID | 必须属于当前项目；商品事实图优先于风格参考图 |
| `factClaims` | Agent 认为可依据的事实 | 只能来自项目 `verifiedFacts`，不能凭空补充 |
| `riskFlags` | 需要人工复核的产品不确定性 | 不用于重复模板通用提示 |

## 为什么采用这种方式

成熟的开源生图项目通常把“可执行输入”和“工作流/样式/参数”分开：

- [AUTOMATIC1111 API](https://github.com/AUTOMATIC1111/stable-diffusion-webui/wiki/API) 把 `prompt`、采样参数和单次 `override_settings` 分成不同字段。
- [ComfyUI API 示例](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/basic_api_example.py) 把工作流节点和 `CLIPTextEncode` 的文本输入分开，调用方只替换真正的文本节点。
- [InvokeAI 节点工作流](https://invoke.ai/concepts/nodes-workflows/) 把节点输入/输出作为工作流连接；[Prompt Syntax](https://invoke.ai/concepts/prompt-syntax/) 只描述模型可理解的 Prompt 语法。
- [Fooocus](https://github.com/lllyasviel/Fooocus) 可以在内部做 Prompt 扩展和样式预设，但对外仍以用户 Prompt、样式和生成参数分别表达。

因此本项目把模板规范交给 Pi Agent 理解，把最终 Prompt 固化到分镜，把 Worker 限制为“执行器”。这样可以同时保证：Agent 有足够灵活性、用户能看到并编辑真实输入、Provider 请求可审计、模板不会重复注入。

## 扩展规则

### 新增图片类型

1. 在 `packages/ecom-skill/src/templates/` 增加模板 JSON，并运行 `pnpm --filter @ecomgen/ecom-skill gen:templates` 重新生成静态 manifest。
2. 在 `packages/ecom-skill/src/catalog.ts` 增加执行画像和默认尺寸。
3. 确保 `read_ecom_template` 能返回该模板的结构化规范。
4. 增加模板解析/校验测试和 Mock E2E 覆盖。
5. 不在 Worker 中增加该模板的 Prompt 拼接分支。

### 新增目标市场或平台

1. 在共享契约中增加合法枚举。
2. 在 `read_platform_guidance` 增加当前平台的短结构化规则，不要把全部平台全文写入 system prompt。
3. 明确规则是“画面应如何构图”还是“后期叠加区如何预留”。包图（如 hero-image）按平台占用比和文字预算来写；手动规划不得因平台增删用户选中的类型。
4. AI 规划先按商品品类选择图型，再按平台改写首图/信息流帧；不要只按平台套固定套图。
5. 由 Agent 将规则写成最终 Prompt；生图模型不应看到内部规则名称。
6. 更新 OpenAPI、契约测试和 E2E。

### 更换生图 Provider

Provider 适配器可以改变请求字段、图片上传方式和响应解析，但不能改变 `promptInstruction` 的语义。若某 Provider 需要正/负 Prompt 分栏，应在领域契约中显式增加字段，不能在适配器里偷偷拆词或追加文本。

## 验证命令

```bash
pnpm build
pnpm test
pnpm lint:openapi
pnpm test:e2e:mock
```

API schema 的手写真相源位于 `packages/contracts/src`（TypeBox）。运行 `pnpm gen:openapi` 生成 OpenAPI 组件视图，再由 `pnpm --filter @ecomgen/web gen:api` 生成 Web 类型；`pnpm gen:check` 会在不修改工作区的情况下对账这些生成物。

Mock E2E 必须至少验证：规划成功、手动确认、生图请求收到最终 Prompt、Prompt 不含内部模板元数据、审核和导出成功。
