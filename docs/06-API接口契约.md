# API 接口契约

## 基础约定

开发 API 是 `http://127.0.0.1:8787/api/v1`。机器可读描述为 [openapi.yaml](openapi.yaml)，实现状态和前端接入顺序见 [07-后端实现与前端交接.md](07-后端实现与前端交接.md)。首版为本地单用户，不提供登录，也不允许浏览器直连 Redis、SQLite 或模型 Provider。

所有错误为：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "variantScope must be COMMON or a project variant ID",
    "details": [],
    "requestId": "uuid"
  }
}
```

错误码为 `VALIDATION_ERROR`、`NOT_FOUND`、`CONFLICT`、`CAPABILITY_UNSUPPORTED`、`RATE_LIMITED`、`PROVIDER_ERROR`、`INTERNAL_ERROR`。前端按 `code` 处理，不解析 `message`。

## 已实现端点

| 资源 | 方法和路径 | 说明 |
| --- | --- | --- |
| 健康 | `GET /health` | 返回 `{ status: "ok" }`。 |
| 电商模板 | `GET /ecom-templates` | 返回固定上游 commit 与 25 个可选的 `ecom-details-image` 模板。 |
| Provider | `GET/POST /providers`，`PATCH/DELETE /providers/{providerId}`，`POST /providers/{providerId}/test` | 密钥只接收不回传；响应用 `hasApiKey` 表示是否已配置；test 只调用兼容 API 的 `/models`，不消耗生图额度。 |
| 项目 | `GET/POST /projects`，`GET/PATCH /projects/{projectId}` | 项目创建时指定推理模型、生图模型、平台和默认模式。 |
| SKU | `POST /projects/{projectId}/variants` | 属性为字符串键值对象。 |
| 素材 | `POST /projects/{projectId}/assets` | multipart 中包含 `file`、`role`、可选 `variantId`。 |
| 分镜 | `POST /projects/{projectId}/planning-jobs`，`GET /projects/{projectId}/storyboard`，`PATCH /storyboard-items/{itemId}`，`POST /projects/{projectId}/storyboard/confirm` | 分镜必须确认后才可生图。 |
| 生成 | `POST /projects/{projectId}/generation-jobs` | body 显式包含 `storyboardItemIds`，可选 `revision`。 |
| 任务 | `GET /jobs/{jobId}`，`POST /jobs/{jobId}/cancel`，`POST /jobs/{jobId}/retry` | 支持 `Idempotency-Key`/请求指纹去重；运行中取消先记录 `cancelRequested`，Worker 在阶段边界停止；Worker 重启会恢复 `RUNNING` 任务。 |
| 输出 | `GET /projects/{projectId}/outputs`，`PATCH /outputs/{outputId}/review` | 审核值为 `SELECTED`、`REJECTED`、`NEEDS_REVIEW`。 |
| 导出 | `POST /projects/{projectId}/export-jobs`，`GET /exports/{exportId}` | Worker 创建 ZIP，包含图片和 `manifest.json`（事实、模板、变体、模式、Prompt、审核状态、输出 hash）。 |
| 二进制文件 | `GET /files/assets/{assetId}`、`/files/outputs/{outputId}`、`/files/exports/{exportId}` | 直接用于浏览器预览或下载。 |
| 事件 | `GET /events?projectId={projectId}` | `text/event-stream`，事件只做缓存失效，REST 是状态真相。 |

`GET /providers` 与 `GET /projects` 返回 `{ "items": [], "nextCursor": null }`。项目详情返回项目字段和 `variants`、`assets`、`storyboard`、`items`、`outputs`、`jobs`。其他列表当前直接返回数组。

项目事实字段：`productDescription` 是商品的客观描述；`verifiedFacts` 是允许出现在图片/Prompt 中的可核验事实；`prohibitedClaims` 是明确禁止生成的主张；`brandGuidelines` 是品牌色、语气等键值规范。字段不完整不会阻止规划，但 Agent 和 Worker 会以占位符和风险标记代替未提供事实。

本机不调用真实模型的端到端验收命令是 `pnpm test:e2e:mock`，要求 Redis 可用；它会独立启动 API、Worker 和 OpenAI 兼容 Mock 服务，覆盖规划、确认、生图、审核和 ZIP 导出。

## 关键约束

- `platformTargets` 仅为 `DOMESTIC` 和 `AMAZON`。
- `requestedTypes` 必须是 `/ecom-templates` 返回的模板 ID 或别名；规划器不会把任意字符串当作未知视觉类型继续执行。
- `variantScope` 仅为 `COMMON` 或当前项目 Variant ID，禁止跨 SKU 混图。
- `PIXEL_PROTECTED` 的 Worker 只接收同一 scope 的 `PRODUCT_TRUTH` 图片；没有素材将以任务失败明确返回，而不是冒充像素保护成功。
- Provider 声明 `imageApiKind: "custom"` 可以保存，但首版 Worker 只能执行 `openai_images`；不可执行时产生可重试失败任务。
- 生图前的费用与数量确认属于前端责任，后端要求传入明确 item ID，不默认批量扩图。
- Job 的 `estimatedCost.status` 在 Provider 未声明价格时为 `UNKNOWN`，后端不会伪造金额；`actualCost` 由后续 Provider 适配器填充。

## SSE

事件名：`job.updated`、`storyboard.updated`、`output.created`、`export.updated`、`provider.updated`。连接建立后会收到 `connected`。页面恢复或漏事件时，重新请求项目、分镜、任务或输出端点，不根据 SSE 历史推断最终状态。
