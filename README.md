# EcomGen

EcomGen 是面向个人卖家的电商 AI 套图工具：用户提供商品事实、商品图、参考素材和目标市场，系统通过 Pi Agent 规划分镜，再由 Worker 调用生图 Provider。

## 开始开发

```bash
pnpm install
pnpm build
pnpm test
pnpm lint:openapi
```

本机完整链路需要 Redis 和 `ECOMGEN_MASTER_KEY`。Mock 验收使用：

```bash
pnpm test:e2e:mock
```

## 长期维护文档

- [运行时架构与不变量](./ARCHITECTURE.md)：代码真正遵循的模块职责、Prompt 生命周期、Pi 工具限制和扩展规则。
- [Pi Agent 适配器](./packages/agent/README.md)：规划 Agent 的输入、业务工具、输出校验和改写流程。
- [Worker 生图执行](./apps/worker/README.md)：资源检查、状态检查、Provider 调用和审计字段的语义。

`docs/` 下的文件属于产品设计和开发前规划材料，不是运行时行为的唯一依据。若规划材料与代码、OpenAPI 或本 README 冲突，以代码和这些长期维护文档为准。

## 工程边界

- API 负责校验、持久化和入队，不执行耗时模型调用。
- Pi Agent 负责理解项目、读取电商规范并生成最终生图 Prompt。
- Worker 负责任务编排、资源/状态检查和 Provider 调用，不重新拼接模板 Prompt。
- Provider API Key 只在 API 接收并加密保存，Prompt、日志和导出 manifest 不得包含凭据。
