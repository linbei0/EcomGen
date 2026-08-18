import { Drawer } from "antd";
import { useState } from "react";

import type { ProviderConfig } from "../../api/hooks/useProviders";
import { ProviderFormView } from "./ProviderFormView";
import { ProviderListView } from "./ProviderListView";

export type ProviderView =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; provider: ProviderConfig };

const VIEW_TITLE: Record<ProviderView["kind"], string> = {
  list: "设置 · Provider",
  create: "添加 Provider",
  edit: "编辑 Provider",
};

/** 全局设置抽屉（docs/09 7.0）：Provider CRUD + 连通性测试，密钥永不回显。 */
export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [view, setView] = useState<ProviderView>({ kind: "list" });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={560}
      title={VIEW_TITLE[view.kind]}
      destroyOnHidden
      afterOpenChange={(nextOpen) => {
        if (!nextOpen) setView({ kind: "list" });
      }}
    >
      {view.kind === "list" ? (
        <ProviderListView
          onCreate={() => setView({ kind: "create" })}
          onEdit={(provider) => setView({ kind: "edit", provider })}
        />
      ) : (
        <ProviderFormView view={view} onDone={() => setView({ kind: "list" })} />
      )}
    </Drawer>
  );
}
