# Provider 包约束

`packages/providers` 负责外部 Provider 的协议适配、模型能力声明，以及面向 Pi 的推理模型构建。

## 协议适配

- `ReasoningProtocolProfile` 是 OpenAI-compatible 推理协议差异的唯一事实来源。新增或调整模型族时，在 `src/reasoning-profile.ts` 中新增或修改 Profile，并在对应测试中覆盖。
- 业务代码、`packages/agent` 和 `apps/worker` 不得通过 URL、Provider 名称或模型名称分支拼接请求参数；它们只能使用 `buildReasoningModel` 返回的 Pi `Model`。
- `reasoningProtocol` 描述传输协议；`supportsThinking`、`supportsVision` 等 capability 描述模型能力。两者必须独立配置，禁止从 Provider 名称或 URL 推断能力。
- Profile 必须复用 `@earendil-works/pi-ai` 的 `OpenAICompletionsCompat`。除非 Pi 无法表达目标协议差异，不得在本项目重复实现消息序列化或流式响应解析。
- `openai` Profile 保持 Pi 默认行为；新增的覆盖项必须仅限目标协议实际要求的差异。

## 验证与失败处理

- 每个 Profile 都必须在 `src/reasoning-probe.test.ts` 中覆盖一次可产生终止文本的探测请求，并验证产生的 `Model` 配置。
- Provider 或协议错误必须原样暴露为任务失败；不得改用其他 Profile 重试，不得静默关闭 thinking，也不得伪造成功结果。
- 修改协议 Profile、能力映射或 Provider 探测后，至少运行 `pnpm --filter @ecomgen/providers test` 和 `pnpm test:e2e:mock`。
