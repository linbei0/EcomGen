import { App, Input, Segmented, Select, Tag } from "antd";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { StoryboardItem } from "../../api/adapters/projectDetail";
import type { SuiteSummary } from "../../api/adapters/suites";
import type { EcomTemplate } from "../../api/adapters/templates";
import { useUpdateStoryboardItem, type UpdateStoryboardItemInput } from "../../api/hooks/useStoryboard";
import { useProviders } from "../../api/hooks/useProviders";
import { useSuiteSummaries } from "../../api/hooks/useSuites";
import { errorText } from "../../lib/errorText";
import { factClaimRows } from "../../lib/factClaims";
import { splitSuiteAssetType } from "../../lib/itemName";
import { modelOptions } from "../../lib/modelOptions";
import { RESOLUTION_LABEL, SHOT_ROLE_LABEL } from "../../lib/roles";
import { ASPECT_SELECT_OPTIONS, renderAspectOption } from "./aspectOptions";
import styles from "./workbench.module.css";

const DEBOUNCE_MS = 600;

interface Draft {
  assetType: string;
  displayName: string;
  candidateCount: number;
  imageProviderId: string | undefined;
  imageModelId: string | undefined;
  imageResolution: StoryboardItem["imageResolution"];
  imageAspectRatio: StoryboardItem["imageAspectRatio"];
  mode: StoryboardItem["mode"];
  promptInstruction: string;
}

export function StoryboardInspector({
  projectId,
  item,
  templates,
}: {
  projectId: string;
  item: StoryboardItem;
  /** 内置 + 自定义模板的名称解析列表；inspector 只读 id/name。 */
  templates: readonly Pick<EcomTemplate, "id" | "name">[];
}) {
  const { notification } = App.useApp();
  const update = useUpdateStoryboardItem(projectId);
  const providers = useProviders();
  const persist = update.mutateAsync;
  const [draft, setDraft] = useState<Draft>(toDraft(item));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  // base 是草稿的来源快照；dirty 记录用户真正改过且尚未保存的字段。
  // 后台 refetch 改变 item 时，只同步干净字段，不覆盖未保存的编辑。
  const baseRef = useRef(item);
  const dirtyRef = useRef(new Set<keyof Draft>());
  const itemRef = useRef(item);
  const draftRef = useRef(draft);
  const saveQueue = useRef(Promise.resolve());

  itemRef.current = item;
  draftRef.current = draft;

  /** 把 UI 编辑写入草稿并维护 dirty 集合：改回基线值即视为不再有未保存修改。 */
  const setDraftField = (patch: Partial<Draft>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      for (const key of Object.keys(patch) as Array<keyof Draft>) {
        if (next[key] === baseRef.current[key]) dirtyRef.current.delete(key);
        else dirtyRef.current.add(key);
      }
      return next;
    });
  };

  /** 保存成功后以服务端记录为新基线，按当前草稿重新对齐 dirty 集合（生图模型两个字段作为一个整体）。 */
  const resyncDirty = (saved: StoryboardItem) => {
    baseRef.current = saved;
    const baseline = toDraft(saved);
    const current = draftRef.current;
    for (const key of ["assetType", "displayName", "candidateCount", "imageResolution", "imageAspectRatio", "mode", "promptInstruction"] as const) {
      if (current[key] === baseline[key]) dirtyRef.current.delete(key);
      else dirtyRef.current.add(key);
    }
    const modelDirty = current.imageProviderId !== baseline.imageProviderId || current.imageModelId !== baseline.imageModelId;
    if (modelDirty) { dirtyRef.current.add("imageProviderId"); dirtyRef.current.add("imageModelId"); }
    else { dirtyRef.current.delete("imageProviderId"); dirtyRef.current.delete("imageModelId"); }
  };

  const runSave = () => {
    setSaveState("saving");
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        // 执行时重算补丁：队列里前一次保存会先更新基线，已保存字段不会重复提交
        const body = patchFrom(baseRef.current, dirtyRef.current, draftRef.current);
        if (!body) return;
        const saved = await persist({ itemId: itemRef.current.id, body });
        resyncDirty(saved);
        if (dirtyRef.current.size === 0) setSaveState("saved");
      })
      .catch((error: unknown) => {
        // 保留用户输入，标记失败等待下一次编辑或关闭前的 flush；不静默回滚草稿
        setSaveState("failed");
        notification.error({ title: "分镜未保存", description: errorText(error) });
      });
  };

  useEffect(() => {
    if (dirtyRef.current.size === 0) {
      baseRef.current = item;
      setDraft(toDraft(item));
      setSaveState("idle");
    }
  }, [item]);

  useEffect(() => {
    if (item.status === "GENERATING") return;
    if (dirtyRef.current.size === 0) return;
    const timer = window.setTimeout(runSave, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, item.status]);

  // 卸载（关闭弹窗或切换分镜）时防抖可能尚未到期：立即 flush 未保存字段，避免静默丢失
  const flushRef = useRef(() => {});
  flushRef.current = () => { if (dirtyRef.current.size > 0) runSave(); };
  useEffect(() => () => flushRef.current(), []);

  const claims = factClaimRows(item.factClaims);
  const generationSettingsReadOnly = item.status === "GENERATING";
  const contentReadOnly = generationSettingsReadOnly || item.status === "GENERATED";
  // 来源标签展示的是套图/模板的中文名；套图摘要按 assetType 里的套图 id 回读，未选中套图分镜时不发请求。
  const suiteShot = splitSuiteAssetType(draft.assetType);
  const suiteSummaries = useSuiteSummaries(suiteShot ? [suiteShot.suiteId] : []);
  const suite = suiteShot ? suiteSummaries.data?.find((summary) => summary.id === suiteShot.suiteId) : undefined;
  const sourceTag = sourceTagOf(draft.assetType, templates, suite, suiteShot, suiteSummaries.isPending);
  const imageOptions = modelOptions(providers.data?.items ?? [], "image");
  const imageModelKey = draft.imageProviderId && draft.imageModelId
    ? `${draft.imageProviderId}::${draft.imageModelId}`
    : undefined;

  return (
    <div className={styles.inspector}>
      <p className={styles.saveHint}>
        {generationSettingsReadOnly
          ? "生成中，暂不可修改"
          : item.status === "GENERATED"
            ? saveState === "saving" ? "保存中" : saveState === "saved" ? "已保存" : saveState === "failed" ? "保存失败，可重试编辑" : "已生成，配置仅影响下次生图"
            : saveState === "saving" ? "保存中" : saveState === "saved" ? "已保存" : saveState === "failed" ? "保存失败，可重试编辑" : "编辑后自动保存"}
      </p>

      {sourceTag && sourceTag.label !== draft.displayName ? (
        <div className={styles.assetTypeRow}>
          <Tag className={styles.assetTypeTag} title={sourceTag.hint}>
            {sourceTag.label}
          </Tag>
        </div>
      ) : null}

      <p className={styles.fieldLabel}>模式</p>
      <Segmented
        value={draft.mode}
        disabled={contentReadOnly}
        options={[
          { label: "创意", value: "CREATIVE" },
          { label: "像素保护", value: "PIXEL_PROTECTED" },
        ]}
        onChange={(value) => setDraftField({ mode: value as Draft["mode"] })}
      />
      {draft.mode === "PIXEL_PROTECTED" ? (
        <p className={styles.protectHint}>
          <ShieldCheck size={14} strokeWidth={1.75} aria-hidden />
          使用项目上的产品图，保留主体像素。
        </p>
      ) : null}

      <section className={styles.inspectorSettings} aria-label="生图配置">
        <p className={styles.inspectorSectionTitle}>生图配置</p>
        <div className={styles.inspectorSettingGrid}>
          <label className={styles.fieldLabel}>
            图片比例
            <Select
              aria-label="分镜图片比例"
              value={draft.imageAspectRatio}
              disabled={generationSettingsReadOnly}
              options={ASPECT_SELECT_OPTIONS}
              optionRender={renderAspectOption}
              onChange={(imageAspectRatio) => setDraftField({ imageAspectRatio })}
            />
          </label>
          <label className={styles.fieldLabel}>
            分辨率
            <Select
              aria-label="分镜分辨率"
              value={draft.imageResolution}
              disabled={generationSettingsReadOnly}
              options={Object.entries(RESOLUTION_LABEL).map(([value, label]) => ({ value, label }))}
              onChange={(imageResolution) => setDraftField({ imageResolution })}
            />
          </label>
          <div className={styles.inspectorCandidate}>
            <span>候选数</span>
            <div className={styles.inspectorStepper}>
              <button
                type="button"
                aria-label="减少分镜候选数"
                disabled={generationSettingsReadOnly || draft.candidateCount <= 1}
                onClick={() => setDraftField({ candidateCount: draft.candidateCount - 1 })}
              >
                −
              </button>
              <strong>{draft.candidateCount}</strong>
              <button
                type="button"
                aria-label="增加分镜候选数"
                disabled={generationSettingsReadOnly || draft.candidateCount >= 4}
                onClick={() => setDraftField({ candidateCount: draft.candidateCount + 1 })}
              >
                +
              </button>
            </div>
          </div>
          <label className={styles.fieldLabel}>
            生图模型
            <Select
              aria-label="分镜生图模型"
              value={imageOptions.some((option) => option.value === imageModelKey) ? imageModelKey : undefined}
              disabled={generationSettingsReadOnly}
              options={imageOptions}
              placeholder="选择生图模型"
              onChange={(value) => {
                const [imageProviderId, imageModelId] = value.split("::");
                if (imageProviderId && imageModelId) setDraftField({ imageProviderId, imageModelId });
              }}
            />
          </label>
        </div>
      </section>

      <label className={styles.fieldLabel} htmlFor="item-prompt">
        生图 Prompt
      </label>
      <Input.TextArea
        id="item-prompt"
        className={styles.monoArea}
        value={draft.promptInstruction}
        disabled={contentReadOnly}
        autoSize={{ minRows: 5, maxRows: 12 }}
        onChange={(event) => setDraftField({ promptInstruction: event.target.value })}
      />

      {claims.length > 0 ? (
        <dl className={styles.claimList}>
          {claims.map((row) => (
            <div key={`${row.label}-${row.value}`}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {item.riskFlags.length > 0 ? (
        <ul className={styles.riskList}>
          {item.riskFlags.map((flag) => (
            <li key={flag}>
              <TriangleAlert size={14} strokeWidth={1.75} aria-hidden />
              {flag}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * 来源标签：套图分镜展示套图中文名与分镜角色，单图模板展示模板名。
 * assetType（`<suiteId>::<shotId>` 或模板 id）是内部标识，任何情况下都不作为标签文案；
 * 套图摘要在途时先不渲染，避免先闪出原始 id 再替换。
 */
function sourceTagOf(
  assetType: string,
  templates: readonly Pick<EcomTemplate, "id" | "name">[],
  suite: SuiteSummary | undefined,
  suiteShot: { suiteId: string; shotId: string } | undefined,
  suitePending: boolean,
): { label: string; hint: string } | undefined {
  if (suiteShot) {
    if (!suite) {
      return suitePending ? undefined : { label: "套图分镜", hint: `套图库中已找不到该套图（${assetType}）` };
    }
    const shot = suite.shots.find((entry) => entry.shotId === suiteShot.shotId);
    const role = shot ? SHOT_ROLE_LABEL[shot.shotRole as keyof typeof SHOT_ROLE_LABEL] : undefined;
    const shotLabel = shot ? [role, shot.displayName].filter(Boolean).join("：") : undefined;
    return { label: `套图 · ${suite.name}`, hint: shotLabel ? `套图分镜 · ${shotLabel}` : "套图分镜" };
  }
  return { label: templates.find((template) => template.id === assetType)?.name ?? assetType, hint: "规划模板" };
}

function toDraft(item: StoryboardItem): Draft {
  return {
    assetType: item.assetType,
    displayName: item.displayName,
    candidateCount: item.candidateCount,
    imageProviderId: item.imageProviderId,
    imageModelId: item.imageModelId,
    imageResolution: item.imageResolution,
    imageAspectRatio: item.imageAspectRatio,
    mode: item.mode,
    promptInstruction: item.promptInstruction,
  };
}

/**
 * 只把 dirty 字段与基线的差异写进补丁：后台 refetch 更新了其他字段时，
 * 未编辑字段不会被本地旧值覆盖。生图模型两个字段作为一个整体判断。
 */
function patchFrom(base: StoryboardItem, dirty: Set<keyof Draft>, draft: Draft): UpdateStoryboardItemInput | null {
  const body: UpdateStoryboardItemInput = {};
  if (dirty.has("assetType") && draft.assetType !== base.assetType) body.assetType = draft.assetType;
  if (dirty.has("displayName") && draft.displayName !== base.displayName) body.displayName = draft.displayName;
  if (dirty.has("candidateCount") && draft.candidateCount !== base.candidateCount) body.candidateCount = draft.candidateCount;
  if ((dirty.has("imageProviderId") || dirty.has("imageModelId")) && draft.imageProviderId && draft.imageModelId && (draft.imageProviderId !== base.imageProviderId || draft.imageModelId !== base.imageModelId)) {
    body.imageModel = { providerId: draft.imageProviderId, modelId: draft.imageModelId };
  }
  if (dirty.has("imageResolution") && draft.imageResolution !== base.imageResolution) body.imageResolution = draft.imageResolution;
  if (dirty.has("imageAspectRatio") && draft.imageAspectRatio !== base.imageAspectRatio) body.imageAspectRatio = draft.imageAspectRatio;
  if (dirty.has("mode") && draft.mode !== base.mode) body.mode = draft.mode;
  if (dirty.has("promptInstruction") && draft.promptInstruction !== base.promptInstruction) body.promptInstruction = draft.promptInstruction;
  return Object.keys(body).length > 0 ? body : null;
}
