# @ecomgen/web

EcomGen 桌面优先工作台前端（React 19 + Vite + Ant Design 6 + Motion + TanStack Query）。接口契约以根目录 [`openapi.yaml`](../../openapi.yaml) 为准，浏览器不直连 Redis / SQLite / Provider。

## 环境要求

- Node.js 22+、pnpm 11+
- 后端：`pnpm dev:api`（默认 `http://127.0.0.1:8787`）；生成链路另需 `pnpm dev:worker` 与 Redis

## 常用命令

```bash
pnpm install            # 仓库根目录执行
pnpm dev:web            # Vite 开发服务器（/api 代理到 127.0.0.1:8787）
pnpm --filter @ecomgen/web build   # tsc + vite build
pnpm --filter @ecomgen/web test    # vitest（jsdom + msw）
pnpm --filter @ecomgen/web gen:api # 由根目录 openapi.yaml 重新生成 src/api/schema.d.ts
```

## 配置

复制 `.env.example` 为 `.env`：

- `VITE_API_BASE_URL`：API 基地址，默认 `http://127.0.0.1:8787/api/v1`。开发环境另有 Vite 代理兜底（CORS 未开时仍可用）。

## 结构约定

- `src/api`：openapi-fetch client、错误规范化、query key 工厂、SSE 失效映射与运行时适配层（后端响应与 OpenAPI 的差异集中在此，组件不感知）。
- `src/features`：按阶段组织（home / projects / providers / workbench）。
- `src/lib`：纯函数（成本文案、阶段推导、分组等），优先测试。
- `src/design`：设计 tokens、AntD 主题、动效预设；唯一强调色与 z-index 尺度在此维护。
- 契约变更流程：先改根目录 `openapi.yaml` → `gen:api` 重新生成 → 同步 `src/test/msw/handlers.ts`（手写、严格按契约）。

## 字体

展示字体（得意黑 Smiley Sans）与等宽字体（JetBrains Mono）自托管于 `public/fonts/`，缺失时回退系统字体；子集化与引入见 `public/fonts/README.md`。
