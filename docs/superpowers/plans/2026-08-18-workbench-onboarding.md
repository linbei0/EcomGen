# 工作台直达与一键启动 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已批准的 spec（`docs/superpowers/specs/2026-08-18-workbench-onboarding-design.md`）实现一键 `pnpm dev`、首页一键建项目直进工作台、工作台可编辑元数据与模型、素材删除/粘贴、健康检查修复。

**Architecture:** 前端抽出纯函数（`modelOptions`、`healthUrl`）与两个工作台面板组件；API 抽出 `ApiError` 与 `projectPatch` 帮助函数保持 handler 薄；core 补 `deleteAsset`；OpenAPI 增加 DELETE asset 后重新生成前端 schema。全程 TDD，每个任务独立可测、独立提交。

**Tech Stack:** TypeScript ESM (NodeNext)、Vitest、MSW、Fastify、better-sqlite3、openapi-typescript、openapi-fetch、antd 6、concurrently、pnpm workspace。

## Global Constraints

- 注释用简体中文，只解释设计原因与约束；协议字段/代码标识符保留英文（AGENTS.md）。
- 相对导入带 `.js` 扩展名（NodeNext，参考 `packages/core/src/repository.ts` 的 `./database.js`）。
- API 只做校验、持久化与入队；不在请求里做文件重处理。
- 测试失败修根因，不吞错、不伪造成功。
- REST 是状态真相：PATCH/DELETE 成功后 invalidate 对应 query，让前端重新 GET。
- 图片类型选择只在 PlanStage（`apps/web/src/lib/imageTypes.ts`），本计划不动它。
- 不改 Docker Compose、不压扁六步流程、不做 ECONNRESET 重试。
- 提交信息参考 `git log --oneline` 既有风格；本会话不代提交，由执行者按各任务末尾步骤提交。
- 每个任务完成前只跑该任务列出的命令；全部完成后跑 Task 13 的总验证。

***

### Task 1: 根目录 `pnpm dev` 一键启动

**Files:**

- Modify: `package.json`

**Interfaces:**

- Consumes: 既有 `dev:api` / `dev:worker` / `dev:web` 脚本。
- Produces: 根脚本 `dev`（并行三个进程，带名称前缀），后续任务不依赖它。
- [ ] **Step 1: 修改 package.json**

在 `scripts` 中 `dev:web` 之后加一行，并在 `devDependencies` 加 `concurrently`：

```json
{
  "scripts": {
    "build": "pnpm -r build",
    "dev": "concurrently -n api,worker,web -c cyan,magenta,green \"pnpm dev:api\" \"pnpm dev:worker\" \"pnpm dev:web\"",
    "dev:api": "pnpm --filter @ecomgen/api dev",
    "dev:worker": "pnpm --filter @ecomgen/worker dev",
    "dev:web": "pnpm --filter @ecomgen/web dev"
  },
  "devDependencies": {
    "@types/node": "^22.15.3",
    "concurrently": "^9.2.0",
    "tsx": "^4.19.4",
    "typescript": "^5.8.3",
    "vitest": "^3.1.2"
  }
}
```

- [ ] **Step 2: 安装并验证脚本存在**

Run: `pnpm install`
Expected: 安装成功，无 peer 依赖错误。

Run: `pnpm run | Select-String -Pattern "dev"`
Expected: 输出包含 `dev`。

- [ ] **Step 3: 手动验证三个进程都起来**

Run: `pnpm dev`（观察日志后 Ctrl+C 停止）
Expected: 出现 `[api]`、`[worker]`、`[web]` 三个前缀的日志；浏览器 `http://127.0.0.1:5173` 可打开（可跳过浏览器检查，仅看日志）。

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat: 根目录 pnpm dev 一键并行启动 api/worker/web"
```

***

### Task 2: modelOptions 纯函数（修推理模型混入生图模型）

**Files:**

- Create: `apps/web/src/lib/modelOptions.ts`
- Create: `apps/web/src/lib/modelOptions.test.ts`

**Interfaces:**

- Consumes: 无（结构化最小类型，`ProviderConfig`（`apps/web/src/api/hooks/useProviders.ts`）结构兼容）。
- Produces: `modelOptions(providers, kind)` 返回 `{ value: string; label: string; vision: boolean }[]`，`value` 格式 `` `${providerId}::${modelId}` ``；`pickDefaultModels(providers)` 返回 `{ reasoningProviderId, reasoningModelId, imageProviderId, imageModelId } | null`。Task 4（首页创建）与 Task 12（检视面板）依赖。
- [ ] **Step 1: 写失败测试**

`apps/web/src/lib/modelOptions.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { modelOptions, pickDefaultModels } from "./modelOptions";

const PROVIDERS = [
  {
    id: "p1",
    name: "OpenAI 官方",
    models: [
      { id: "gpt-4o", supportsVision: true, imageApiKind: null },
      { id: "gpt-image-1", supportsVision: false, imageApiKind: "openai_images" },
    ],
  },
  {
    id: "p2",
    name: "中转站",
    models: [
      { id: "image2", supportsVision: false, imageApiKind: "openai_images" },
    ],
  },
];

describe("modelOptions", () => {
  it("reasoning 只保留无 imageApiKind 的模型", () => {
    const options = modelOptions(PROVIDERS, "reasoning");
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ value: "p1::gpt-4o", label: "OpenAI 官方 / gpt-4o", vision: true });
  });

  it("image 只保留带 imageApiKind 的模型", () => {
    const options = modelOptions(PROVIDERS, "image");
    expect(options.map((item) => item.value)).toEqual(["p1::gpt-image-1", "p2::image2"]);
  });
});

describe("pickDefaultModels", () => {
  it("返回第一对可用的推理+生图模型", () => {
    expect(pickDefaultModels(PROVIDERS)).toEqual({
      reasoningProviderId: "p1",
      reasoningModelId: "gpt-4o",
      imageProviderId: "p1",
      imageModelId: "gpt-image-1",
    });
  });

  it("缺生图模型时返回 null", () => {
    expect(pickDefaultModels([PROVIDERS[0]!].map((p) => ({ ...p, models: p.models.filter((m) => !m.imageApiKind) })))).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @ecomgen/web test -- src/lib/modelOptions.test.ts`
Expected: FAIL（Cannot find module ./modelOptions）。

- [ ] **Step 3: 最小实现**

`apps/web/src/lib/modelOptions.ts`：

```ts
/** 模型选择下拉的最小结构；ProviderConfig（schema.d.ts）与其结构兼容。 */
export interface ModelOptionSource {
  id: string;
  name: string;
  models: Array<{ id: string; supportsVision: boolean; imageApiKind: string | null }>;
}

export interface ModelOption {
  value: string;
  label: string;
  vision: boolean;
}

export interface ModelPair {
  reasoningProviderId: string;
  reasoningModelId: string;
  imageProviderId: string;
  imageModelId: string;
}

/** value 约定 `${providerId}::${modelId}`，与旧向导一致；推理排除生图模型，生图要求 imageApiKind。 */
export function modelOptions(providers: ModelOptionSource[], kind: "reasoning" | "image"): ModelOption[] {
  return providers.flatMap((provider) =>
    provider.models
      .filter((model) => (kind === "image" ? Boolean(model.imageApiKind) : !model.imageApiKind))
      .map((model) => ({
        value: `${provider.id}::${model.id}`,
        label: `${provider.name} / ${model.id}`,
        vision: model.supportsVision,
      })),
  );
}

/** 首页一键创建取第一对可用模型；找不到完整一对时返回 null，由调用方引导去设置。 */
export function pickDefaultModels(providers: ModelOptionSource[]): ModelPair | null {
  const reasoning = modelOptions(providers, "reasoning")[0];
  const image = modelOptions(providers, "image")[0];
  if (!reasoning || !image) return null;
  const [reasoningProviderId, reasoningModelId] = reasoning.value.split("::");
  const [imageProviderId, imageModelId] = image.value.split("::");
  if (!reasoningProviderId || !reasoningModelId || !imageProviderId || !imageModelId) return null;
  return { reasoningProviderId, reasoningModelId, imageProviderId, imageModelId };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @ecomgen/web test -- src/lib/modelOptions.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/modelOptions.ts apps/web/src/lib/modelOptions.test.ts
git commit -m "fix(web): 推理模型下拉排除生图模型，抽出 modelOptions/pickDefaultModels"
```

***

### Task 3: 健康检查修复（healthUrl + useHealth + Vite 代理 + MSW）

**Files:**

- Create: `apps/web/src/lib/healthUrl.ts`
- Create: `apps/web/src/lib/healthUrl.test.ts`
- Modify: `apps/web/src/api/hooks/useHealth.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/src/test/msw/handlers.ts`（第 50 行 health handler）

**Interfaces:**

- Consumes: `API_BASE_URL`（`apps/web/src/config/env.ts`）。
- Produces: `healthUrl(apiBaseUrl): string`；`useHealth` 改为原生 fetch。`qk.health` 与 `HealthBadge`（判 `data?.status !== "ok"`）不变。
- [ ] **Step 1: 写失败测试**

`apps/web/src/lib/healthUrl.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { healthUrl } from "./healthUrl";

describe("healthUrl", () => {
  it("绝对 base 取其 origin 下的 /health", () => {
    expect(healthUrl("http://127.0.0.1:8787/api/v1")).toBe("http://127.0.0.1:8787/health");
    expect(healthUrl("http://localhost:8787/api/v1")).toBe("http://localhost:8787/health");
  });

  it("相对 base 返回同源 /health（走 Vite 代理）", () => {
    expect(healthUrl("/api/v1")).toBe("/health");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @ecomgen/web test -- src/lib/healthUrl.test.ts`
Expected: FAIL（Cannot find module ./healthUrl）。

- [ ] **Step 3: 最小实现**

`apps/web/src/lib/healthUrl.ts`：

```ts
/**
 * 后端健康检查挂在服务器根路径 /health（app.ts），不在 /api/v1 前缀下。
 * 相对 base 不能喂给 new URL（浏览器抛错），直接返回同源 /health 由 Vite 代理转发。
 */
export function healthUrl(apiBaseUrl: string): string {
  if (/^https?:\/\//i.test(apiBaseUrl)) return new URL("/health", apiBaseUrl).href;
  return "/health";
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @ecomgen/web test -- src/lib/healthUrl.test.ts`
Expected: PASS。

- [ ] **Step 5: 改写 useHealth**

`apps/web/src/api/hooks/useHealth.ts` 整文件替换为：

```ts
import { useQuery } from "@tanstack/react-query";

import { API_BASE_URL } from "../../config/env";
import { healthUrl } from "../../lib/healthUrl";
import { qk } from "../queryKeys";

/** GET {origin}/health 轮询，顶栏连接指示用；不代表业务数据就绪。 */
export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: async () => {
      const response = await fetch(healthUrl(API_BASE_URL));
      if (!response.ok) throw new Error(`health check failed: ${response.status}`);
      return (await response.json()) as { status: string };
    },
    refetchInterval: 30_000,
    retry: 1,
  });
}
```

- [ ] **Step 6: Vite 增加 /health 代理**

`apps/web/vite.config.ts` 的 `proxy` 改为：

```ts
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
      // 相对 VITE_API_BASE_URL=/api/v1 时，/health 同样需要代理到 API 根路径
      "/health": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
```

- [ ] **Step 7: MSW health handler 改到真实路径**

`apps/web/src/test/msw/handlers.ts` 第 50 行：

```ts
  http.get("http://127.0.0.1:8787/health", () => HttpResponse.json({ status: "ok" })),
```

（`BASE` 常量与其余 handler 不变。）

- [ ] **Step 8: 跑全量 web 测试确认无回归**

Run: `pnpm --filter @ecomgen/web test`
Expected: PASS。首页用例「渲染品牌区、健康指示与设置入口」中 `API 已连接` 仍出现（证明 useHealth 打到了新 MSW handler）。

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/healthUrl.ts apps/web/src/lib/healthUrl.test.ts apps/web/src/api/hooks/useHealth.ts apps/web/vite.config.ts apps/web/src/test/msw/handlers.ts
git commit -m "fix(web): 健康检查打到服务器根路径 /health，相对 base 走 Vite 代理"
```

***

### Task 4: PATCH 项目支持 reasoningModel/imageModel（API）

**Files:**

- Create: `apps/api/src/errors.ts`
- Create: `apps/api/src/projectPatch.ts`
- Create: `apps/api/src/projectPatch.test.ts`
- Modify: `apps/api/src/app.ts`（第 14-15 行类定义移出；第 71-83 行 patch handler）

**Interfaces:**

- Consumes: `verifyModel(repository, providerId, modelId, kind)`（app.ts:143，本任务不改其签名）。
- Produces: `ApiError`（从 `./errors.js` 导入，app.ts 同样改用导入）；`parseModelRef(value, path): { providerId, modelId }`；`applyModelFields(body, update, verify)`。Task 12 的前端 PATCH body 依赖这里的 400/422 语义。
- [ ] **Step 1: 写失败测试**

`apps/api/src/projectPatch.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { ApiError } from "./errors.js";
import { applyModelFields, parseModelRef } from "./projectPatch.js";

describe("parseModelRef", () => {
  it("解析并 trim 合法 ModelRef", () => {
    expect(parseModelRef({ providerId: " p1 ", modelId: " m1 " }, "reasoningModel")).toEqual({
      providerId: "p1",
      modelId: "m1",
    });
  });

  it("拒绝非对象与空字符串", () => {
    expect(() => parseModelRef("x", "reasoningModel")).toThrow(ApiError);
    expect(() => parseModelRef({ providerId: "", modelId: "m" }, "reasoningModel")).toThrow(ApiError);
    expect(() => parseModelRef({ providerId: "p", modelId: 1 }, "imageModel")).toThrow(ApiError);
  });
});

describe("applyModelFields", () => {
  it("写入四个模型字段并按 kind 调 verify", () => {
    const calls: Array<[string, string, "reasoning" | "image"]> = [];
    const update: Record<string, unknown> = {};
    applyModelFields(
      { reasoningModel: { providerId: "p1", modelId: "r1" }, imageModel: { providerId: "p2", modelId: "i1" } },
      update,
      (providerId, modelId, kind) => calls.push([providerId, modelId, kind]),
    );
    expect(update).toEqual({
      reasoningProviderId: "p1",
      reasoningModelId: "r1",
      imageProviderId: "p2",
      imageModelId: "i1",
    });
    expect(calls).toEqual([
      ["p1", "r1", "reasoning"],
      ["p2", "i1", "image"],
    ]);
  });

  it("body 未提供模型字段时不动 update", () => {
    const update: Record<string, unknown> = {};
    applyModelFields({ name: "x" }, update, () => undefined);
    expect(update).toEqual({});
  });

  it("verify 抛出的 ApiError 原样传播（如 422 生图能力缺失）", () => {
    const update: Record<string, unknown> = {};
    const failing = () => {
      throw new ApiError(422, "CAPABILITY_UNSUPPORTED", "Selected image model has no image API configured");
    };
    expect(() => applyModelFields({ imageModel: { providerId: "p", modelId: "m" } }, update, failing)).toThrow(ApiError);
    expect(update).toEqual({});
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @ecomgen/api test`
Expected: FAIL（Cannot find module ./errors.js / ./projectPatch.js）。

- [ ] **Step 3: 抽出 ApiError 并实现 projectPatch**

`apps/api/src/errors.ts`：

```ts
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CAPABILITY_UNSUPPORTED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "PROVIDER_ERROR";

export class ApiError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: Array<{ path: string; reason: string }> = [],
  ) {
    super(message);
  }
}
```

`apps/api/src/projectPatch.ts`：

```ts
import { ApiError } from "./errors.js";

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export type VerifyModel = (providerId: string, modelId: string, kind: "reasoning" | "image") => void;

/** OpenAPI UpdateProjectInput.reasoningModel / imageModel 的 ModelRef 校验。 */
export function parseModelRef(value: unknown, path: string): ModelRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${path} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const { providerId, modelId } = record;
  if (typeof providerId !== "string" || !providerId.trim() || typeof modelId !== "string" || !modelId.trim()) {
    throw new ApiError(400, "VALIDATION_ERROR", `${path} must contain non-empty providerId and modelId`);
  }
  return { providerId: providerId.trim(), modelId: modelId.trim() };
}

/** 把 body 里的 ModelRef 展开为 repository.updateProject 需要的四个列字段；校验语义与创建项目一致。 */
export function applyModelFields(
  body: Record<string, unknown>,
  update: Record<string, unknown>,
  verify: VerifyModel,
): void {
  if (body.reasoningModel !== undefined) {
    const ref = parseModelRef(body.reasoningModel, "reasoningModel");
    verify(ref.providerId, ref.modelId, "reasoning");
    update.reasoningProviderId = ref.providerId;
    update.reasoningModelId = ref.modelId;
  }
  if (body.imageModel !== undefined) {
    const ref = parseModelRef(body.imageModel, "imageModel");
    verify(ref.providerId, ref.modelId, "image");
    update.imageProviderId = ref.providerId;
    update.imageModelId = ref.modelId;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @ecomgen/api test`
Expected: PASS（6 个用例）。

- [ ] **Step 5: 接入 app.ts**

`apps/api/src/app.ts`：

1. 删除第 14-15 行的 `type ApiErrorCode = ...` 与 `class ApiError ...`，顶部加导入：

```ts
import { ApiError } from "./errors.js";
import { applyModelFields } from "./projectPatch.js";
```

1. patch handler（第 71-83 行）在 `if (body.defaultMode !== undefined) ...` 之后、`return repository.updateProject(...)` 之前插入：

```ts
    applyModelFields(body, update, (providerId, modelId, kind) => verifyModel(repository, providerId, modelId, kind));
```

（`repository.updateProject` 已持久化这四个字段，无需改 core。）

- [ ] **Step 6: 构建 + 测试**

Run: `pnpm --filter @ecomgen/api build && pnpm --filter @ecomgen/api test`
Expected: 构建 PASS，测试 PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/errors.ts apps/api/src/projectPatch.ts apps/api/src/projectPatch.test.ts apps/api/src/app.ts
git commit -m "feat(api): PATCH /projects 支持按 ModelRef 更新推理/生图模型"
```

***

### Task 5: core deleteAsset

**Files:**

- Modify: `packages/core/src/repository.ts`（`createAsset` 之后，约第 114 行）
- Modify: `packages/core/src/repository.test.ts`

**Interfaces:**

- Consumes: `mapAsset`（文件底部已有）。
- Produces: `repository.deleteAsset(id): AssetRecord | undefined`（删除并返回被删记录；不存在返回 undefined）。Task 6 的 API handler 依赖。
- [ ] **Step 1: 写失败测试**

在 `packages/core/src/repository.test.ts` 的 `describe` 内追加：

```ts
  it("deletes an asset row and reports missing ids", () => {
    const database = openDatabase(":memory:");
    const repository = new EcomRepository(database);
    const provider = repository.saveProvider({ name: "test", baseUrl: "https://example.test/v1", encryptedApiKey: "encrypted", models: [{ id: "reasoner", supportsVision: true, supportsTools: true, supportsStructuredOutput: true, imageApiKind: null }, { id: "image", supportsVision: false, supportsTools: false, supportsStructuredOutput: false, imageApiKind: "openai_images" }] });
    const project = repository.createProject({ name: "cup", category: null, productDescription: null, verifiedFacts: [], prohibitedClaims: [], brandGuidelines: {}, platformTargets: ["DOMESTIC"], reasoningProviderId: provider.id, reasoningModelId: "reasoner", imageProviderId: provider.id, imageModelId: "image", defaultMode: "CREATIVE" });
    const asset = repository.createAsset({ projectId: project.id, variantId: null, role: "PRODUCT_TRUTH", storagePath: "assets/cup.png", hash: "hash", originalName: "cup.png", mimeType: "image/png", width: null, height: null });
    expect(repository.deleteAsset(asset.id)?.id).toBe(asset.id);
    expect(repository.getAsset(asset.id)).toBeUndefined();
    expect(repository.deleteAsset(asset.id)).toBeUndefined();
    database.close();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @ecomgen/core test`
Expected: FAIL（repository.deleteAsset is not a function）。

- [ ] **Step 3: 最小实现**

`packages/core/src/repository.ts`，`createAsset` 方法后追加（风格与相邻方法一致）：

```ts
  public deleteAsset(id: string): AssetRecord | undefined {
    const row = this.db.prepare("SELECT * FROM assets WHERE id=?").get(id);
    if (!row) return undefined;
    this.db.prepare("DELETE FROM assets WHERE id=?").run(id);
    return mapAsset(row as Row);
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @ecomgen/core test`
Expected: PASS（2 个用例）。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/repository.ts packages/core/src/repository.test.ts
git commit -m "feat(core): repository.deleteAsset 删除素材行并返回被删记录"
```

***

### Task 6: DELETE /assets/{assetId}（OpenAPI + API + 前端 schema 重新生成）

**Files:**

- Modify: `docs/openapi.yaml`（`/assets/{assetId}` 段，第 254-274 行附近）
- Modify: `apps/api/src/app.ts`（assets POST handler 之后，第 96 行附近）
- Modify（生成）: `apps/web/src/api/schema.d.ts`

**Interfaces:**

- Consumes: `repository.getAsset` / `repository.deleteAsset`（Task 5）、`storage.delete(relativePath)`（`LocalAssetStore` 已有，忽略不存在文件）、`missing()` 帮助函数（app.ts:145）。
- Produces: `DELETE /api/v1/assets/:assetId` → 204 / 404，不级联分镜、输出、任务。Task 8 的 `useDeleteAsset` 依赖生成的 schema 类型。
- [ ] **Step 1: OpenAPI 增加 delete 操作**

`docs/openapi.yaml` 的 `/assets/{assetId}` 路径，`patch` 操作之后追加：

```yaml
    delete:
      operationId: deleteAsset
      responses:
        '204': { description: Asset deleted. }
        '404': { $ref: '#/components/responses/NotFound' }
```

- [ ] **Step 2: lint 契约**

Run: `pnpm lint:openapi`
Expected: PASS（无新增 warning/error）。

- [ ] **Step 3: API handler**

`apps/api/src/app.ts`，在 `app.post("/api/v1/projects/:projectId/assets", ...)` 之后追加（风格与相邻 handler 一致）：

```ts
  app.delete("/api/v1/assets/:assetId", async (request, reply) => { const id = parameter(request, "assetId"); const asset = repository.getAsset(id); if (!asset) missing("asset", id); await storage.delete(asset.storagePath); repository.deleteAsset(id); return reply.code(204).send(); });
```

（先删文件再删行：行删了就找不到 storagePath；文件删除失败会 500，不产生"行在文件丢"的半状态。）

- [ ] **Step 4: 构建 API 并重新生成前端 schema**

Run: `pnpm --filter @ecomgen/api build && pnpm --filter @ecomgen/web gen:api`
Expected: 两条都成功；`schema.d.ts` 中 `"/assets/{assetId}"` 出现 `delete: operations["deleteAsset"]`。

- [ ] **Step 5: web 测试确认生成无回归**

Run: `pnpm --filter @ecomgen/web test`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add docs/openapi.yaml apps/api/src/app.ts apps/web/src/api/schema.d.ts
git commit -m "feat(api): DELETE /assets/{assetId} 删除素材行与本地文件"
```

***

### Task 7: serializeAssetForm 字段顺序（修粘贴丢 role）

**Files:**

- Modify: `apps/web/src/api/serializeAssetForm.ts`
- Modify: `apps/web/src/api/serializeAssetForm.test.ts`

**Interfaces:**

- Consumes: 无变化。
- Produces: FormData 中 `role`（及可选 `variantId`）先于 `file` 写入。
- [ ] **Step 1: 写失败测试**

`apps/web/src/api/serializeAssetForm.test.ts` 追加用例：

```ts
  it("role 与 variantId 先于 file 写入", () => {
    const file = new File(["img"], "truth.png", { type: "image/png" });
    const form = serializeAssetForm({ file, role: "PRODUCT_TRUTH", variantId: "variant-1" });
    expect(Array.from(form.keys())).toEqual(["role", "variantId", "file"]);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @ecomgen/web test -- src/api/serializeAssetForm.test.ts`
Expected: FAIL（实际顺序是 `["file", "role", "variantId"]`）。

- [ ] **Step 3: 调整写入顺序**

`apps/web/src/api/serializeAssetForm.ts` 整文件替换：

```ts
import type { AssetRole } from "./adapters/projectDetail";

export function serializeAssetForm(input: {
  file: File;
  role: AssetRole;
  variantId?: string | null;
}): FormData {
  const form = new FormData();
  // 字段必须先于 file：Fastify multipart 的 request.file() 解析第一个 part，
  // file 在前时 handler 读 data.fields.role 会得到 undefined（契约报 role 非空校验失败）。
  form.append("role", input.role);
  if (input.variantId) form.append("variantId", input.variantId);
  form.append("file", input.file);
  return form;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @ecomgen/web test -- src/api/serializeAssetForm.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/serializeAssetForm.ts apps/web/src/api/serializeAssetForm.test.ts
git commit -m "fix(web): 上传 FormData 先写 role/variantId 再写 file，避免 multipart 丢 role"
```

***

### Task 8: useUpdateProject / useDeleteAsset hooks + MSW

**Files:**

- Modify: `apps/web/src/api/adapters/projectDetail.ts`（类型导出区，第 13-14 行附近）
- Modify: `apps/web/src/api/hooks/useProjects.ts`
- Modify: `apps/web/src/api/hooks/useAssets.ts`
- Modify: `apps/web/src/test/msw/handlers.ts`

**Interfaces:**

- Consumes: `UpdateProjectInput`（schema.d.ts 第 546 行已有）；Task 6 生成的 `deleteAsset` 操作类型。
- Produces: `useUpdateProject(projectId)` → mutation `(body: UpdateProjectInput) => Project`；`useDeleteAsset()` → mutation `({ assetId, projectId }) => void`。Task 9-12 依赖。
- [ ] **Step 1: 导出 UpdateProjectInput 类型**

`apps/web/src/api/adapters/projectDetail.ts` 在 `export type CreateProjectInput = ...` 旁加：

```ts
export type UpdateProjectInput = components["schemas"]["UpdateProjectInput"];
```

- [ ] **Step 2: useUpdateProject**

`apps/web/src/api/hooks/useProjects.ts`：第 3 行导入改为：

```ts
import { adaptProject, adaptProjectDetail, type CreateProjectInput, type UpdateProjectInput } from "../adapters/projectDetail";
```

文件末尾追加：

```ts
export function useUpdateProject(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProjectInput) =>
      unwrap(
        api.PATCH("/projects/{projectId}", { params: { path: { projectId: projectId! } }, body }),
      ),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: qk.project(project.id) });
      void queryClient.invalidateQueries({ queryKey: qk.projects });
    },
  });
}
```

- [ ] **Step 3: useDeleteAsset**

`apps/web/src/api/hooks/useAssets.ts`：顶部 `useQueryClient` 已有导入，文件末尾追加：

```ts
/** 204 无响应体，不经过 unwrap；成功后由调用方 invalidate 项目详情。 */
export function useDeleteAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, projectId }: { assetId: string; projectId: string }) => {
      await api.DELETE("/assets/{assetId}", { params: { path: { assetId } } });
    },
    onSuccess: (_result, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}
```

- [ ] **Step 4: MSW handlers**

`apps/web/src/test/msw/handlers.ts`，在 `http.get(\`${BASE}/projects/:projectId\`, ...)\` 之后追加：

```ts
  http.patch(`${BASE}/projects/:projectId`, async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...PROJECT_FIXTURE, id: params.projectId as string, ...body });
  }),

  http.delete(`${BASE}/assets/:assetId`, () => new HttpResponse(null, { status: 204 })),
```

- [ ] **Step 5: 类型检查 + 全量 web 测试**

Run: `pnpm --filter @ecomgen/web build && pnpm --filter @ecomgen/web test`
Expected: 构建与测试均 PASS（hooks 尚无消费者，靠 tsc 验证类型）。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/adapters/projectDetail.ts apps/web/src/api/hooks/useProjects.ts apps/web/src/api/hooks/useAssets.ts apps/web/src/test/msw/handlers.ts
git commit -m "feat(web): useUpdateProject / useDeleteAsset hooks 与 MSW mock"
```

***

### Task 9: 首页一键创建 + 删除向导

**Files:**

- Modify: `apps/web/src/features/home/HomePage.tsx`
- Modify: `apps/web/src/features/home/home.test.tsx`
- Delete: `apps/web/src/features/projects/CreateProjectWizard.tsx`
- Delete: `apps/web/src/features/projects/wizard.module.css`

**Interfaces:**

- Consumes: `pickDefaultModels`（Task 2）、`useCreateProject`、`useProviders`。
- Produces: 首页「新建项目」一键创建并跳 `/projects/:id?stage=assets`；无可用模型对时打开 SettingsDrawer 并 toast，不 POST。`CreateProjectWizard` 彻底移除。
- [ ] **Step 1: 重写失败测试**

`apps/web/src/features/home/home.test.tsx`：删除用例「创建向导提交项目并带上所选模板」（第 36-63 行），替换为以下两个用例（`fireEvent` 不需要，新增导入 `Route, Routes` 自 `react-router`、`useParams` 自 `react-router`）：

```tsx
function ProjectRouteProbe() {
  const { projectId } = useParams();
  return <div>工作台占位 {projectId}</div>;
}

describe("首页 · 一键创建", () => {
  it("点击新建项目直接 POST 默认值并跳转工作台", async () => {
    const user = userEvent.setup();
    let captured: unknown;
    server.use(
      http.post(`${BASE}/projects`, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ ...PROJECT_FIXTURE, name: "未命名项目" }, { status: 201 });
      }),
    );

    renderWithProviders(
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/projects/:projectId" element={<ProjectRouteProbe />} />
      </Routes>,
    );

    await user.click(await screen.findByRole("button", { name: /新建项目/ }));

    await waitFor(() => {
      expect(captured).toMatchObject({
        name: "未命名项目",
        platformTargets: ["DOMESTIC"],
        defaultMode: "CREATIVE",
        reasoningModelId: "gpt-4o",
        imageModelId: "gpt-image-1",
      });
    });
    expect(await screen.findByText(/工作台占位/)).toBeInTheDocument();
  });

  it("无可用模型对时打开设置且不创建项目", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${BASE}/providers`, () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    let posted = false;
    server.use(
      http.post(`${BASE}/projects`, () => {
        posted = true;
        return HttpResponse.json(PROJECT_FIXTURE, { status: 201 });
      }),
    );

    renderWithProviders(<HomePage />);

    await user.click(await screen.findByRole("button", { name: /新建项目/ }));

    expect(await screen.findByText("设置 · Provider")).toBeInTheDocument();
    expect(posted).toBe(false);
  });
});
```

（`describe("首页 · 项目画廊", ...)` 里的两个原用例保持不变，新的 describe 追加在文件末尾。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @ecomgen/web test -- src/features/home/home.test.tsx`
Expected: FAIL（点击新建项目无 POST / 无跳转）。

- [ ] **Step 3: 改 HomePage**

`apps/web/src/features/home/HomePage.tsx`：

1. 导入改为：`import { App, Button } from "antd";`，新增：

```tsx
import { useNavigate } from "react-router";
import { useCreateProject, useProjects } from "../../api/hooks/useProjects";
import { useProviders } from "../../api/hooks/useProviders";
import { pickDefaultModels } from "../../lib/modelOptions";
```

1. 删除 `import { CreateProjectWizard } from "../projects/CreateProjectWizard";`。
2. 组件体：删除 `wizardOpen` state，新增创建逻辑：

```tsx
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { notification } = App.useApp();
  const navigate = useNavigate();
  const projects = useProjects();
  const providers = useProviders();
  const createProject = useCreateProject();
  const items = projects.data?.items ?? [];
  const empty = !projects.isPending && items.length === 0;

  /** 一键创建：模型齐全才 POST，缺一对就引导去设置，不产生半成品项目。 */
  const create = async () => {
    const pair = pickDefaultModels(providers.data?.items ?? []);
    if (!pair) {
      notification.warning({ title: "请先配置 Provider", description: "需要至少一个推理模型和一个生图模型。" });
      setSettingsOpen(true);
      return;
    }
    try {
      const project = await createProject.mutateAsync({
        name: "未命名项目",
        category: null,
        productDescription: null,
        verifiedFacts: [],
        prohibitedClaims: [],
        platformTargets: ["DOMESTIC"],
        defaultMode: "CREATIVE",
        ...pair,
      });
      void navigate(`/projects/${project.id}?stage=assets`);
    } catch (error) {
      notification.error({ title: "创建失败", description: errorText(error) });
    }
  };
```

1. 新建项目按钮：

```tsx
            <Button
              type="primary"
              size="large"
              icon={<Plus size={16} strokeWidth={1.75} />}
              loading={createProject.isPending}
              disabled={providers.isPending}
              onClick={() => void create()}
            >
              新建项目
            </Button>
```

1. 删除 JSX 末尾的 `<CreateProjectWizard ... />`。

- [ ] **Step 4: 删除向导文件**

```bash
git rm apps/web/src/features/projects/CreateProjectWizard.tsx apps/web/src/features/projects/wizard.module.css
```

（`grep -r "CreateProjectWizard\|wizard.module" apps/web/src` 应只剩空结果。）

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @ecomgen/web test -- src/features/home/home.test.tsx`
Expected: PASS（4 个用例：2 旧 + 2 新）。

- [ ] **Step 6: 全量 web 测试 + 构建**

Run: `pnpm --filter @ecomgen/web test && pnpm --filter @ecomgen/web build`
Expected: PASS（向导无其他引用）。

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): 首页一键创建项目直进工作台，移除三步向导"
```

***

### Task 10: 素材卡片删除 + 剪贴板粘贴

**Files:**

- Modify: `apps/web/src/features/workbench/AssetsStage.tsx`
- Modify: `apps/web/src/features/workbench/workbench.module.css`
- Modify: `apps/web/src/features/workbench/workbench.test.tsx`

**Interfaces:**

- Consumes: `useDeleteAsset`（Task 8）、`useUploadAsset`。
- Produces: `AssetCard` 带 Popconfirm 删除按钮；AssetsStage 挂 `document` paste 监听。
- [ ] **Step 1: 写失败测试**

`apps/web/src/features/workbench/workbench.test.tsx`：导入区加 `fireEvent`（自 `@testing-library/react`）与 `ASSET_ID`（自 fixtures，替换现有 `PROJECT_ID` 导入为 `ASSET_ID, PROJECT_ID`）。`describe("工作台 · 素材阶段")` 内追加：

```tsx
  it("确认删除素材时调用 DELETE /assets/:id", async () => {
    const user = userEvent.setup();
    let deleted: string | null = null;
    server.use(
      http.delete(`${BASE}/assets/:assetId`, ({ params }) => {
        deleted = params.assetId as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWorkbench();
    await screen.findByRole("heading", { name: "无线耳机 SPU" });
    await user.click(screen.getByRole("button", { name: /^删除素材/ }));
    await user.click(await screen.findByRole("button", { name: "删除" }));
    await waitFor(() => expect(deleted).toBe(ASSET_ID));
  });

  it("粘贴图片时按当前角色上传且 role 先于 file", async () => {
    let capturedForm: FormData | null = null;
    server.use(
      http.post(`${BASE}/projects/:projectId/assets`, async ({ request }) => {
        capturedForm = await request.formData();
        return HttpResponse.json(ASSET_FIXTURE);
      }),
    );
    renderWorkbench();
    await screen.findByRole("heading", { name: "无线耳机 SPU" });

    const file = new File(["img"], "paste.png", { type: "image/png" });
    fireEvent.paste(document.body, { clipboardData: { files: [file] } });

    await waitFor(() => {
      expect(capturedForm?.get("role")).toBe("PRODUCT_TRUTH");
    });
    expect(Array.from(capturedForm!.keys())[0]).toBe("role");
    expect(capturedForm!.get("file")).toBeInstanceOf(File);
  });
```

顶部 fixtures 导入改为：

```tsx
import { ASSET_FIXTURE, ASSET_ID, PROJECT_ID, projectDetailPayload } from "../../test/msw/fixtures";
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @ecomgen/web test -- src/features/workbench/workbench.test.tsx`
Expected: FAIL（找不到删除按钮 / paste 无上传）。

- [ ] **Step 3: 实现**

`apps/web/src/features/workbench/AssetsStage.tsx`：

1. 导入区调整：

```tsx
import { App, Image, Popconfirm, Select } from "antd";
import { ShieldCheck, Trash2, Upload as UploadIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from "react";
import { useDeleteAsset, useUploadAsset } from "../../api/hooks/useAssets";
```

1. `AssetsStage` 组件体：`upload` 之后加 `const removeAsset = useDeleteAsset();`；把 `sendFiles` 拆出 `uploadFiles`，并加 paste 监听：

```tsx
  const uploadFiles = (images: File[]) => {
    for (const file of images) {
      void upload
        .mutateAsync({
          projectId: detail.id,
          file,
          role,
          variantId: owner === COMMON_OWNER ? null : owner,
        })
        .catch((error: unknown) => {
          notification.error({ title: "上传失败", description: errorText(error) });
        });
    }
  };

  const sendFiles = (files: FileList | File[]) => {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      notification.error({ title: "只支持图片文件" });
      return;
    }
    uploadFiles(images);
  };

  /** 粘贴上传：剪贴板文件常见无 MIME，空类型也按当前 role 上传，由后端兜底校验。 */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const images = Array.from(event.clipboardData?.files ?? []).filter(
        (file) => file.type.startsWith("image/") || file.type === "",
      );
      if (images.length === 0) return;
      event.preventDefault();
      uploadFiles(images);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });
```

（`uploadFiles` 闭包依赖 role/owner，effect 不带依赖数组即可每次渲染重挂监听，保证取到最新值。）

1. 删除回调与卡片传参：

```tsx
  const onDelete = (asset: Asset) => {
    void removeAsset.mutateAsync({ assetId: asset.id, projectId: detail.id }).catch((error: unknown) => {
      notification.error({ title: "删除失败", description: errorText(error) });
    });
  };
```

卡片渲染处传 `onDelete={() => onDelete(asset)}`。

1. `AssetCard` 签名与缩略图容器改为：

```tsx
function AssetCard({
  asset,
  variantName,
  showShield,
  onDelete,
}: {
  asset: Asset;
  variantName?: string;
  showShield: boolean;
  onDelete: () => void;
}) {
  return (
    <article className={styles.assetCard}>
      <div className={styles.thumbWrap}>
        <Image
          src={asset.url}
          alt={ASSET_ROLE_META[asset.role].label}
          className={styles.thumb}
          loading="lazy"
        />
        {showShield ? <ShieldCheck className={styles.shield} size={16} strokeWidth={1.75} aria-label="像素保护素材" /> : null}
        <Popconfirm title="删除这张素材？" okText="删除" cancelText="取消" onConfirm={onDelete}>
          <button type="button" className={styles.assetDelete} aria-label={`删除素材 ${asset.originalName}`}>
            <Trash2 size={14} strokeWidth={1.75} aria-hidden />
          </button>
        </Popconfirm>
      </div>
      {/* assetMeta 部分保持不变 */}
```

`apps/web/src/features/workbench/workbench.module.css` 在 `.shield` 之后追加：

```css
.assetDelete {
  position: absolute;
  bottom: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--line-1);
  border-radius: var(--radius-s);
  background: color-mix(in srgb, var(--bg-0) 85%, transparent);
  color: var(--text-2);
  cursor: pointer;
}

.assetDelete:hover {
  color: var(--danger);
  border-color: var(--danger);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @ecomgen/web test -- src/features/workbench/workbench.test.tsx`
Expected: PASS（5 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workbench/AssetsStage.tsx apps/web/src/features/workbench/workbench.module.css apps/web/src/features/workbench/workbench.test.tsx
git commit -m "feat(web): 素材卡片删除与剪贴板粘贴上传"
```

***

### Task 11: 工作台左栏 ProjectMetaPanel（名称/平台/模式）

**Files:**

- Create: `apps/web/src/features/workbench/ProjectMetaPanel.tsx`
- Modify: `apps/web/src/features/workbench/WorkbenchPage.tsx`（左栏 aside，第 108-115 行）
- Modify: `apps/web/src/features/workbench/workbench.module.css`
- Modify: `apps/web/src/features/workbench/workbench.test.tsx`

**Interfaces:**

- Consumes: `useUpdateProject`（Task 8）、`UpdateProjectInput`（Task 8 导出）。
- Produces: `ProjectMetaPanel({ detail })`；左栏名称失焦 PATCH、平台/模式点击即 PATCH。顶栏 `projectName` / `ModeBadge` 已跟随 project query，无需改。
- [ ] **Step 1: 写失败测试**

`workbench.test.tsx` 导入区加 `fireEvent`（Task 10 已加）与 `PROVIDER_ID`（fixtures）。追加 describe：

```tsx
describe("工作台 · 左栏编辑", () => {
  it("名称失焦提交，平台与模式点击即提交", async () => {
    const user = userEvent.setup();
    const patches: Record<string, unknown>[] = [];
    server.use(
      http.patch(`${BASE}/projects/:projectId`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patches.push(body);
        return HttpResponse.json({ ...PROJECT_FIXTURE, ...body });
      }),
    );
    renderWorkbench();

    const nameInput = await screen.findByLabelText("项目名称");
    await user.clear(nameInput);
    await user.type(nameInput, "新名字");
    fireEvent.blur(nameInput);
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ name: "新名字" }));

    await user.click(screen.getByRole("button", { name: "Amazon" }));
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ platformTargets: ["DOMESTIC", "AMAZON"] }));

    await user.click(screen.getByRole("button", { name: /像素保护/ }));
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ defaultMode: "PIXEL_PROTECTED" }));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @ecomgen/web test -- src/features/workbench/workbench.test.tsx`
Expected: FAIL（找不到 label 项目名称）。

- [ ] **Step 3: 实现 ProjectMetaPanel**

`apps/web/src/features/workbench/ProjectMetaPanel.tsx`：

```tsx
import { App, Input } from "antd";
import { ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import type { ProjectDetail, UpdateProjectInput } from "../../api/adapters/projectDetail";
import { useUpdateProject } from "../../api/hooks/useProjects";
import { errorText } from "../../lib/errorText";
import styles from "./workbench.module.css";

type Mode = ProjectDetail["defaultMode"];
type Platform = ProjectDetail["platformTargets"][number];

/** 左栏 SPU 元数据：文本失焦保存，点选类即时保存；失败 toast 不回写假成功。 */
export function ProjectMetaPanel({ detail }: { detail: ProjectDetail }) {
  const { notification } = App.useApp();
  const updateProject = useUpdateProject(detail.id);
  const [name, setName] = useState(detail.name);

  useEffect(() => setName(detail.name), [detail.name]);

  const save = async (body: UpdateProjectInput, failureTitle: string) => {
    try {
      await updateProject.mutateAsync(body);
    } catch (error) {
      notification.error({ title: failureTitle, description: errorText(error) });
    }
  };

  const commitName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === detail.name) {
      setName(detail.name);
      return;
    }
    await save({ name: trimmed }, "保存名称失败");
  };

  const togglePlatform = (platform: Platform) => {
    const exists = detail.platformTargets.includes(platform);
    const next = exists
      ? detail.platformTargets.filter((item) => item !== platform)
      : [...detail.platformTargets, platform];
    if (next.length === 0) return;
    void save({ platformTargets: next }, "保存平台失败");
  };

  const setMode = (mode: Mode) => {
    if (mode === detail.defaultMode) return;
    void save({ defaultMode: mode }, "保存模式失败");
  };

  return (
    <div>
      <p className={styles.sectionTitle}>SPU</p>
      <Input
        aria-label="项目名称"
        className={styles.nameInput}
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void commitName()}
      />
      <div className={styles.platformRow} role="group" aria-label="目标平台">
        <button
          type="button"
          data-active={detail.platformTargets.includes("DOMESTIC")}
          onClick={() => togglePlatform("DOMESTIC")}
        >
          国内平台
        </button>
        <button
          type="button"
          data-active={detail.platformTargets.includes("AMAZON")}
          onClick={() => togglePlatform("AMAZON")}
        >
          Amazon
        </button>
      </div>
      <div className={styles.modeRow} role="group" aria-label="默认模式">
        <button type="button" data-active={detail.defaultMode === "CREATIVE"} onClick={() => setMode("CREATIVE")}>
          <Sparkles size={16} strokeWidth={1.75} aria-hidden />
          <strong>创意模式</strong>
          <span>语义一致，允许场景创作</span>
        </button>
        <button
          type="button"
          data-active={detail.defaultMode === "PIXEL_PROTECTED"}
          onClick={() => setMode("PIXEL_PROTECTED")}
        >
          <ShieldCheck size={16} strokeWidth={1.75} aria-hidden />
          <strong>像素保护</strong>
          <span>保留主体像素，仅生成外部</span>
        </button>
      </div>
    </div>
  );
}
```

`workbench.module.css` 在 `.spuMeta` 之后追加（自被删除的 `wizard.module.css` 平移，保持视觉不变）：

```css
.nameInput {
  margin-bottom: 12px;
}

.platformRow,
.modeRow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.platformRow {
  margin-bottom: 10px;
}

.platformRow button,
.modeRow button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--line-1);
  border-radius: var(--radius-m);
  background: var(--bg-2);
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
  font: inherit;
}

.platformRow button[data-active="true"],
.modeRow button[data-active="true"] {
  border-color: var(--accent-line);
  background: var(--accent-subtle);
  color: var(--text-1);
}

.modeRow strong {
  color: var(--text-1);
  font-weight: 500;
}

.modeRow span {
  font-size: 12px;
  color: var(--text-3);
}
```

- [ ] **Step 4: 接入 WorkbenchPage**

`WorkbenchPage.tsx` 左栏 aside 替换为：

```tsx
        <aside className={styles.left}>
          <ProjectMetaPanel detail={detail} />
          <VariantPanel projectId={detail.id} variants={detail.variants} />
        </aside>
```

并在文件导入区加 `import { ProjectMetaPanel } from "./ProjectMetaPanel";`。`platforms` 变量（第 88 行）与 `styles.spuName`/`styles.spuMeta` 的使用随替换删除（若无其他引用，同步删掉 CSS 中 `.spuName`/`.spuMeta`）。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @ecomgen/web test -- src/features/workbench/workbench.test.tsx`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/workbench/ProjectMetaPanel.tsx apps/web/src/features/workbench/WorkbenchPage.tsx apps/web/src/features/workbench/workbench.module.css apps/web/src/features/workbench/workbench.test.tsx
git commit -m "feat(web): 工作台左栏可编辑项目名称、平台与默认模式"
```

***

### Task 12: 工作台右栏 ProjectInspector（描述/事实/禁止宣称/模型）

**Files:**

- Create: `apps/web/src/features/workbench/ProjectInspector.tsx`
- Modify: `apps/web/src/features/workbench/WorkbenchPage.tsx`（右栏非分镜分支，第 150-157 行）
- Modify: `apps/web/src/features/workbench/workbench.module.css`
- Modify: `apps/web/src/features/workbench/workbench.test.tsx`

**Interfaces:**

- Consumes: `useUpdateProject`（Task 8）、`modelOptions`（Task 2）、`useProviders`。
- Produces: `ProjectInspector({ detail })`；文本失焦保存、模型 Select 即时保存（`reasoningModel` / `imageModel` ModelRef body）。图片类型不进检视（保持 PlanStage 独占）。
- [ ] **Step 1: 写失败测试**

`workbench.test.tsx` 导入区加 `within`（自 `@testing-library/react`）。追加 describe：

```tsx
describe("工作台 · 右栏检视", () => {
  it("描述失焦保存，推理模型下拉不含生图模型且切换即 PATCH", async () => {
    const user = userEvent.setup();
    const patches: Record<string, unknown>[] = [];
    server.use(
      http.patch(`${BASE}/projects/:projectId`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patches.push(body);
        return HttpResponse.json({ ...PROJECT_FIXTURE, ...body });
      }),
    );
    renderWorkbench("plan");

    const textarea = await screen.findByLabelText("商品描述");
    await user.clear(textarea);
    await user.type(textarea, "不锈钢保温杯");
    fireEvent.blur(textarea);
    await waitFor(() => expect(patches.at(-1)).toMatchObject({ productDescription: "不锈钢保温杯" }));

    const combobox = screen.getAllByRole("combobox")[0]!;
    await user.click(combobox);
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByTitle("OpenAI 官方 / gpt-4o")).toBeInTheDocument();
    expect(within(listbox).queryByTitle("OpenAI 官方 / gpt-image-1")).not.toBeInTheDocument();

    await user.click(within(listbox).getByTitle("OpenAI 官方 / gpt-4o"));
    await waitFor(() =>
      expect(patches.at(-1)).toMatchObject({ reasoningModel: { providerId: PROVIDER_ID, modelId: "gpt-4o" } }),
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @ecomgen/web test -- src/features/workbench/workbench.test.tsx`
Expected: FAIL（找不到 label 商品描述）。

- [ ] **Step 3: 实现 ProjectInspector**

`apps/web/src/features/workbench/ProjectInspector.tsx`：

```tsx
import { App, Input, Select } from "antd";
import { useEffect, useState } from "react";

import type { ProjectDetail, UpdateProjectInput } from "../../api/adapters/projectDetail";
import { useProviders } from "../../api/hooks/useProviders";
import { useUpdateProject } from "../../api/hooks/useProjects";
import { errorText } from "../../lib/errorText";
import { modelOptions } from "../../lib/modelOptions";
import styles from "./workbench.module.css";

function toLines(value: string[] | null | undefined): string {
  return (value ?? []).join("\n");
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 右栏检视（非分镜步）：文本失焦保存，模型下拉即时保存；REST 是状态真相，refetch 后回显服务端值。 */
export function ProjectInspector({ detail }: { detail: ProjectDetail }) {
  const { notification } = App.useApp();
  const updateProject = useUpdateProject(detail.id);
  const providers = useProviders();
  const reasoningOptions = modelOptions(providers.data?.items ?? [], "reasoning");
  const imageOptions = modelOptions(providers.data?.items ?? [], "image");

  const [description, setDescription] = useState(detail.productDescription ?? "");
  const [facts, setFacts] = useState(toLines(detail.verifiedFacts));
  const [claims, setClaims] = useState(toLines(detail.prohibitedClaims));

  useEffect(() => {
    setDescription(detail.productDescription ?? "");
    setFacts(toLines(detail.verifiedFacts));
    setClaims(toLines(detail.prohibitedClaims));
  }, [detail.productDescription, detail.verifiedFacts, detail.prohibitedClaims]);

  const save = async (body: UpdateProjectInput, failureTitle: string) => {
    try {
      await updateProject.mutateAsync(body);
    } catch (error) {
      notification.error({ title: failureTitle, description: errorText(error) });
    }
  };

  const commitDescription = () => {
    const next = description.trim();
    if (next === (detail.productDescription ?? "")) return;
    void save({ productDescription: next || null }, "保存描述失败");
  };
  const commitFacts = () => {
    if (facts === toLines(detail.verifiedFacts)) return;
    void save({ verifiedFacts: splitLines(facts) }, "保存事实失败");
  };
  const commitClaims = () => {
    if (claims === toLines(detail.prohibitedClaims)) return;
    void save({ prohibitedClaims: splitLines(claims) }, "保存禁止宣称失败");
  };

  const reasoningKey = `${detail.reasoningProviderId}::${detail.reasoningModelId}`;
  const imageKey = `${detail.imageProviderId}::${detail.imageModelId}`;
  const splitKey = (value: string) => {
    const [providerId, modelId] = value.split("::");
    return { providerId: providerId!, modelId: modelId! };
  };

  return (
    <div className={styles.inspector}>
      <p className={styles.sectionTitle}>检视</p>
      <label className={styles.fieldLabel}>
        商品描述
        <Input.TextArea
          aria-label="商品描述"
          rows={3}
          maxLength={400}
          value={description}
          placeholder="只写可核验事实，不要写疗效或未证实规格"
          onChange={(event) => setDescription(event.target.value)}
          onBlur={commitDescription}
        />
      </label>
      <label className={styles.fieldLabel}>
        已核验事实（每行一条）
        <Input.TextArea
          aria-label="已核验事实"
          rows={3}
          value={facts}
          placeholder="每行一条，例如：续航 8 小时"
          onChange={(event) => setFacts(event.target.value)}
          onBlur={commitFacts}
        />
      </label>
      <label className={styles.fieldLabel}>
        禁止宣称（每行一条）
        <Input.TextArea
          aria-label="禁止宣称"
          rows={2}
          value={claims}
          placeholder="每行一条，例如：医用级"
          onChange={(event) => setClaims(event.target.value)}
          onBlur={commitClaims}
        />
      </label>
      <label className={styles.fieldLabel}>
        推理模型
        <Select
          aria-label="推理模型"
          style={{ width: "100%", marginTop: 6 }}
          value={reasoningOptions.some((item) => item.value === reasoningKey) ? reasoningKey : undefined}
          options={reasoningOptions}
          placeholder="选择推理模型"
          onChange={(value) => void save({ reasoningModel: splitKey(value) }, "保存推理模型失败")}
        />
      </label>
      <label className={styles.fieldLabel}>
        生图模型
        <Select
          aria-label="生图模型"
          style={{ width: "100%", marginTop: 6 }}
          value={imageOptions.some((item) => item.value === imageKey) ? imageKey : undefined}
          options={imageOptions}
          placeholder="仅列出含 imageApiKind 的模型"
          onChange={(value) => void save({ imageModel: splitKey(value) }, "保存生图模型失败")}
        />
      </label>
    </div>
  );
}
```

`workbench.module.css` 在 `.inspector p` 规则附近追加：

```css
.fieldLabel {
  display: block;
  margin-bottom: 12px;
  color: var(--text-3);
  font-size: 12px;
}
```

- [ ] **Step 4: 接入 WorkbenchPage**

`WorkbenchPage.tsx` 右栏 else 分支替换为：

```tsx
            <ProjectInspector detail={detail} />
```

并加 `import { ProjectInspector } from "./ProjectInspector";`。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @ecomgen/web test -- src/features/workbench/workbench.test.tsx`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/workbench/ProjectInspector.tsx apps/web/src/features/workbench/WorkbenchPage.tsx apps/web/src/features/workbench/workbench.module.css apps/web/src/features/workbench/workbench.test.tsx
git commit -m "feat(web): 右栏检视可编辑描述、事实、禁止宣称与模型"
```

***

### Task 13: 总验证

**Files:**

- 无新改动（只跑命令；发现回归回到对应任务修复后重跑）。
- [ ] **Step 1: 全量构建**

Run: `pnpm build`
Expected: 所有包构建 PASS。

- [ ] **Step 2: 全量测试**

Run: `pnpm test`
Expected: 全部 PASS。

- [ ] **Step 3: OpenAPI lint**

Run: `pnpm lint:openapi`
Expected: PASS。

- [ ] **Step 4: 手动冒烟（可选但推荐）**

Run: `pnpm dev`
手动走查：首页徽标「API 已连接」→ 新建项目直进工作台 → 左栏改名/切模式 → 右栏改描述与模型 → 素材页拖入/粘贴/删除图片。完成后 Ctrl+C。

- [ ] **Step 5: 如有修复，提交**

```bash
git add -A
git commit -m "fix: 总验证回归修复"
```

