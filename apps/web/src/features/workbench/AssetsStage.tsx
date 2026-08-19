import { App, Image, Popconfirm } from "antd";
import { ShieldCheck, Trash2, Upload as UploadIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from "react";

import type { Asset, ProjectDetail, UserAssetKind } from "../../api/adapters/projectDetail";
import { useDeleteAsset, useUploadAsset } from "../../api/hooks/useAssets";
import { errorText } from "../../lib/errorText";
import { kindForRole, USER_ASSET_KIND_META, USER_ASSET_KIND_ORDER } from "../../lib/roles";
import styles from "./workbench.module.css";

export function AssetsStage({
  detail,
  compact = false,
}: {
  detail: ProjectDetail;
  compact?: boolean;
}) {
  const { notification } = App.useApp();
  const [kind, setKind] = useState<UserAssetKind>("PRODUCT");
  const [dragOver, setDragOver] = useState(false);
  const upload = useUploadAsset();
  const removeAsset = useDeleteAsset();
  const grouped = useMemo(() => groupAssets(detail.assets), [detail.assets]);

  const uploadFiles = (images: File[]) => {
    for (const file of images) {
      void upload.mutateAsync({ projectId: detail.id, file, kind }).catch((error: unknown) => {
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

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragOver(false);
    sendFiles(event.dataTransfer.files);
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) sendFiles(event.target.files);
    event.target.value = "";
  };

  const onDelete = (asset: Asset) => {
    void removeAsset.mutateAsync({ assetId: asset.id, projectId: detail.id }).catch((error: unknown) => {
      notification.error({ title: "删除失败", description: errorText(error) });
    });
  };

  return (
    <div>
      <div className={styles.kindToggle} role="group" aria-label="素材类型">
        {USER_ASSET_KIND_ORDER.map((item) => (
          <button
            key={item}
            type="button"
            data-active={kind === item}
            onClick={() => setKind(item)}
          >
            {USER_ASSET_KIND_META[item].label}
          </button>
        ))}
      </div>

      <label
        className={styles.dropzone}
        data-over={dragOver}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept="image/*"
          multiple
          className={styles.fileInput}
          aria-label="上传素材"
          onChange={onPick}
        />
        <UploadIcon size={20} strokeWidth={1.5} aria-hidden />
        <p className={styles.dropTitle}>拖入{USER_ASSET_KIND_META[kind].label}</p>
        <p className={styles.dropHint}>{USER_ASSET_KIND_META[kind].hint}。也可以直接粘贴。</p>
      </label>

      {USER_ASSET_KIND_ORDER.map((item) => {
        const assets = grouped.get(item) ?? [];
        if (assets.length === 0) return null;
        return (
          <section key={item} className={styles.groups}>
            <div className={styles.groupHeader}>
              <span>{USER_ASSET_KIND_META[item].label}</span>
              <span>{assets.length}</span>
            </div>
            <div className={compact ? styles.assetGridCompact : styles.assetGrid}>
              <Image.PreviewGroup>
                {assets.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    showShield={detail.defaultMode === "PIXEL_PROTECTED" && kindForRole(asset.role) === "PRODUCT"}
                    onDelete={() => onDelete(asset)}
                  />
                ))}
              </Image.PreviewGroup>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AssetCard({
  asset,
  showShield,
  onDelete,
}: {
  asset: Asset;
  showShield: boolean;
  onDelete: () => void;
}) {
  const kind = kindForRole(asset.role);
  return (
    <article className={styles.assetCard}>
      <div className={styles.thumbWrap}>
        <Image
          src={asset.url}
          alt={USER_ASSET_KIND_META[kind].label}
          className={styles.thumb}
          loading="lazy"
        />
        {showShield ? (
          <ShieldCheck className={styles.shield} size={16} strokeWidth={1.75} aria-label="像素保护素材" />
        ) : null}
        <Popconfirm title="删除这张素材？" okText="删除" cancelText="取消" onConfirm={onDelete}>
          <button
            type="button"
            className={styles.assetDelete}
            aria-label={`删除素材 ${USER_ASSET_KIND_META[kind].label}`}
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden />
          </button>
        </Popconfirm>
      </div>
      <div className={styles.assetMeta}>
        <span className={styles.assetRole}>{USER_ASSET_KIND_META[kind].label}</span>
        {asset.width && asset.height ? (
          <span className={styles.assetSize}>
            {asset.width}×{asset.height}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function groupAssets(assets: Asset[]): Map<UserAssetKind, Asset[]> {
  const groups = new Map<UserAssetKind, Asset[]>();
  for (const asset of assets) {
    const kind = kindForRole(asset.role);
    const list = groups.get(kind) ?? [];
    list.push(asset);
    groups.set(kind, list);
  }
  return groups;
}
