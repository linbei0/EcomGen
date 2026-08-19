# Pi Agent 适配器

这个包是 EcomGen 与 Pi 的唯一规划适配层。它使用 `@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai`，不调用 Pi CLI。

## Agent 的任务

Pi Agent 接收项目上下文、商品事实、素材摘要、目标市场、默认模式和用户选择的模板 ID，然后完成两件事：

1. 选择或确认合法的图片类型和变体。
2. 生成每个分镜的最终生图 Prompt。

最终 Prompt 必须能直接发送给图像模型，不能等待 Worker 再填充模板、风格锁或安全约束。

## 业务工具

工具定义在 [`src/tools.ts`](./src/tools.ts)：

| 工具 | 作用 | 设计限制 |
| --- | --- | --- |
| `read_ecom_template` | 读取一个模板的结构化视觉规范 | 只读；未知模板直接抛错；不返回“Upstream template”拼接文本 |
| `read_platform_guidance` | 读取目标市场和平台规则 | 只读；未知平台直接抛错；返回业务规则而不是内部 Prompt 片段 |

Pi 不启用文件、Shell、浏览器或任意 Web 工具。业务工具失败必须让 Agent 任务失败，不能默认为普通 Prompt 继续执行。

## 输出要求

规划输出保留 `promptInstruction` 字段，以兼容现有 API 和数据库，但字段含义已经固定为最终 Prompt：

```json
{
  "assetType": "hero-image",
  "displayName": "通勤杯质感首图",
  "templateVariant": "luxury",
  "mode": "PIXEL_PROTECTED",
  "promptInstruction": "Create a complete e-commerce hero image ...",
  "factClaims": ["304 stainless steel body"],
  "riskFlags": []
}
```

校验器会拒绝：

- 空 Prompt；
- 未知模板或未声明的模板变体；
- 手动模式下漏项、增项或替换图片类型；
- 重复或泛化的显示名称；
- `Upstream template`、`Template fields`、`promptContract` 等内部模板元数据。

## Prompt 改写

用户点击重新生成并填写 revision 时，Worker 调用 `reviseImagePrompt`。该函数仍使用推理模型，但不读取文件或模板工具；它以现有最终 Prompt 为基础，返回新的完整最终 Prompt。

改写函数必须：

- 保留商品事实、像素保护和负面约束，除非用户明确要求改变；
- 返回纯文本，不返回 Markdown、JSON 或解释；
- 失败时抛出错误，让任务进入 `FAILED`，不能使用旧 Prompt 冒充成功。

## 修改这个包时

```bash
pnpm --filter @ecomgen/agent build
pnpm --filter @ecomgen/agent test -- --run
```

新增工具时，优先把业务规则做成结构化返回值，并为未知 ID、未知平台和最终 Prompt 泄漏内部元数据增加测试。不要把模板 JSON 全量复制进 Agent 的用户消息，也不要在 Worker 中补回 Prompt 拼接逻辑。
