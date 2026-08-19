# AGENTS.md

## 项目概览

EcomGen 是面向个人卖家的电商 AI 生成套图工具。当前后端优先，桌面优先，本机 Windows 开发；前后端分离，后端由 API、Worker 和共享包组成。

- `apps/api`：Fastify HTTP API、文件上传、Provider 配置、SSE 事件。
- `apps/web`：React + Vite 桌面优先工作台；经 `VITE_API_BASE_URL` 访问 API，不直连 Redis/SQLite/Provider。
- `apps/worker`：BullMQ 消费者、Pi Agent 分镜规划、OpenAI 兼容生图、审核结果和 ZIP 导出。
- `packages/core`：SQLite 持久化、本地文件存储、密钥加密、任务指纹。
- `packages/agent`：Pi Agent 规划适配器。
- `packages/ecom-skill`：已内置改造后的 `ecom-details-image` 模板与 Prompt 合约；运行时不依赖外部 Skill 仓库。
- `packages/providers`：OpenAI-compatible Provider 和连通性探测。
- `packages/contracts`：跨应用共享的领域类型。
- `packages/jobs`：Redis、BullMQ 队列和 Redis Pub/Sub 事件总线。

接口契约以 [`docs/openapi.yaml`](docs/openapi.yaml) 为准，前端交接顺序见 [`docs/07-后端实现与前端交接.md`](docs/07-后端实现与前端交接.md)。

## 环境要求

- Windows、Node.js 22+、pnpm 11+
- Redis 6.2+（BullMQ 官方建议；本机开发可使用现有 Redis）
- Docker Desktop（仅用于直接使用者的 Compose 部署或需要隔离服务时）
- `ECOMGEN_MASTER_KEY`：Base64 编码的 32 字节密钥

复制 `.env.example` 为 `.env`，不要提交真实 API Key、主密钥、SQLite 数据库或生成文件。

## 常用命令

```bash
pnpm install
pnpm build
pnpm dev:api
pnpm dev:worker
pnpm dev:web
pnpm test
pnpm test:e2e:mock
pnpm lint:openapi
```

API 默认监听 `http://127.0.0.1:8787`，业务接口前缀为 `/api/v1`。API 与 Worker 必须使用同一个 `REDIS_URL`、`ECOMGEN_MASTER_KEY`、`ECOMGEN_DATA_DIR` 和 `ECOMGEN_QUEUE_NAME`。

Docker Compose 面向直接使用者：

```bash
docker compose up -d --build
```

## 开发约定

- 使用 TypeScript ESM、NodeNext 模块解析和严格类型检查；新增跨应用数据结构优先放入 `packages/contracts`。
- 包之间通过 workspace 依赖引用，不在应用中复制领域类型或数据库 SQL。
- 项目处于开发初期时，以当前 API 和领域契约为唯一规范；未经明确需求，不保留历史状态、字段或行为的运行时兼容分支。需要处理开发数据时，优先采用一次性迁移或显式版本化方案，并补充验证。
- API 只负责校验、持久化和入队；耗时的模型调用、文件处理和导出必须在 Worker 中执行。
- REST 是状态真相；SSE 只用于通知前端失效并重新查询，不在前端依赖事件历史恢复状态。
- 任务创建应提供稳定请求指纹；重复请求应复用 `QUEUED`、`RUNNING` 或 `SUCCEEDED` 任务。
- 不绕过 `ecom-skill` 模板校验，不把未知模板 ID 静默当作普通 Prompt。
- `PIXEL_PROTECTED` 必须使用当前项目上的 `PRODUCT_TRUTH` 素材；不能用虚假的成功结果掩盖缺少输入或 Provider 失败。

## 注释规则

本项目遵循 TypeScript 官方 JSDoc 支持说明和 Google TypeScript Style Guide 的注释原则：注释解释设计原因、约束、外部协议或非显然的副作用，不重复代码本身的语义；代码变更时必须同步更新过期注释。公开导出函数、类、接口和复杂领域字段使用简洁的 JSDoc/TSDoc，参数和返回值只有在类型无法表达其含义时才补充 `@param`、`@returns` 等标签。普通实现优先使用短行注释，禁止为每个变量或简单赋值添加叙述性注释，禁止在注释中写未经验证的业务承诺。

必要注释应集中在这些位置：

- `packages/ecom-skill`：说明上游模板来源、固定 commit 和本地改造边界。
- `apps/worker`：说明取消检查、任务恢复、像素保护和导出 manifest 的关键不变量。
- `packages/core`：说明密钥加密、请求指纹规范化和 SQLite 事务边界。
- Provider 适配器：说明兼容 API 的路径、响应格式和不应产生额外费用的探测行为。

注释使用简体中文；协议字段、模型名、代码标识符和标准术语保留英文。不要为了满足注释数量而修改无关源码。

## 测试要求

- 修改领域逻辑或持久化：补充对应 package 的 Vitest 测试。
- 修改 API 契约：同步 `docs/openapi.yaml`，运行 `pnpm lint:openapi`。
- 修改任务编排、Provider 或导出：运行 `pnpm test:e2e:mock`。
- 提交前至少运行 `pnpm build`、`pnpm test`、`pnpm lint:openapi`；涉及完整链路时额外运行 Mock E2E。
- 测试失败时修复根因，不通过吞错、伪造成功状态或静默降级隐藏失败。

### 测试价值与 TDD 边界

- TDD 用于先定义可观察的业务行为、修复可复现缺陷或保护稳定契约；不以覆盖率、测试数量或每个实现改动都新增测试为目标。
- 新增测试必须至少保护以下一项：公开 API 契约、领域不变量、持久化或任务状态转换、高风险 Provider 协议边界，或已复现的缺陷。否则优先复用现有测试，不新增测试文件。
- 不为私有实现细节、纯类型或字段透传、静态配置、简单 UI 排版或 mock 调用次数单独测试，除非它们直接承载上述契约或缺陷。
- 同一规则的多个变体优先使用参数化测试或扩展既有用例；禁止按模型、Provider 或组件机械复制同构测试。
- 重构且外部行为不变时，依赖既有契约测试验证；只有现有测试无法保护实际回归风险时才补充测试。
- 新增或保留测试前应能明确说明其缺失时会放过的真实回归；无法说明时不新增。定期删除重复、被更高层测试充分覆盖且没有独立诊断价值的测试。

## 安全与数据

- Provider API Key 只通过 API 接收并加密保存，响应不得回传密钥。
- 浏览器不得直连 Redis、SQLite、Provider 或本地存储目录。
- Prompt、`manifest.json` 和日志不得写入 API Key、主密钥或其他凭据。
- 用户上传文件和模型输出默认保存在 `ECOMGEN_DATA_DIR`；不要提交 `data/`、`data-e2e-*` 或生成的 ZIP。

## 文档参考

- [AGENTS.md 规范](https://agents.md/)
- [TypeScript JSDoc 支持](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
- [API 契约](docs/openapi.yaml)
- [ecom-details-image 适配说明](docs/08-ecom-details-image-适配说明.md)
