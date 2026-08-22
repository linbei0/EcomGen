import { App, Input, Segmented, Select, Tag } from "antd";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { StoryboardItem } from "../../api/adapters/projectDetail";
import type { EcomTemplate } from "../../api/adapters/templates";
import { useUpdateStoryboardItem, type UpdateStoryboardItemInput } from "../../api/hooks/useStoryboard";
import { useProviders } from "../../api/hooks/useProviders";
import { errorText } from "../../lib/errorText";
import { factClaimRows } from "../../lib/factClaims";
import { modelOptions } from "../../lib/modelOptions";
import { ASPECT_LABEL, RESOLUTION_LABEL } from "../../lib/roles";
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
  templates: EcomTemplate[];
}) {
  const { notification } = App.useApp();
  const update = useUpdateStoryboardItem(projectId);
  const providers = useProviders();
  const persist = update.mutateAsync;
  const [draft, setDraft] = useState<Draft>(toDraft(item));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const snapshot = useRef(item);
  const saveVersion = useRef(0);
  const saveQueue = useRef(Promise.resolve());

  useEffect(() => {
    snapshot.current = item;
    setDraft(toDraft(item));
    setSaveState("idle");
  }, [item]);

  useEffect(() => {
    if (item.status === "GENERATING") return;
    const next = patchFrom(snapshot.current, draft);
    if (!next) return;
    const version = ++saveVersion.current;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      saveQueue.current = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const saved = await persist({ itemId: item.id, body: next });
            if (saveVersion.current === version) {
              snapshot.current = saved;
              setSaveState("saved");
            }
          } catch (error: unknown) {
            if (saveVersion.current === version) {
              setDraft(toDraft(snapshot.current));
              setSaveState("idle");
              notification.error({ title: "分镜未保存", description: errorText(error) });
            }
          }
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, item.id, item.status, notification, persist]);

  const claims = factClaimRows(item.factClaims);
  const generationSettingsReadOnly = item.status === "GENERATING";
  const contentReadOnly = generationSettingsReadOnly || item.status === "GENERATED";
  const templateName = templates.find((template) => template.id === draft.assetType)?.name ?? draft.assetType;
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
            ? saveState === "saving" ? "保存中" : saveState === "saved" ? "已保存" : "已生成，配置仅影响下次生图"
            : saveState === "saving" ? "保存中" : saveState === "saved" ? "已保存" : "编辑后自动保存"}
      </p>

      {templateName !== draft.displayName ? (
        <div className={styles.assetTypeRow}>
          <Tag className={styles.assetTypeTag} title="规划模板">
            {templateName}
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
        onChange={(value) => setDraft((current) => ({ ...current, mode: value as Draft["mode"] }))}
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
              options={Object.entries(ASPECT_LABEL).map(([value, label]) => ({ value, label }))}
              onChange={(imageAspectRatio) => setDraft((current) => ({ ...current, imageAspectRatio }))}
            />
          </label>
          <label className={styles.fieldLabel}>
            分辨率
            <Select
              aria-label="分镜分辨率"
              value={draft.imageResolution}
              disabled={generationSettingsReadOnly}
              options={Object.entries(RESOLUTION_LABEL).map(([value, label]) => ({ value, label }))}
              onChange={(imageResolution) => setDraft((current) => ({ ...current, imageResolution }))}
            />
          </label>
          <div className={styles.inspectorCandidate}>
            <span>候选数</span>
            <div className={styles.inspectorStepper}>
              <button
                type="button"
                aria-label="减少分镜候选数"
                disabled={generationSettingsReadOnly || draft.candidateCount <= 1}
                onClick={() => setDraft((current) => ({ ...current, candidateCount: current.candidateCount - 1 }))}
              >
                −
              </button>
              <strong>{draft.candidateCount}</strong>
              <button
                type="button"
                aria-label="增加分镜候选数"
                disabled={generationSettingsReadOnly || draft.candidateCount >= 4}
                onClick={() => setDraft((current) => ({ ...current, candidateCount: current.candidateCount + 1 }))}
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
                if (imageProviderId && imageModelId) setDraft((current) => ({ ...current, imageProviderId, imageModelId }));
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
        onChange={(event) => setDraft((current) => ({ ...current, promptInstruction: event.target.value }))}
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

function patchFrom(item: StoryboardItem, draft: Draft): UpdateStoryboardItemInput | null {
  const body: UpdateStoryboardItemInput = {};
  if (draft.assetType !== item.assetType) body.assetType = draft.assetType;
  if (draft.displayName !== item.displayName) body.displayName = draft.displayName;
  if (draft.candidateCount !== item.candidateCount) body.candidateCount = draft.candidateCount;
  if (draft.imageProviderId && draft.imageModelId && (draft.imageProviderId !== item.imageProviderId || draft.imageModelId !== item.imageModelId)) {
    body.imageModel = { providerId: draft.imageProviderId, modelId: draft.imageModelId };
  }
  if (draft.imageResolution && draft.imageResolution !== item.imageResolution) body.imageResolution = draft.imageResolution;
  if (draft.imageAspectRatio && draft.imageAspectRatio !== item.imageAspectRatio) body.imageAspectRatio = draft.imageAspectRatio;
  if (draft.mode !== item.mode) body.mode = draft.mode;
  if (draft.promptInstruction !== item.promptInstruction) body.promptInstruction = draft.promptInstruction;
  return Object.keys(body).length > 0 ? body : null;
}
