# Worker 生图执行

Worker 消费 BullMQ 任务。它是“执行器”，不是 Prompt 编译器。

## 生图任务流程

`src/worker.ts` 的 `executeGeneration` 按以下顺序执行：

1. 检查任务取消状态。
2. 检查分镜存在且属于当前项目。
3. 检查 Provider、图像模型和已声明的 `openai_images` 或 `gemini` 能力。
4. 检查 `assetType` 是否能映射到 `ecom-skill` 模板。
5. 检查像素保护所需的商品真值图片。
6. 解析分辨率、比例和候选序号。
7. 取得最终 Prompt：普通任务原样使用 `promptInstruction`；revision 任务调用 Pi Agent 改写。
8. 保存 `compiledPrompt`，调用 Provider，保存输出并发布事件。

每个图像候选都会生成稳定的 `generationKey`。它同时作为 Provider 的 `Idempotency-Key`、输出数据库的唯一键和本地输出文件名的一部分，因此任务恢复或进程崩溃重跑时不会新增第二份本地输出。图像生成 BullMQ 任务不做自动重试，只能由用户显式重试。

Worker 在发起外部图像请求前会写入内部“请求已开始”标记。若进程在 Provider 返回前退出，启动恢复会将任务标记为失败且禁止自动重试，因为此时 Provider 是否已计费无法判定；Provider 已返回任务 ID 的执行仍可通过 `generationKey` 恢复。

## Prompt 不变量

```text
普通生成：compiledPrompt === withGenerationAssetRoles(promptInstruction.trim(), selectedImages)
revision： compiledPrompt === withGenerationAssetRoles(reviseImagePrompt(promptInstruction, revision), selectedImages)
```

Worker 不得做以下事情：

- 把模板名称、模板编号或 `templatePromptContract` 追加到 Prompt；
- 追加 Campaign Style Lock、平台规则或固定负面词；
- 根据 `displayName` 猜测图片内容并覆盖 Prompt；
- 发现旧 Prompt 有问题时静默删除内容。

Worker 只会基于实际发送的图片顺序追加固定角色说明，并标注每个素材的稳定短指代（`P1`、`R1`，由角色加确定性排序派生）：`PRODUCT_TRUTH` 是商品外观的唯一真值，其他素材只能作为包装、风格或版式参考。规划模型上下文与提示词正文只出现这些指代，真实素材 ID 不会进入任何模型输入；这段说明会写入 `compiledPrompt`，以便审计 Provider 实际收到的内容。

旧数据如果含有 `Upstream template`、`Template fields` 等内部标记，会明确失败并提示重新规划。这样可以避免用户看到的 Prompt 和 Provider 实际收到的 Prompt 不一致。

## 资源检查和状态检查

- 资源检查：确认商品真值图片存在、素材属于当前项目、图片 MIME 类型可读取。
- 状态检查：确认任务未取消、分镜存在、Provider/模型仍可用，并由 API 的确认状态约束生成入口。
- 参数检查：确认模板默认尺寸、项目分辨率、画幅比例和候选序号可以组合。

这些检查只决定“能否安全执行”，不会替 Agent 生成 Prompt。

## 修改这个包时

```bash
pnpm --filter @ecomgen/worker build
pnpm test:e2e:mock
```

如果新增 Provider 字段或生成参数，应在 Provider 适配器和领域契约中显式表达，并在 Mock E2E 中断言实际 HTTP 请求。不要通过修改 Worker Prompt 字符串来兼容 Provider 差异。
