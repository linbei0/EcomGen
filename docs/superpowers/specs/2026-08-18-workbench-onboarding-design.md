# 一键启动与工作台直达

日期：2026-08-18

## 问题

初版前后端可用，但日常开发和首次生图路径不友好：

1. 本机开发必须分别开三个终端跑 `pnpm dev:api`、`pnpm dev:worker`、`pnpm dev:web`。
2. 「新建项目」是三步向导（平台 → 图片类型 → 模式/模型）。用户希望点一下就进工作台，其余字段在工作台随时改。
3. 推理模型下拉会混入生图模型（`modelOptions(..., "reasoning")` 未排除带 `imageApiKind` 的模型）。
4. 素材卡片不能删除。
5. 粘贴剪贴板图片时，multipart 可能丢 `role`，API 报 `role must be a non-empty string`；偶发 Vite 代理 `ECONNRESET`/`ECONNABORTED`。
6. 顶栏「API 不可达」：前端 `API_BASE_URL` 默认是 `http://127.0.0.1:8787/api/v1`，`GET /health` 实际打到 `/api/v1/health`，而后端健康检查在根路径 `/health`。

## 目标

- 一个终端 `pnpm dev` 同时起 API、Worker、Web；原三个脚本保留。
- 点「新建项目」直接进工作台。名称、平台、模式、描述、事实、禁止宣称、推理/生图模型都在工作台改。
- 图片类型仍只在规划步选择，不搬到新建或左侧。
- 一并修模型过滤、删除素材、粘贴缺 `role`、健康检查路径。

## 非目标

- 不压扁规划 → 分镜确认 → 生成这条链路。
- 不把前端塞进 Docker Compose。
- 不保留三步创建向导。
- 不在右侧再放一份图片类型选择。

## 启动

根 `package.json` 增加 `dev`：用 `concurrently` 并行跑现有 `dev:api`、`dev:worker`、`dev:web`，带颜色前缀区分日志。`concurrently` 作为根 `devDependency`。独立脚本继续给需要单进程调试的场景用。

## 新建项目

首页「新建项目」不再打开向导。

1. 拉取 Provider 列表。
2. 若找不到一对可用模型（至少一个无 `imageApiKind` 的推理模型 + 至少一个有 `imageApiKind` 的生图模型），打开设置抽屉，toast 提示先配置 Provider，不创建。
3. 否则 `POST /projects`，默认值：
   - `name`：`未命名项目`
   - `platformTargets`：`["DOMESTIC"]`
   - `defaultMode`：`CREATIVE`
   - 描述 / 类目 / 事实 / 禁止宣称：空
   - 推理、生图：各取第一个可用模型
4. 成功后跳到 `/projects/:id?stage=assets`。
5. 删除 `CreateProjectWizard` 及其测试路径；首页测试改为断言一键创建与「无 Provider 打开设置」。

## 工作台编辑

左侧：

- 项目名称可编辑。
- 平台、默认模式可点选，立刻 PATCH。

右侧检视（非分镜步）：

- 商品描述、已核验事实、禁止宣称。
- 推理模型、生图模型下拉；模型可随时改。
- 文本框失焦提交；点选类控件变更即提交。

规划步继续独占图片类型选择，读写现有 `localStorage`（`saveImageTypes` / `loadImageTypes`）。

PATCH 失败 toast，不回写成假成功。改模型只影响后续规划/生图任务，不改写已入队或已完成任务。

顶栏项目名与左侧名称同步；`ModeBadge` 跟 `defaultMode`。

## API

`PATCH /projects/:projectId` 按 OpenAPI `UpdateProjectInput` 补上 `reasoningModel` / `imageModel`（`{ providerId, modelId }`）。校验与创建时相同：推理模型必须存在；生图模型必须存在且带 `imageApiKind`。

新增 `DELETE /assets/{assetId}`：

- 204：删除 SQLite 行，并删除本地存储文件。
- 404：素材不存在。
- 不级联改分镜、输出或已跑任务。

同步 `docs/openapi.yaml`，前端 `pnpm --filter @ecomgen/web gen:api`。

`repository` 增加 `deleteAsset`。API 只做校验与持久化，不在请求里读文件做额外处理。

## 素材与粘贴

`AssetsStage`：

- 卡片增加删除按钮，调用 `DELETE /assets/{assetId}`，成功后刷新项目详情。
- 拖入与 `<input type=file>` 继续走现有 `sendFiles`，始终带当前选中 `role`（默认 `PRODUCT_TRUTH`）。
- 增加 `paste`：从剪贴板取图片；无 MIME 或空类型时仍按当前 `role` 上传，禁止发空 `role`。
- `serializeAssetForm` 先写 `role`（及可选 `variantId`）再写 `file`，避免 Fastify multipart 先读文件时字段尚未解析。

`ECONNRESET` / `ECONNABORTED` 视为 API 进程中断或请求被取消，不另做重试策略；一键 `pnpm dev` 降低「只开了前端」的误用。上传失败仍 toast。

## 健康检查

前端不再用 `api.GET("/health")`（会被拼到 `/api/v1/health`）。

`useHealth` 用原生 `fetch` 打根路径健康检查，规则：

- `VITE_API_BASE_URL` 是绝对地址（默认 `http://127.0.0.1:8787/api/v1`）：请求其 origin 下的 `/health`，即 `http://127.0.0.1:8787/health`。
- `VITE_API_BASE_URL` 是相对路径（如 `/api/v1`）：请求同源 `/health`，并在 `vite.config.ts` 把 `/health` 代理到 `http://127.0.0.1:8787`。

不要对相对 base 调用 `new URL(path, relativeBase)`，浏览器会抛错。

徽标语义不变：只表示健康检查结果。

## 模型过滤

`modelOptions(providers, "reasoning")` 只保留 `!model.imageApiKind`。
`modelOptions(providers, "image")` 只保留 `Boolean(model.imageApiKind)`。

工作台与任何剩余选择器共用同一过滤函数，避免推理框再出现 `gpt-image2`。

## 测试

- 根或文档可核对存在 `pnpm dev`。
- 首页：有 Provider 时点新建即 `POST /projects` 并导航；无 Provider 时打开设置且不 POST。
- 模型选项：推理列表不含带 `imageApiKind` 的模型。
- PATCH 项目可改 `reasoningModel` / `imageModel`；非法组合 400/422。
- `DELETE /assets/:id`：存在则 204 且文件消失；不存在则 404。
- 健康徽标在 `/health` 200 时显示「API 已连接」。
- 上传 FormData 含非空 `role`。

提交前：`pnpm build`、`pnpm test`、`pnpm lint:openapi`。涉及任务编排或导出时再跑 `pnpm test:e2e:mock`。

## 文件影响（预期）

- `package.json`：`dev` + `concurrently`
- `apps/web`：去掉向导；首页创建；工作台左右栏编辑；素材删除/粘贴；健康检查；模型过滤
- `apps/api`：PATCH 模型字段；DELETE asset
- `packages/core`：`deleteAsset`
- `docs/openapi.yaml`：DELETE asset（PATCH 模型字段契约已存在）
