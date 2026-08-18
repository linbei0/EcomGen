import { App, Button, Popconfirm, Skeleton, Tag } from "antd";
import { Images, KeyRound, Pencil, Plus, ScanEye, Trash2 } from "lucide-react";

import { useDeleteProvider, useProviders, type ProviderConfig } from "../../api/hooks/useProviders";
import { errorText } from "../../lib/errorText";
import styles from "./providers.module.css";

interface Props {
  onCreate: () => void;
  onEdit: (provider: ProviderConfig) => void;
}

export function ProviderListView({ onCreate, onEdit }: Props) {
  const providers = useProviders();
  const deleteProvider = useDeleteProvider();
  const { notification } = App.useApp();

  const handleDelete = async (provider: ProviderConfig) => {
    try {
      await deleteProvider.mutateAsync(provider.id);
      notification.success({ title: `已删除 ${provider.name}` });
    } catch (error) {
      notification.error({ title: "删除失败", description: errorText(error) });
    }
  };

  if (providers.isPending) {
    return <Skeleton active paragraph={{ rows: 4 }} />;
  }

  if (providers.isError) {
    return (
      <div className={styles.emptyBlock}>
        <p className={styles.emptyTitle}>Provider 列表加载失败</p>
        <p className={styles.emptyHint}>{errorText(providers.error)}</p>
        <Button onClick={() => void providers.refetch()}>重试</Button>
      </div>
    );
  }

  const items = providers.data.items;

  return (
    <div className={styles.list}>
      <div className={styles.headerRow}>
        <span className={styles.headerMeta}>{items.length} 个 Provider</span>
        <Button
          type="primary"
          icon={<Plus size={14} strokeWidth={1.75} />}
          onClick={onCreate}
        >
          添加 Provider
        </Button>
      </div>

      {items.length === 0 ? (
        <div className={styles.emptyBlock}>
          <p className={styles.emptyTitle}>还没有 Provider</p>
          <p className={styles.emptyHint}>
            Provider 是推理与生图模型的接入配置。密钥仅通过 API 加密保存，永不回显。
          </p>
          <Button type="primary" onClick={onCreate}>
            添加第一个 Provider
          </Button>
        </div>
      ) : (
        items.map((provider) => (
          <article key={provider.id} className={styles.card}>
            <header className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>{provider.name}</h3>
              <div className={styles.cardActions}>
                <Button
                  size="small"
                  type="text"
                  aria-label={`编辑 ${provider.name}`}
                  icon={<Pencil size={14} strokeWidth={1.75} />}
                  onClick={() => onEdit(provider)}
                />
                <Popconfirm
                  title="删除 Provider"
                  description={`${provider.name} 将被删除，引用它的项目会受影响。`}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true, loading: deleteProvider.isPending }}
                  onConfirm={() => void handleDelete(provider)}
                >
                  <Button
                    size="small"
                    type="text"
                    danger
                    aria-label={`删除 ${provider.name}`}
                    icon={<Trash2 size={14} strokeWidth={1.75} />}
                  />
                </Popconfirm>
              </div>
            </header>
            <p className={`${styles.baseUrl} font-mono num`}>{provider.baseUrl}</p>
            <div className={styles.metaRow}>
              <Tag
                icon={<KeyRound size={12} aria-hidden />}
                color={provider.hasApiKey ? undefined : "warning"}
              >
                {provider.hasApiKey ? "已配置密钥" : "未配置密钥"}
              </Tag>
              <span className={styles.metaText}>{provider.models.length} 个模型</span>
              {provider.models.some((m) => m.imageApiKind) && (
                <Tag icon={<Images size={12} aria-hidden />}>含生图模型</Tag>
              )}
              {provider.models.some((m) => m.supportsVision) && (
                <Tag icon={<ScanEye size={12} aria-hidden />}>含视觉模型</Tag>
              )}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
