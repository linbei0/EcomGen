import { App, Button, Form, Input, InputNumber, Popconfirm, Select, Skeleton, Switch, Tag } from "antd";
import { KeyRound, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import { useCreateSearchSource, useDeleteSearchSource, useSearchSources, useUpdateSearchSource, type SearchSourceConfig, type SearchSourceInput } from "../../api/hooks/useSearchSources";
import { errorText } from "../../lib/errorText";
import styles from "./providers.module.css";

const defaults = { brave: "https://api.search.brave.com/res/v1/web/search", tavily: "https://api.tavily.com/search", searxng: "http://127.0.0.1:8080/search" };

export function SearchSourceView({ onBack }: { onBack: () => void }) {
  const sources = useSearchSources();
  const create = useCreateSearchSource();
  const update = useUpdateSearchSource();
  const remove = useDeleteSearchSource();
  const { notification } = App.useApp();
  const [editing, setEditing] = useState<SearchSourceConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const save = async (values: SearchSourceInput) => {
    try {
      if (editing) await update.mutateAsync({ sourceId: editing.id, body: values }); else await create.mutateAsync(values);
      notification.success({ title: editing ? "已保存搜索源" : "已添加搜索源" }); setEditing(null); setCreating(false);
    } catch (error) { notification.error({ title: "保存失败", description: errorText(error) }); }
  };
  if (creating || editing) return <SearchSourceForm source={editing} onCancel={() => { setCreating(false); setEditing(null); }} onSave={save} loading={create.isPending || update.isPending} />;
  if (sources.isPending) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (sources.isError) return <div className={styles.emptyBlock}><p className={styles.emptyTitle}>搜索源加载失败</p><p className={styles.emptyHint}>{errorText(sources.error)}</p><Button onClick={() => void sources.refetch()}>重试</Button></div>;
  return <div className={styles.list}>
    <div className={styles.headerRow}><Button onClick={onBack}>返回 Provider</Button><Button type="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>添加搜索源</Button></div>
    <p className={styles.emptyHint}>数值越小越优先。</p>
    {sources.data.items.length === 0 ? <div className={styles.emptyBlock}><p className={styles.emptyTitle}>还没有搜索源</p><p className={styles.emptyHint}>添加 Brave、Tavily 或自托管 SearXNG 后，项目可使用联网视觉研究。</p></div> : sources.data.items.map((source) => <article key={source.id} className={styles.card}><header className={styles.cardHeader}><h3 className={styles.cardTitle}><Search size={15} /> {source.name}</h3><div className={styles.cardActions}><Button type="text" size="small" aria-label={`编辑 ${source.name}`} icon={<Pencil size={14} />} onClick={() => setEditing(source)} /><Popconfirm title="删除搜索源" onConfirm={() => void remove.mutateAsync(source.id)}><Button type="text" danger size="small" aria-label={`删除 ${source.name}`} icon={<Trash2 size={14} />} /></Popconfirm></div></header><p className={`${styles.baseUrl} font-mono num`}>{source.baseUrl}</p><div className={styles.metaRow}><Tag>#{source.priority}</Tag><Tag className={source.enabled ? styles.enabledTag : undefined}>{source.enabled ? "已启用" : "已停用"}</Tag><Tag icon={<KeyRound size={12} />}>{source.hasApiKey ? "已配置密钥" : "无需密钥"}</Tag><span className={styles.metaText}>{source.kind}</span></div></article>)}</div>;
}

function SearchSourceForm({ source, onCancel, onSave, loading }: { source: SearchSourceConfig | null; onCancel: () => void; onSave: (values: SearchSourceInput) => Promise<void>; loading: boolean }) {
  const [form] = Form.useForm<SearchSourceInput>();
  const kind = Form.useWatch("kind", form) ?? source?.kind ?? "brave";
  const onKindChange = (next: SearchSourceInput["kind"]) => form.setFieldValue("baseUrl", defaults[next]);
  return <Form form={form} layout="vertical" initialValues={source ? { ...source, apiKey: "" } : { name: "", kind: "brave", baseUrl: defaults.brave, apiKey: "", priority: 10, enabled: true }} onFinish={(values) => void onSave(values)} requiredMark="optional">
    <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: "填写搜索源名称" }]}><Input maxLength={60} /></Form.Item>
    <Form.Item name="kind" label="类型"><Select onChange={onKindChange} options={[{ value: "brave", label: "Brave Web Search" }, { value: "tavily", label: "Tavily Search" }, { value: "searxng", label: "SearXNG（自托管）" }]} /></Form.Item>
    <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, type: "url", message: "填写合法 URL" }]}><Input className="font-mono" /></Form.Item>
    <Form.Item name="apiKey" label="API Key" rules={kind === "searxng" ? [] : [{ required: !source, message: "填写 API Key" }]} extra={source ? "留空则保留现有密钥；密钥不会回显。" : kind === "searxng" ? "自托管实例通常不需要 API Key。" : "密钥仅经 API 加密保存。"}><Input.Password autoComplete="off" /></Form.Item>
    <Form.Item name="priority" label="优先级" rules={[{ required: true }]} extra="数值越小越优先，失败时依序切换。"><InputNumber min={0} max={100000} precision={0} style={{ width: "100%" }} /></Form.Item>
    <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
    <div className={styles.formFooter}><Button onClick={onCancel}>取消</Button><Button type="primary" htmlType="submit" loading={loading}>保存</Button></div>
  </Form>;
}
