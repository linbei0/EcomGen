import { App, Image, Popconfirm, Select } from "antd";
import { ShieldCheck, Trash2, Upload as UploadIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from "react";

import type { Asset, AssetRole, ProjectDetail } from "../../api/adapters/projectDetail";
import { useDeleteAsset, useUploadAsset } from "../../api/hooks/useAssets";
import { errorText } from "../../lib/errorText";
import { ASSET_ROLE_META, ASSET_ROLE_ORDER } from "../../lib/roles";
import styles from "./workbench.module.css";

const COMMON_OWNER = "__common__";

export function AssetsStage({ detail }: { detail: ProjectDetail }) {
  const { notification } = App.useApp();
  const [role, setRole] = useState<AssetRole>("PRODUCT_TRUTH");
  const [owner, setOwner] = useState(COMMON_OWNER);
  const [dragOver, setDragOver] = useState(false);
  const upload = useUploadAsset();
  const removeAsset = useDeleteAsset();
  const grouped = useMemo(() => groupAssets(detail.assets), [detail.assets]);
  const ownerOptions = [
    { value: COMMON_OWNER, label: "通用（全 SKU）" },
    ...detail.variants.map((variant) => ({ value: variant.id, label: variant.name })),
  ];

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
        <p className={styles.dropTitle}>拖入商品图</p>
        <p className={styles.dropHint}>
          商品真实性图用于像素保护；风格/竞品图只影响感觉，不会被复制。也可以直接粘贴。
        </p>
      </label>

      <div className={styles.uploadMeta}>
        <label>
          素材角色
          <Select
            value={role}
            onChange={setRole}
            style={{ width: "100%", marginTop: 6 }}
            options={ASSET_ROLE_ORDER.map((item) => ({
              value: item,
              label: ASSET_ROLE_META[item].label,
            }))}
          />
        </label>
        <label>
          归属
          <Select
            value={owner}
            onChange={setOwner}
            style={{ width: "100%", marginTop: 6 }}
            options={ownerOptions}
          />
        </label>
      </div>

      {ASSET_ROLE_ORDER.map((item) => {
        const assets = grouped.get(item) ?? [];
        if (assets.length === 0) return null;
        return (
          <section key={item} className={styles.groups}>
            <div className={styles.groupHeader}>
              <span>{ASSET_ROLE_META[item].label}</span>
              <span>{assets.length}</span>
            </div>
            <div className={styles.assetGrid}>
              <Image.PreviewGroup>
                {assets.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    variantName={detail.variants.find((variant) => variant.id === asset.variantId)?.name}
                    showShield={detail.defaultMode === "PIXEL_PROTECTED" && asset.role === "PRODUCT_TRUTH"}
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
        {showShield ? (
          <ShieldCheck className={styles.shield} size={16} strokeWidth={1.75} aria-label="像素保护素材" />
        ) : null}
        <Popconfirm title="删除这张素材？" okText="删除" cancelText="取消" onConfirm={onDelete}>
          <button
            type="button"
            className={styles.assetDelete}
            aria-label={`删除素材 ${ASSET_ROLE_META[asset.role].label}`}
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden />
          </button>
        </Popconfirm>
      </div>
      <div className={styles.assetMeta}>
        <span className={styles.assetRole}>{ASSET_ROLE_META[asset.role].label}</span>
        <span className={styles.assetOwner}>{variantName ?? "通用"}</span>
        {asset.width && asset.height ? (
          <span className={styles.assetSize}>
            {asset.width}×{asset.height}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function groupAssets(assets: Asset[]): Map<AssetRole, Asset[]> {
  const groups = new Map<AssetRole, Asset[]>();
  for (const asset of assets) {
    const list = groups.get(asset.role) ?? [];
    list.push(asset);
    groups.set(asset.role, list);
  }
  return groups;
}
