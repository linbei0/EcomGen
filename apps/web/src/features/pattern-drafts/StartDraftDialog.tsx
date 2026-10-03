import { App, Input, Modal, Segmented } from "antd";
import { useState } from "react";

import { useCreatePatternDraft, type PatternDraft } from "../../api/hooks/usePatternDrafts";
import { errorText } from "../../lib/errorText";
import { DRAFT_COMPOSE_TYPE_OPTIONS } from "../patterns/shared";

/**
 * 新建起稿：只选创作类型与可选名称，随后进入专用工作台。
 * 起稿不直接产出正式花型——候选留在草稿里，只有明确「定稿入库」才写 patterns。
 */
export function StartDraftDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (draft: PatternDraft) => void }) {
  const { message } = App.useApp();
  const create = useCreatePatternDraft();
  const [composeType, setComposeType] = useState<"PLACEMENT" | "REPEAT">("PLACEMENT");
  const [name, setName] = useState("");
  const submit = (): void => {
    create.mutate(
      { composeType, ...(name.trim() ? { name: name.trim() } : {}) },
      {
        onSuccess: (draft) => {
          setName("");
          setComposeType("PLACEMENT");
          onCreated(draft);
        },
        onError: (error) => message.error(errorText(error)),
      },
    );
  };
  return (
    <Modal title="开始 AI 起稿" open={open} onCancel={onClose} onOk={submit} okText="进入工作台" confirmLoading={create.isPending} destroyOnHidden>
      <Segmented
        block
        value={composeType}
        options={DRAFT_COMPOSE_TYPE_OPTIONS}
        onChange={(value) => setComposeType(value as "PLACEMENT" | "REPEAT")}
      />
      <Input style={{ marginTop: 12 }} placeholder="草稿名称（可选，进入后可重命名）" value={name} onChange={(event) => setName(event.target.value)} />
      <p style={{ fontSize: 12, opacity: 0.65, marginTop: 12 }}>
        草稿按主题自动保存，刷新或离开后可继续；生成的候选留在草稿历史中，只有你明确「定稿入库」的那一张才会成为正式花型。
      </p>
    </Modal>
  );
}
