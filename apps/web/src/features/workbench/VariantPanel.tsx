import { App, Button, Input } from "antd";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { Variant } from "../../api/adapters/projectDetail";
import { useCreateVariant } from "../../api/hooks/useVariants";
import { errorText } from "../../lib/errorText";
import styles from "./workbench.module.css";

export function VariantPanel({ projectId, variants }: { projectId: string; variants: Variant[] }) {
  const [name, setName] = useState("");
  const createVariant = useCreateVariant(projectId);
  const { notification } = App.useApp();

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await createVariant.mutateAsync({ name: trimmed, attributes: {} });
      setName("");
      notification.success({ title: "已添加变体" });
    } catch (error) {
      notification.error({ title: "添加变体失败", description: errorText(error) });
    }
  };

  return (
    <section>
      <p className={styles.sectionTitle}>SKU 变体</p>
      <ul className={styles.variantList}>
        {variants.map((variant) => (
          <li key={variant.id} className={styles.variantItem}>
            <span className={styles.variantName}>{variant.name}</span>
            {variant.attributes && Object.keys(variant.attributes).length > 0 ? (
              <span className={styles.variantAttr}>
                {Object.entries(variant.attributes)
                  .map(([key, value]) => `${key} ${value}`)
                  .join(" · ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className={styles.addRow}>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：黑色 256G"
          aria-label="变体名称"
          onPressEnter={() => void submit()}
        />
        <Button
          icon={<Plus size={14} strokeWidth={1.75} />}
          loading={createVariant.isPending}
          onClick={() => void submit()}
        >
          添加变体
        </Button>
      </div>
    </section>
  );
}
