import { Button, Checkbox, Input, Modal, Tag } from "antd";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import styles from "./providers.module.css";

interface Props {
  open: boolean;
  /** discoverProviderModels 返回的模型 ID（已去重排序）。 */
  models: string[];
  latencyMs?: number;
  /** 表单里已配置的模型 ID；置灰展示，防止重复添加。 */
  existingIds: Set<string>;
  onCancel: () => void;
  onConfirm: (modelIds: string[]) => void;
}

/** 从 Provider /models 拉取结果里勾选要添加的模型；中转站列表常有几百项，必须可搜索。 */
export function ModelPickerModal({ open, models, latencyMs, existingIds, onCancel, onConfirm }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  // 组件常驻挂载（destroyOnHidden 只销毁 Modal 子节点），上一次会话的勾选若不重置会
  // 漏进下一次确认，把已存在的模型再添加一遍。
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected([]);
    }
  }, [open]);

  const keyword = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (keyword === "" ? models : models.filter((id) => id.toLowerCase().includes(keyword))),
    [models, keyword],
  );

  return (
    <Modal
      title="选择要添加的模型"
      open={open}
      onCancel={onCancel}
      width={520}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button
          key="confirm"
          type="primary"
          disabled={selected.length === 0}
          onClick={() => onConfirm(selected)}
        >
          {selected.length > 0 ? `添加 ${selected.length} 个模型` : "添加模型"}
        </Button>,
      ]}
    >
      <p className={styles.pickerMeta}>
        共 {models.length} 个模型
        {latencyMs !== undefined && <span className="num"> · {latencyMs}ms</span>}
      </p>
      {models.length > 0 && (
        <Input
          allowClear
          prefix={<Search size={14} strokeWidth={1.75} />}
          placeholder="搜索模型 ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      {models.length === 0 ? (
        <p className={styles.pickerEmpty}>该 Provider 未返回任何模型。</p>
      ) : (
        <Checkbox.Group
          className={styles.pickerList}
          value={selected}
          onChange={(values) => setSelected(values as string[])}
        >
          {filtered.map((id) => {
            const existing = existingIds.has(id);
            return (
              <Checkbox key={id} value={id} disabled={existing} className={styles.pickerRow}>
                <span className="font-mono">{id}</span>
                {existing && <Tag className={styles.pickerTag}>已添加</Tag>}
              </Checkbox>
            );
          })}
        </Checkbox.Group>
      )}
      {models.length > 0 && filtered.length === 0 && (
        <p className={styles.pickerEmpty}>没有匹配 “{query.trim()}” 的模型。</p>
      )}
    </Modal>
  );
}
