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
| `read_ecom_template` | 读取一个模板的结构化视觉规范 | 只读；未知模板直接抛错；返回完整 `categoryTips` 品类提示清单，由 Agent 自行挑选最贴合商品品类的条目改写，不由代码代选；不返回“Upstream template”拼接文本 |
| `read_platform_guidance` | 读取目标市场、商品品类和平台规则 | 只读；未知平台直接抛错；只返回当前选中平台的短规则和品类族提示；不是内部 Prompt 片段 |
| `research_visual_direction` | 检索近期视觉趋势与版式灵感 | 默认关闭；只调用配置的搜索 API，不打开任意 URL；结果只能作为视觉灵感，不能升级为商品事实 |

Pi 不启用文件、Shell、浏览器或任意 URL 抓取。联网仅通过显式配置的 `research_visual_direction` 搜索工具；搜索工具失败会作为工具错误返回给 Agent，由模型决定继续使用已有项目上下文完成规划。

搜索源在设置抽屉中配置，支持 Brave、Tavily 与自托管 SearXNG。密钥仅经 API 加密保存，列表不会回传明文。Worker 按数值从小到大的 `priority` 串行尝试已启用来源，任一成功即停止；当前来源失败才切换下一个。搜索结果不写入商品事实，也不会自动追加到最终 Prompt。

## 联网研究与失败处理

搜索只允许覆盖近期电商视觉趋势、构图、镜头、光线、材质表现和目标平台版式；不搜索或采信价格、规格、认证、功效、排名、发货承诺等商品事实。工具单次请求最多返回 5 条标题、URL 和摘要，Agent 只能把其中的视觉语言转化为 Prompt，不能输出来源或引用内容。

搜索工具抛错不会单独中止当次 Pi Agent 规划运行；Pi 会收到工具错误并继续后续推理或工具调用，最终可以基于项目上下文完成不联网规划。只有推理模型请求失败、没有可解析的助手输出或规划结果不符合契约时，规划任务才会失败并交给 BullMQ 重试。搜索失败不代表自动重试搜索请求本身，也不会伪造搜索成功结果。

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
