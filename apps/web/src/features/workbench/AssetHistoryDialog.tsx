import { App, Modal, Spin } from "antd";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import type { UserAssetKind } from "../../api/adapters/projectDetail";
import { useAssetHistory, useCopyAssetFromHistory } from "../../api/hooks/useAssets";
import { errorText } from "../../lib/errorText";
import { formatShortDate } from "../../lib/format";
import { USER_ASSET_KIND_META } from "../../lib/roles";
import styles from "./workbench.module.css";

/** 历史上传选择器：跨项目按 hash 去重的已上传图片，勾选后由服务端复制为当前项目素材。 */
export function AssetHistoryDialog({
  open,
  projectId,
  kind,
  onClose,
}: {
  open: boolean;
  projectId: string;
  kind: UserAssetKind;
  onClose: () => void;
}) {
  const { notification } = App.useApp();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const history = useAssetHistory(projectId, open);
  const copy = useCopyAssetFromHistory();

  useEffect(() => {
    if (open) setSelectedIds(new Set());
  }, [open]);

  const toggle = (assetId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const handleOk = async () => {
    if (selectedIds.size === 0) return;
    let succeeded = 0;
    let failed = 0;
    let firstError = "";
    for (const assetId of selectedIds) {
      try {
        await copy.mutateAsync({ projectId, assetId, kind });
        succeeded += 1;
      } catch (error: unknown) {
        failed += 1;
        if (!firstError) firstError = errorText(error);
      }
    }
    if (succeeded > 0) {
      notification.success({ title: `已添加 ${succeeded} 张${USER_ASSET_KIND_META[kind].label}` });
      onClose();
    }
    if (failed > 0) {
      notification.error({ title: `${failed} 张添加失败`, description: firstError });
    }
  };

  const items = history.data ?? [];

  return (
    <Modal
      open={open}
      title="从上传记录中选择"
      okText={selectedIds.size > 0 ? `添加 ${selectedIds.size} 张` : "添加"}
      okButtonProps={{ disabled: selectedIds.size === 0 }}
      cancelText="取消"
      onOk={handleOk}
      onCancel={onClose}
      width={720}
    >
      {history.isLoading ? (
        <div className={styles.historyState}>
          <Spin />
        </div>
      ) : history.isError ? (
        <p className={styles.historyState}>上传记录加载失败：{errorText(history.error)}</p>
      ) : items.length === 0 ? (
        <p className={styles.historyState}>还没有上传记录，上传图片后会自动出现在这里。</p>
      ) : (
        <div className={styles.historyGrid}>
          {items.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className={styles.historyItem}
              data-selected={selectedIds.has(asset.id)}
              aria-pressed={selectedIds.has(asset.id)}
              aria-label={`选择 ${asset.originalName ?? "历史图片"}`}
              onClick={() => toggle(asset.id)}
            >
              <span className={styles.historyThumbWrap}>
                <img className={styles.historyThumb} src={asset.url} alt="" loading="lazy" />
                <span className={styles.historyCheck} aria-hidden>
                  <Check size={13} strokeWidth={2.5} />
                </span>
              </span>
              <span className={styles.historyMeta}>
                <span className={styles.historyName} title={asset.originalName}>
                  {asset.originalName || "未命名图片"}
                </span>
                <span className={styles.historyDate}>{formatShortDate(asset.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
