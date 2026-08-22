# 图片下载与批量选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为结果区全部图片（含编辑版本）提供可选择的批量 ZIP 下载，并为编辑版本关系画布节点增加单图下载。

**Architecture:** 结果区在 `ReviewStage` 维护 `selectedOutputIds`，每个原图和编辑版本卡片共享选择状态；`ResultsWorkspace` 接收选择回调并把选中 ID 提交给现有导出任务。版本关系画布节点直接复用单图下载工具，不改变后端契约。

**Tech Stack:** React, TypeScript, Ant Design, Vitest, Testing Library, MSW。

## Global Constraints

- API 仍以 `openapi.yaml` 和现有 export-jobs 契约为准。
- 不新增后端接口；批量下载只提交用户明确选择的 output IDs。
- 原图、编辑版本和版本树节点使用现有 `downloadOriginal` 下载流程。
- UI 文案使用简体中文，保持现有工作台样式与图标体系。

### Task 1: 结果区选择与批量下载

**Files:**
- Modify: `apps/web/src/features/workbench/ResultsWorkspace.tsx`
- Modify: `apps/web/src/features/workbench/ReviewStage.tsx`
- Modify: `apps/web/src/features/workbench/workbench.module.css`
- Test: `apps/web/src/features/workbench/export.test.tsx`

**Interfaces:**
- `ReviewStage` produces `selectedOutputIds` and `onSelectionChange` callback data through an added prop callback.
- `ResultsWorkspace.download` consumes the selected ID list and preserves the existing export job mutation.

- [ ] **Step 1: Add failing coverage for selected IDs**
  Extend the export test to render the results workspace, select one original output and one edited output, click the batch button, and assert the POST body contains exactly those two IDs. Add coverage for disabled/empty selection feedback if the UI exposes it.

- [ ] **Step 2: Run the focused test and confirm it fails**
  Run `pnpm --filter @ecomgen/web test -- export.test.tsx`.
  Expected: the new selection test fails because the current toolbar always submits every output.

- [ ] **Step 3: Implement selection state and controls**
  Add checkbox controls to every `ReviewCard` and edited-version card, keep selection IDs in `ReviewStage`, and expose the selected count and select-all/clear-all actions to `ResultsWorkspace`. Keep single-image download buttons independent from selection.

- [ ] **Step 4: Submit only selected IDs**
  Change the toolbar button to call `download(selectedOutputIds)` and disable it when there are no selected IDs. Keep existing ZIP polling and error notifications unchanged.

- [ ] **Step 5: Style and rerun focused tests**
  Add compact checkbox/action styles matching the existing review grid. Run `pnpm --filter @ecomgen/web test -- export.test.tsx` and verify all cases pass.

### Task 2: 编辑版本关系画布下载

**Files:**
- Modify: `apps/web/src/features/workbench/ReviewStage.tsx`
- Modify: `apps/web/src/features/workbench/workbench.module.css`
- Test: `apps/web/src/features/workbench/export.test.tsx`

**Interfaces:**
- `VersionTreeModal` receives an `onDownloadOutput(output)` callback and invokes it from each node action.

- [ ] **Step 1: Add a node download interaction test**
  Open the version tree, click the node download button, mock the image fetch, and assert the download helper path is triggered for the edited output.

- [ ] **Step 2: Run the focused test and confirm it fails**
  Run `pnpm --filter @ecomgen/web test -- export.test.tsx`.
  Expected: the test cannot find a download action on version-tree nodes.

- [ ] **Step 3: Add node-level download action**
  Add a download icon button to each version node, stop pointer propagation so dragging the canvas is unaffected, and generate a stable version label for `outputFileName`.

- [ ] **Step 4: Rerun focused tests**
  Run `pnpm --filter @ecomgen/web test -- export.test.tsx` and verify node download and existing export tests pass.

### Task 3: 全量验证

**Files:**
- No additional files.

- [ ] **Step 1: Run web tests**
  Run `pnpm --filter @ecomgen/web test` and confirm zero failures.

- [ ] **Step 2: Run build**
  Run `pnpm --filter @ecomgen/web build` and confirm TypeScript/Vite compilation succeeds.

- [ ] **Step 3: Review diff for scope**
  Run `git diff --check` and inspect the changed files to ensure no unrelated behavior or generated files were modified.
