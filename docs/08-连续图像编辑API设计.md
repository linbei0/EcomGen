# 连续图像编辑 API 设计

本文是 OpenAPI 变更草案，最终字段以根目录 `openapi.yaml` 为机器可读事实来源。

## 资源关系

```text
Project
  -> Output
      -> EditSession
          -> EditTurn
              -> EditPlan
                  -> Output
```

## 创建编辑会话

```http
POST /api/v1/projects/{projectId}/outputs/{outputId}/edit-sessions
```

用途：从一个已有 Output 打开连续编辑会话。重复调用应复用同一活动会话，除非请求显式要求新分支。

响应 `201`：

```json
{
  "sessionId": "edit_session_123",
  "projectId": "project_123",
  "currentOutputId": "output_456",
  "status": "ACTIVE",
  "memorySummary": {
    "summary": "",
    "constraints": []
  }
}
```

## 查询编辑会话

```http
GET /api/v1/edit-sessions/{sessionId}
```

返回当前 Output、最近编辑回合、版本父子关系、会话摘要和待确认计划。默认只返回最近回合，历史版本通过分页或单独端点查询。

## 提交编辑回合

```http
POST /api/v1/edit-sessions/{sessionId}/turns
Content-Type: multipart/form-data
```

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `baseOutputId` | string | 是 | 本轮编辑的源 Output |
| `message` | string | 是 | 用户自然语言要求 |
| `annotations.json` | file | 否 | 标注文档 |
| `edit-mask.png` | file | 否 | 编辑遮罩 |
| `protect-mask.png` | file | 否 | 保护遮罩 |
| `referenceAssetIds[]` | string[] | 否 | 参考商品或风格素材 |
| `canvasExpansion.json` | file | 否 | 扩图方向和尺寸 |

响应 `202`：

```json
{
  "turnId": "edit_turn_123",
  "planJobId": "job_789",
  "status": "PLANNING"
}
```

幂等指纹至少包含：会话、源 Output、消息 hash、遮罩 hash、参考资产、扩图参数和计划版本。

## 获取编辑回合

```http
GET /api/v1/edit-turns/{turnId}
```

返回 `PLANNING`、`NEED_INPUT`、`AWAITING_CONFIRMATION`、`GENERATING`、`SUCCEEDED` 或 `FAILED`。

计划示例：

```json
{
  "turnId": "edit_turn_123",
  "status": "AWAITING_CONFIRMATION",
  "plan": {
    "operation": "PRODUCT_REPLACE",
    "userSummary": "替换选中的商品，保持光线和构图。",
    "requiresConfirmation": true,
    "riskFlags": ["主体外观将发生变化"]
  }
}
```

## 批准计划

```http
POST /api/v1/edit-turns/{turnId}/approve
```

响应 `202`，进入 `GENERATING`。批准接口只能作用于当前用户有权访问且状态为 `AWAITING_CONFIRMATION` 的回合。

## 选择历史 Output

```http
POST /api/v1/edit-sessions/{sessionId}/select-output
```

请求：

```json
{
  "outputId": "output_old"
}
```

选择历史版本不会删除当前分支；后续提交会从该版本创建新分支。

## 错误码

| 错误码 | 场景 |
| --- | --- |
| `EDIT_SESSION_NOT_FOUND` | 会话不存在或不属于项目 |
| `OUTPUT_NOT_FOUND` | 源 Output 不存在 |
| `MASK_DIMENSION_MISMATCH` | 遮罩尺寸不等于源图尺寸 |
| `REFERENCE_ASSET_REQUIRED` | 商品替换缺少参考素材 |
| `EDIT_TARGET_REQUIRED` | 精确修改缺少目标区域 |
| `CAPABILITY_UNSUPPORTED` | Provider 不支持计划能力 |
| `EDIT_CONFIRMATION_REQUIRED` | 高影响计划尚未批准 |
| `EDIT_TURN_CONFLICT` | 回合已完成或正在执行 |

## SSE 约定

SSE 只发送失效通知，不承载完整计划历史：

```text
edit-session.updated
edit-turn.updated
output.created
```

前端收到通知后重新查询 REST 资源，避免依赖 SSE 历史恢复状态。

## 安全约束

- 所有 Output、资产和编辑会话都必须校验 projectId 归属。
- 参考资产只能引用当前项目资产。
- 遮罩、标注和 Agent 计划不得写入 Provider API Key 或主密钥。
- 客户端提交的尺寸、hash 和坐标必须服务端重新校验。
