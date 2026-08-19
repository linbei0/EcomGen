import { App, Input, Segmented, Tag } from "antd";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { StoryboardItem } from "../../api/adapters/projectDetail";
import type { EcomTemplate } from "../../api/adapters/templates";
import { useUpdateStoryboardItem, type UpdateStoryboardItemInput } from "../../api/hooks/useStoryboard";
import { errorText } from "../../lib/errorText";
import { factClaimRows } from "../../lib/factClaims";
import styles from "./workbench.module.css";

const DEBOUNCE_MS = 600;

interface Draft {
  assetType: string;
  displayName: string;
  candidateCount: number;
  mode: StoryboardItem["mode"];
  promptInstruction: string;
}

export function StoryboardInspector({
  projectId,
  item,
  templates,
  locked,
}: {
  projectId: string;
  item: StoryboardItem;
  templates: EcomTemplate[];
  locked: boolean;
}) {
  const { notification } = App.useApp();
  const update = useUpdateStoryboardItem(projectId);
  const persist = update.mutateAsync;
  const [draft, setDraft] = useState<Draft>(toDraft(item));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const snapshot = useRef(item);

  useEffect(() => {
    snapshot.current = item;
    setDraft(toDraft(item));
    setSaveState("idle");
  }, [item]);

  useEffect(() => {
    if (locked) return;
    const next = patchFrom(snapshot.current, draft);
    if (!next) return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      void persist({ itemId: item.id, body: next })
        .then((saved) => {
          snapshot.current = saved;
          setSaveState("saved");
        })
        .catch((error: unknown) => {
          setDraft(toDraft(snapshot.current));
          setSaveState("idle");
          notification.error({ title: "分镜未保存", description: errorText(error) });
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, item.id, locked, notification, persist]);

  const claims = factClaimRows(item.factClaims);
  const readOnly = locked || item.status === "CONFIRMED" || item.status === "GENERATING" || item.status === "GENERATED";
  const templateName = templates.find((template) => template.id === draft.assetType)?.name ?? draft.assetType;

  return (
    <div className={styles.inspector}>
      <p className={styles.saveHint}>
        {readOnly ? "已锁定" : saveState === "saving" ? "保存中" : saveState === "saved" ? "已保存" : "编辑后自动保存"}
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
        disabled={readOnly}
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

      <div className={styles.stepper}>
        <span>候选数</span>
        <button
          type="button"
          disabled={readOnly || draft.candidateCount <= 1}
          onClick={() => setDraft((current) => ({ ...current, candidateCount: current.candidateCount - 1 }))}
        >
          −
        </button>
        <strong>{draft.candidateCount}</strong>
        <button
          type="button"
          disabled={readOnly || draft.candidateCount >= 4}
          onClick={() => setDraft((current) => ({ ...current, candidateCount: current.candidateCount + 1 }))}
        >
          +
        </button>
      </div>

      <label className={styles.fieldLabel} htmlFor="item-prompt">
        Prompt
      </label>
      <Input.TextArea
        id="item-prompt"
        className={styles.monoArea}
        value={draft.promptInstruction}
        disabled={readOnly}
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
    mode: item.mode,
    promptInstruction: item.promptInstruction,
  };
}

function patchFrom(item: StoryboardItem, draft: Draft): UpdateStoryboardItemInput | null {
  const body: UpdateStoryboardItemInput = {};
  if (draft.assetType !== item.assetType) body.assetType = draft.assetType;
  if (draft.displayName !== item.displayName) body.displayName = draft.displayName;
  if (draft.candidateCount !== item.candidateCount) body.candidateCount = draft.candidateCount;
  if (draft.mode !== item.mode) body.mode = draft.mode;
  if (draft.promptInstruction !== item.promptInstruction) body.promptInstruction = draft.promptInstruction;
  return Object.keys(body).length > 0 ? body : null;
}
