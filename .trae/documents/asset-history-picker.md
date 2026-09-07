# 历史上传选择功能（从历史图片快速添加素材）

## 概述

新增跨项目的"历史上传"能力：用户在项目素材阶段打开历史图片选择器，勾选过去任一项目上传过的图片，一键复制为当前项目素材，无需重新上传文件。

## 现状分析（Phase 1 探索结论）

- 上传链路：`POST /api/v1/projects/:projectId/assets`（[app.ts L181-191](file:///e:/project/EcomGen/apps/api/src/app.ts#L181-L191)）接收 multipart，校验图片类型、`kind/role` 解析（`parseAssetRole`，L583）、容量（商品图/参考图各 6 张，`assertProjectAssetCapacity` L638）、项目内 hash 唯一（`assertProjectAssetHashUnique` L647），然后 `storage.putAsset` 落盘到 `assets/{projectId}/{uuid}-{hash}.{ext}`（[files.ts L17-23](file:///e:/project/EcomGen/packages/core/src/files.ts#L17-L23)）并 `createAsset` 建行。
- 资产是项目私有的：`assets` 表 `project_id` 外键 `ON DELETE CASCADE`（[database.ts L194-206](file:///e:/project/EcomGen/packages/core/src/database.ts#L194-L206)）；repository 仅有 `listAssets(projectId)`（[repository.ts L425](file:///e:/project/EcomGen/packages/core/src/repository.ts#L425)），无跨项目查询。
- 删除资产即删物理文件（app.ts L193），删除项目按项目目录清空（`deleteProject`）；因此跨项目复用必须**复制文件**，不能共享 `storage_path`。
- 同构先例：编辑会话 `promote` 端点（[app.ts L405-414](file:///e:/project/EcomGen/apps/api/src/app.ts#L405-L414)）就是"读旧文件 → putAsset 复制 → createAsset"，复用同一套容量/hash 校验——历史上传复制与其完全同构。
- 前端：`AssetsStage.tsx`（WorkbenchPage setup 视图 [WorkbenchPage.tsx L134](file:///e:/project/EcomGen/apps/web/src/features/workbench/WorkbenchPage.tsx#L134)）承载上传（拖/贴/文件选择），`kind` state 区分商品图/参考图；[useAssets.ts](file:///e:/project/EcomGen/apps/web/src/api/hooks/useAssets.ts) 提供 mutation，成功后 invalidate `qk.project(id)`；`adaptAsset` 兜底构造 `/files/assets/{id}` 预览 URL（[assetUrl.ts](file:///e:/project/EcomGen/apps/web/src/lib/assetUrl.ts)），历史项可直接复用。
- 契约流：TypeBox 是唯一手写真相源（`api-schemas.ts`/`api-requests.ts` → `API_SCHEMA_REGISTRY` 自动注册）；`openapi/paths.yaml` 手写路径（请求/响应直接写 `$ref`，如 `createProject`）；`pnpm gen:openapi` 生成 `openapi.yaml`；`apps/web/src/api/schema.d.ts` 由 `pnpm --filter @ecomgen/web gen:api`（openapi-typescript）生成；`pnpm gen:check` 会校验两者不 stale。
- 已有 `AssetList = { items: Asset[], nextCursor }` schema（[api-schemas.ts L73-74](file:///e:/project/EcomGen/packages/contracts/src/api-schemas.ts#L73-L74)）可直接复用为历史列表响应。
- UI 组件库为 antd（Modal 已在 EditImageWorkspace/ReviewStage 使用）+ CSS Module；时间显示复用 `nTime`（[format.ts](file:///e:/project/EcomGen/apps/web/src/lib/format.ts)）。

## 方案设计

### 数据流

1. 打开选择器 → `GET /api/v1/asset-history?excludeProjectId={当前项目id}` → `repository.listAssetHistory`：全部 assets 按 `created_at DESC` 排序，按 hash 去重（保留最新一条），排除当前项目已存在的 hash。
2. 勾选 n 张确认 → 逐张 `POST /api/v1/projects/:projectId/assets/from-history`，body `{ assetId, kind }` → 服务端校验（项目存在、源资产存在、源文件在盘、容量、hash 唯一）→ 读源文件 `putAsset` 复制到当前项目目录 → `createAsset` → 201 返回 `Asset`。
3. 前端 invalidate `qk.project(projectId)` → AssetsStage 素材网格自动刷新。

### 改动清单

#### 1. `packages/contracts/src/api-requests.ts` — 新增复制请求 schema

```ts
export const CopyAssetFromHistoryInput = Type.Object({ assetId: Type.String({ format: "uuid" }), role: Type.Optional(schemaRef(AssetRole)), kind: Type.Optional(schemaRef(UserAssetKind)) }, { $id: "#/components/schemas/CopyAssetFromHistoryInput" });
export type CopyAssetFromHistoryInput = Static<typeof CopyAssetFromHistoryInput>;
```

通过 `...requests` 自动进入 `API_SCHEMA_REGISTRY`，无需改 api-registry.ts。

#### 2. `openapi/paths.yaml` — 新增两个路径

在 `/assets/{assetId}` 段落后新增（请求/响应 `$ref` 直接内联，与 `createProject`/`listAssets` 风格一致，不改 generate-openapi.mjs）：

```yaml
  /asset-history:
    get:
      operationId: listAssetHistory
      parameters:
        - name: excludeProjectId
          in: query
          required: false
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Recently uploaded assets across projects, deduplicated by content hash.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AssetList"
  /projects/{projectId}/assets/from-history:
    parameters:
      - $ref: "#/components/parameters/ProjectId"
    post:
      operationId: copyAssetFromHistory
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CopyAssetFromHistoryInput"
      responses:
        "201":
          description: Asset copied into the project.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Asset"
        "404":
          $ref: "#/components/responses/NotFound"
```

#### 3. `packages/core/src/repository.ts` — 新增跨项目历史查询

在 `listAssets` 附近新增（个人工具量级小，SQL 取全量 + JS 去重，逻辑显然正确且易测）：

```ts
/** 历史上传：跨项目按内容 hash 去重（同图多项目只保留最新一条），按上传时间倒序；
 * excludeProjectId 的项目内已有 hash 一并排除，避免前端选到必然被 hash 唯一性拒绝的图片。 */
public listAssetHistory(excludeProjectId: string | null): AssetRecord[] {
  const excludedHashes = new Set(
    excludeProjectId
      ? (this.db.prepare("SELECT hash FROM assets WHERE project_id=?").all(excludeProjectId) as Row[]).map((row) => String(row.hash))
      : [],
  );
  const seen = new Set<string>();
  const result: AssetRecord[] = [];
  for (const row of this.db.prepare("SELECT * FROM assets ORDER BY created_at DESC, rowid DESC").all() as Row[]) {
    const asset = mapAsset(row);
    if (excludedHashes.has(asset.hash) || seen.has(asset.hash)) continue;
    seen.add(asset.hash);
    result.push(asset);
  }
  return result;
}
```

#### 4. `apps/api/src/app.ts` — 注册两个路由

- import 增加 `CopyAssetFromHistoryInput`（来自 `@ecomgen/contracts`）。
- 在 `DELETE /api/v1/assets/:assetId`（L193）之后注册：

```ts
app.get("/api/v1/asset-history", async (request) => {
  const query = (request.query ?? {}) as Record<string, unknown>;
  const excludeProjectId = typeof query.excludeProjectId === "string" && query.excludeProjectId ? query.excludeProjectId : null;
  return { items: repository.listAssetHistory(excludeProjectId), nextCursor: null };
});
// 复制而非共享 storage_path：DELETE 资产会删物理文件、deleteProject 按项目目录清理，共享路径会互相破坏
app.post("/api/v1/projects/:projectId/assets/from-history", async (request, reply) => {
  const projectId = parameter(request, "projectId"); ensureProject(repository, projectId);
  const body = parseBody(CopyAssetFromHistoryInput, request.body ?? {});
  const source = repository.getAsset(body.assetId); if (!source) missing("asset", body.assetId);
  const role = parseAssetRole(body.kind ?? body.role ?? source.role);
  assertProjectAssetCapacity(repository, projectId, role);
  assertProjectAssetHashUnique(repository, projectId, source.hash);
  if (!(await storage.exists(source.storagePath))) throw new ApiError(404, "NOT_FOUND", "Source asset file is missing");
  const content = await storage.read(source.storagePath);
  const stored = await storage.putAsset(projectId, source.originalName, content);
  return reply.code(201).send(repository.createAsset({ projectId, role, storagePath: stored.path, hash: stored.hash, originalName: source.originalName, mimeType: source.mimeType, width: source.width, height: source.height }));
});
```

校验顺序与 upload/promote 一致：先廉价的 DB 校验，再文件 IO。`kind` 缺省回退 `role`，再缺省回退源资产 role。

#### 5. `apps/web/src/api/queryKeys.ts` — 新增 key

```ts
assetHistory: (excludeProjectId: string) => ["asset-history", { excludeProjectId }] as const,
```

#### 6. `apps/web/src/api/hooks/useAssets.ts` — 新增两个 hook

```ts
export function useAssetHistory(excludeProjectId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.assetHistory(excludeProjectId),
    enabled,
    queryFn: async () => {
      const raw = await unwrap(api.GET("/asset-history", { params: { query: { excludeProjectId } } }));
      return (raw.items ?? []).map(adaptAsset).filter((item): item is Asset => item !== null);
    },
  });
}

export function useCopyAssetFromHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, assetId, kind }: { projectId: string; assetId: string; kind: UserAssetKind }) => {
      const raw = await unwrap(api.POST("/projects/{projectId}/assets/from-history", {
        params: { path: { projectId } },
        body: { assetId, kind },
      }));
      const asset = adaptAsset(raw);
      if (!asset) throw new ApiError({ code: "UNKNOWN", message: "复制响应无法解析", status: 0 });
      return asset;
    },
    onSuccess: (_asset, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}
```

（需补 `useQuery` import 与 `Asset` 类型 import。）

#### 7. `apps/web/src/features/workbench/AssetHistoryDialog.tsx` — 新文件：历史选择器弹窗

- Props：`{ open, projectId, kind, onClose }`（`kind` 为 AssetsStage 当前选中的 `UserAssetKind`）。
- `useAssetHistory(projectId, open)`（仅打开时请求）；`useCopyAssetFromHistory()`。
- antd `Modal`：title "从历史上传选择"，副标题提示"选中的图片将作为{USER_ASSET_KIND_META[kind].label}添加到当前项目"；`okText` 动态为 `添加${n}张`，`okButtonProps={{ disabled: n===0, loading: copying }}`，`onOk` 执行复制，`cancelText="取消"`。
- 内容为网格：每项用原生 `<img loading="lazy">`（不用 antd Image 预览，整卡点击即切换选中态），下方显示 `originalName`（截断 + title）与 `nTime(createdAt)`；选中态用边框/对角勾选标记。
- 多选 state：`Set<string>`，`open` 变化时重置。
- 复制循环：逐张 `mutateAsync`，失败项计数，结束后统一 notification（成功数/失败数），成功则 `onClose()`。
- 空态文案"还没有历史图片"；加载态用 antd `Spin`。

#### 8. `apps/web/src/features/workbench/AssetsStage.tsx` — 接入入口

- 新增 state `historyOpen`；在 dropzone `<label>` 下方新增次级操作按钮（lucide `History` 图标 + "从历史上传选择"），`onClick={() => setHistoryOpen(true)}`；渲染 `<AssetHistoryDialog open={historyOpen} projectId={detail.id} kind={kind} onClose={() => setHistoryOpen(false)} />`。
- 注意按钮必须是 `<label>` 外的独立元素（label 内点击会触发文件选择）。

#### 9. `apps/web/src/features/workbench/workbench.module.css` — 选择器样式

新增 `.historyEntry`（次级按钮行）、`.historyGrid`（`minmax(140px, 1fr)` 网格 + 8px 间距，对齐 `.assetGrid` 既有 token）、`.historyItem`（含 `[data-selected="true"]` 选中态、hover 态）、`.historyCheck`（勾选标记）、`.historyName`/`.historyDate`（截断与次要文字色）。视觉变量沿用文件内既有颜色/圆角约定。

#### 10. `apps/web/src/test/msw/handlers.ts`（及 `fixtures.ts`）— 测试桩

- `http.get(\`${BASE}/asset-history\`, ...)` 返回 `{ items: [ASSET_FIXTURE 派生的历史项], nextCursor: null }`。
- `http.post(\`${BASE}/projects/:projectId/assets/from-history\`, ...)` 返回 201 + ASSET_FIXTURE。

#### 11. 测试

- `packages/core/src/repository.test.ts` 新增用例：`listAssetHistory` 按 hash 去重保留最新、`excludeProjectId` 排除该项目已有 hash、按时间倒序。
- `apps/api/src/app.test.ts` 新增 describe "POST /api/v1/projects/:projectId/assets/from-history"：成功复制（断言 201、目标项目出现新记录、目标项目目录下文件存在、kind=PRODUCT 映射为 PRODUCT_TRUTH）；源资产不存在 404；源文件缺失 404；目标项目已有同 hash 400；商品图满 6 张后 400；省略 kind 时沿用源 role。测试内直接用 `new LocalAssetStore(dataDir)` + repository 造源资产（与 buildApi 共享 dataDir，绕开 multipart 构造）。
- `apps/web/src/features/workbench/workbench.test.tsx` 新增用例：点开"从历史上传选择"→ 列表展示历史项 → 选中并确认 → 发出 POST 且成功通知/弹窗关闭（复用新增 msw handler）。

## 假设与决策

1. **历史范围**：所有项目（含已归档，文件仍有效）的图片，按内容 hash 去重；排除当前项目已有 hash（服务端按 `excludeProjectId` 排除）。当前项目的图片已在素材区可见，重复添加必被 hash 唯一性拒绝，无入选价值。
2. **复制语义**：物理文件复制（`storage.read` → `putAsset`），不共享 `storage_path`。删除资产/删除项目的清理语义保持不变。
3. **kind 来源**：前端随当前 `kind` 传（与上传入口一致）；API 省略时回退 `role`，再回退源资产 role。
4. **不做分页/搜索**：单机个人工具、hash 去重后量级小；响应复用 `AssetList`（`nextCursor: null`），与 `providers`/`search-sources` 列表端点同风格。
5. **不在 Asset 上加 projectName 等展示字段**：选择器以缩略图+文件名+时间为主，避免污染共享 schema。
6. **复制留在 API**：纯本地文件 IO、毫秒级，与 upload 同层级，不进 Worker。
7. **范围仅工作台素材阶段**（AssetsStage）；编辑会话参考图上传不接入历史选择（后续有需求再扩展）。

## 验证步骤

```bash
pnpm gen:openapi                      # 含 contracts build，重生成 openapi.yaml 与 openapi/*.yaml
pnpm --filter @ecomgen/web gen:api    # 重生成 apps/web/src/api/schema.d.ts
pnpm gen:check                        # 确认契约与类型不 stale
pnpm lint:openapi
pnpm build
pnpm test
```

手动验证（`pnpm dev:api` + `pnpm dev:web`）：

1. 项目 A 上传图片 → 新建项目 B 打开"从历史上传选择"→ 能看到 A 的图片，选中添加后 B 素材区出现该图。
2. B 中再次打开选择器 → 该图不再出现（hash 已排除）。
3. 商品图添加至 6 张后再从历史添加 → 报容量错误提示。
4. 删除项目 A（归档后删除）→ 历史列表不再出现 A 的图片；已复制到 B 的文件不受影响。
