import { App, Button, Form, Input, Select, Switch, Tooltip } from "antd";
import { CircleCheck, CircleX, ClipboardPaste, ListPlus, PlugZap, Plus, Trash2 } from "lucide-react";
import { useState, type ClipboardEvent } from "react";

import {
  useCreateProvider,
  useDiscoverProviderModels,
  useTestProvider,
  useUpdateProvider,
  type ModelCapability,
  type ProviderConfig,
  type UpdateProviderInput,
} from "../../api/hooks/useProviders";
import { errorText } from "../../lib/errorText";
import { SEGMENTATION_PROTOCOL_LABELS, type SegmentationProtocolValue } from "../../lib/modelOptions";
import { ModelPickerModal } from "./ModelPickerModal";
import { parseConnectionText, type ProviderConnectionDraft } from "./parseConnectionText";
import styles from "./providers.module.css";

type ImageApiKindValue = NonNullable<ModelCapability["imageApiKind"]>;
type SegmentationKindValue = SegmentationProtocolValue;

interface ModelFormRow {
  id: string;
  supportsVision: boolean;
  supportsThinking: boolean;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  /** 表单哨兵值："" 表示推理模型；生图 kind 提交为 imageApiKind，分割 kind 提交为 segmentationProtocol */
  kind: "" | ImageApiKindValue | SegmentationKindValue;
}

interface ProviderFormValues {
  name: string;
  baseUrl: string;
  reasoningProtocol: "openai" | "dashscope_qwen" | "openai_responses";
  apiKey: string;
  models: ModelFormRow[];
}

type TestRowState =
  | { state: "loading" }
  | { state: "ok"; latencyMs: number; modelAvailable: boolean | null }
  | { state: "fail"; text: string };

type DiscoveryState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "fail"; text: string }
  | { state: "done"; models: string[]; latencyMs: number };

const EMPTY_MODEL_ROW: ModelFormRow = {
  id: "",
  supportsVision: false,
  supportsThinking: false,
  supportsTools: false,
  supportsStructuredOutput: false,
  kind: "",
};

function isSegmentationKind(kind: ModelFormRow["kind"]): kind is SegmentationKindValue {
  // 从协议标签表派生：新增分割协议时只改 contracts 的能力注册表（segmentation.ts），表单自动跟上
  return Object.hasOwn(SEGMENTATION_PROTOCOL_LABELS, kind);
}

function connectionAppliedTitle(draft: ProviderConnectionDraft): string {
  if (draft.baseUrl && draft.apiKey) return "已识别连接信息，地址与密钥已填入";
  if (draft.apiKey) return "识别到密钥，已填入 API Key";
  return "识别到地址，已填入 Base URL";
}

function toModelCapability(row: ModelFormRow): ModelCapability {
  return {
    id: row.id.trim(),
    // 生图/分割模型的能力开关未渲染，antd onFinish 不返回未挂载字段，这里必须兜底
    supportsVision: Boolean(row.supportsVision),
    supportsThinking: Boolean(row.supportsThinking),
    supportsTools: Boolean(row.supportsTools),
    supportsStructuredOutput: Boolean(row.supportsStructuredOutput),
    // 分割与生图互斥：分割 kind 提交为 segmentationProtocol，其余按 imageApiKind
    ...(isSegmentationKind(row.kind)
      ? { imageApiKind: null, segmentationProtocol: row.kind }
      : { imageApiKind: row.kind === "" ? null : row.kind }),
  };
}

interface Props {
  view: { kind: "create" } | { kind: "edit"; provider: ProviderConfig };
  /** 取消时不传值；保存成功传回最新 Provider，让父级留在编辑页。 */
  onDone: (provider?: ProviderConfig) => void;
}

export function ProviderFormView({ view, onDone }: Props) {
  const editing = view.kind === "edit" ? view.provider : null;
  const [form] = Form.useForm<ProviderFormValues>();
  const models = Form.useWatch("models", form);
  const baseUrlValue = Form.useWatch("baseUrl", form);
  const apiKeyValue = Form.useWatch("apiKey", form);
  const createProvider = useCreateProvider();
  const updateProvider = useUpdateProvider();
  const testProvider = useTestProvider();
  const discoverModels = useDiscoverProviderModels();
  const { notification } = App.useApp();
  const [testRows, setTestRows] = useState<Record<number, TestRowState>>({});
  const [modelKinds, setModelKinds] = useState<Record<number, ModelFormRow["kind"]>>({});
  const [discovery, setDiscovery] = useState<DiscoveryState>({ state: "idle" });
  const [pickerOpen, setPickerOpen] = useState(false);

  const initialValues: ProviderFormValues = editing
    ? {
      name: editing.name,
      baseUrl: editing.baseUrl,
      reasoningProtocol: editing.reasoningProtocol,
      apiKey: "",
      models: editing.models.map((m) => ({
        id: m.id,
        supportsVision: m.supportsVision,
        supportsThinking: m.supportsThinking,
        supportsTools: m.supportsTools,
        supportsStructuredOutput: m.supportsStructuredOutput,
        kind: m.segmentationProtocol ?? m.imageApiKind ?? "",
      })),
    }
    : { name: "", baseUrl: "", reasoningProtocol: "openai", apiKey: "", models: [EMPTY_MODEL_ROW] };

  const handleFinish = async (values: ProviderFormValues) => {
    // 编辑时密钥可留空：契约中 apiKey 可选，省略表示保留原密钥
    const shared = {
      name: values.name.trim(),
      baseUrl: values.baseUrl.trim(),
      reasoningProtocol: values.reasoningProtocol,
      models: values.models.map(toModelCapability),
    };
    try {
      if (editing) {
        const body: UpdateProviderInput = {
          ...shared,
          ...(values.apiKey.trim() === "" ? {} : { apiKey: values.apiKey }),
        };
        const saved = await updateProvider.mutateAsync({ providerId: editing.id, body });
        form.setFieldsValue({ ...values, apiKey: "" });
        setTestRows({});
        notification.success({ title: "已保存 Provider" });
        onDone(saved);
      } else {
        const saved = await createProvider.mutateAsync({ ...shared, apiKey: values.apiKey });
        form.setFieldsValue({ ...values, apiKey: "" });
        setTestRows({});
        notification.success({ title: "已添加 Provider" });
        onDone(saved);
      }
    } catch (error) {
      notification.error({
        title: editing ? "保存失败" : "创建失败",
        description: errorText(error),
      });
    }
  };

  const runTest = async (index: number) => {
    if (!editing) return;
    const rows = form.getFieldValue("models") as ModelFormRow[] | undefined;
    const row = rows?.[index];
    if (!row || row.id.trim() === "") {
      notification.warning({ title: "先填写模型 ID 再测试" });
      return;
    }
    const persisted = editing.models.find((model) => model.id === row.id.trim());
    if (!persisted || (persisted.segmentationProtocol ?? persisted.imageApiKind ?? "") !== row.kind) {
      notification.warning({ title: "请先保存模型，再测试连通性" });
      return;
    }
    setTestRows((s) => ({ ...s, [index]: { state: "loading" } }));
    try {
      const result = await testProvider.mutateAsync({
        providerId: editing.id,
        modelId: row.id.trim(),
        // 契约要求 kind：生图按 image、分割按 segmentation（零费用探测）、其余按 reasoning
        kind: row.kind === "" ? "reasoning" : isSegmentationKind(row.kind) ? "segmentation" : "image",
      });
      setTestRows((s) => ({
        ...s,
        [index]: {
          state: "ok",
          latencyMs: result.latencyMs,
          modelAvailable: result.modelAvailable ?? null,
        },
      }));
    } catch (error) {
      setTestRows((s) => ({ ...s, [index]: { state: "fail", text: errorText(error) } }));
    }
  };

  const baseUrlFilled = (baseUrlValue ?? "").trim() !== "";
  const apiKeyFilled = (apiKeyValue ?? "").trim() !== "";
  // 编辑态留空密钥时后端回退到已保存密钥，因此只要有 baseUrl 就能拉取
  const discoverReady = baseUrlFilled && (Boolean(editing) || apiKeyFilled);
  const discoverHint = !baseUrlFilled
    ? "填写 Base URL 后可获取"
    : !apiKeyFilled && !editing
      ? "填写 API Key 后可获取"
      : "从 Provider 的模型列表端点拉取，不消耗生图额度";

  const runDiscoverModels = async () => {
    const baseUrl = (form.getFieldValue("baseUrl") as string | undefined)?.trim() ?? "";
    const apiKey = (form.getFieldValue("apiKey") as string | undefined)?.trim() ?? "";
    if (baseUrl === "" || (!editing && apiKey === "")) return;
    setDiscovery({ state: "loading" });
    try {
      const result = await discoverModels.mutateAsync({
        baseUrl,
        // 编辑态留空密钥：后端读取已保存密钥，密钥从不回显到前端
        ...(apiKey === "" ? {} : { apiKey }),
        ...(editing ? { providerId: editing.id } : {}),
      });
      setDiscovery({ state: "done", models: result.models, latencyMs: result.latencyMs });
      setPickerOpen(true);
    } catch (error) {
      setDiscovery({ state: "fail", text: errorText(error) });
    }
  };

  const handlePickModels = (ids: string[]) => {
    const rows = (form.getFieldValue("models") as ModelFormRow[] | undefined) ?? [];
    // 首行仍是未填写的空行时直接替换，避免选中模型后面跟着一个必填报错的空行
    const base = rows.length === 1 && rows[0]!.id.trim() === "" ? [] : rows;
    form.setFieldValue("models", [...base, ...ids.map((id) => ({ ...EMPTY_MODEL_ROW, id }))]);
    setPickerOpen(false);
  };

  const existingModelIds = new Set((models ?? []).map((row) => row.id.trim()).filter((id) => id !== ""));

  // Docker http 部署不是安全上下文，clipboard API 缺失时按钮自动隐藏，Ctrl+V 粘贴始终可用
  const canReadClipboard = typeof navigator.clipboard?.readText === "function";

  const applyConnectionDraft = (draft: ProviderConnectionDraft) => {
    const updates: Partial<ProviderFormValues> = {};
    if (draft.baseUrl) updates.baseUrl = draft.baseUrl;
    if (draft.apiKey) updates.apiKey = draft.apiKey;
    // 名称仍为空时用主机名预填：粘贴后通常只剩选模型这一步
    if (draft.baseUrl && (form.getFieldValue("name") ?? "").trim() === "") {
      try {
        updates.name = new URL(draft.baseUrl).hostname;
      } catch {
        // 走到这里的地址都经过规范化，仅防御
      }
    }
    form.setFieldsValue(updates);
  };

  const handleConnectionPaste = (target: "baseUrl" | "apiKey") => (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (text === "") return;
    const draft = parseConnectionText(text);
    if (!draft) return;
    const ownValue = target === "baseUrl" ? draft.baseUrl : draft.apiKey;
    const hasOther = target === "baseUrl" ? Boolean(draft.apiKey) : Boolean(draft.baseUrl);
    // 整段连接信息或贴错字段（往 URL 框贴纯密钥）才接管粘贴；普通内容放行默认行为
    if (hasOther || !ownValue) {
      event.preventDefault();
      applyConnectionDraft(draft);
      notification.success({ title: connectionAppliedTitle(draft) });
      return;
    }
    // 只有当前字段自己的值：规范化有变化（补 /v1、剥引号）时同样接管，避免贴出原始串
    if (target === "baseUrl" && draft.baseUrl !== text.trim()) {
      event.preventDefault();
      form.setFieldsValue({ baseUrl: draft.baseUrl });
    }
  };

  const readClipboardConnection = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const draft = text === "" ? null : parseConnectionText(text);
      if (!draft || (!draft.baseUrl && !draft.apiKey)) {
        notification.info({ title: "剪贴板中未识别到连接信息" });
        return;
      }
      applyConnectionDraft(draft);
      notification.success({ title: connectionAppliedTitle(draft) });
    } catch {
      notification.warning({ title: "无法读取剪贴板", description: "点击 Base URL 输入框后按 Ctrl+V 粘贴即可自动识别" });
    }
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onFinish={(values) => void handleFinish(values)}
      requiredMark="optional"
    >
      <Form.Item
        name="name"
        label="名称"
        rules={[{ required: true, whitespace: true, message: "填写 Provider 名称" }]}
      >
        <Input placeholder="如：OpenAI 官方 / 自建网关" maxLength={60} />
      </Form.Item>

      <Form.Item
        name="baseUrl"
        label="Base URL"
        rules={[
          { required: true, whitespace: true, message: "填写 Base URL" },
          { type: "url", message: "Base URL 需为合法 URL" },
        ]}
        extra="支持直接粘贴中转站复制的连接信息，自动拆分地址与密钥"
      >
        <Input
          placeholder="https://api.openai.com/v1"
          className="font-mono"
          onPaste={handleConnectionPaste("baseUrl")}
          suffix={
            canReadClipboard ? (
              <Tooltip title="读取剪贴板中的连接信息">
                <button
                  type="button"
                  aria-label="读取剪贴板连接信息"
                  className={styles.pasteTrigger}
                  onClick={() => void readClipboardConnection()}
                >
                  <ClipboardPaste size={14} strokeWidth={1.75} />
                </button>
              </Tooltip>
            ) : undefined
          }
        />
      </Form.Item>

      <Form.Item name="reasoningProtocol" label="推理协议">
        <Select
          options={[
            { value: "openai", label: "OpenAI Completions" },
            { value: "dashscope_qwen", label: "DashScope Qwen" },
            { value: "openai_responses", label: "OpenAI Responses" },
          ]}
        />
      </Form.Item>

      <Form.Item
        name="apiKey"
        label="API Key"
        rules={editing ? [] : [{ required: true, message: "填写 API Key" }]}
        extra={
          editing
            ? "留空则保留原密钥；密钥仅通过 API 加密保存，任何响应都不会回传。"
            : "密钥仅通过 API 加密保存，任何响应都不会回传。"
        }
      >
        <Input.Password
          placeholder={editing ? "留空保留原密钥" : "sk-..."}
          autoComplete="off"
          onPaste={handleConnectionPaste("apiKey")}
        />
      </Form.Item>

      <div className={styles.modelsHeader}>
        <div className={styles.modelsHeaderText}>
          <span className={styles.modelsLabel}>模型（至少 1 个）</span>
          <span className={styles.modelsHint}>能力标签用于模型选择时的前置拦截</span>
        </div>
        <Tooltip title={discoverHint}>
          <Button
            size="small"
            icon={<ListPlus size={14} strokeWidth={1.75} />}
            disabled={!discoverReady}
            loading={discovery.state === "loading"}
            onClick={() => void runDiscoverModels()}
          >
            获取模型列表
          </Button>
        </Tooltip>
      </div>
      {discovery.state === "fail" && (
        <p className={styles.testFail}>
          <CircleX size={14} aria-hidden />
          获取失败：{discovery.text}
        </p>
      )}

      <Form.List name="models">
        {(fields, { add, remove }) => (
          <div className={styles.modelList}>
            {fields.map((field, index) => {
              const testRow = testRows[index];
              const kind = modelKinds[field.key] ?? models?.[field.name]?.kind ?? "";
              const persisted = Boolean(editing && editing.models.some((model) => model.id === (models?.[field.name]?.id ?? "").trim() && (model.segmentationProtocol ?? model.imageApiKind ?? "") === kind));
              return (
                <div key={field.key} className={styles.modelRow}>
                  <div className={styles.modelRowMain}>
                    <Form.Item
                      name={[field.name, "id"]}
                      rules={[{ required: true, whitespace: true, message: "填写模型 ID" }]}
                      className={styles.modelId}
                    >
                      <Input placeholder="模型 ID，如 gpt-image-1" className="font-mono" />
                    </Form.Item>
                    {/* noStyle 下 Form.Item 不渲染包装节点，className 不会生效，尺寸必须直接给 Select */}
                    <Form.Item name={[field.name, "kind"]} noStyle>
                      <Select
                        aria-label={`模型 ${index + 1} 的模型类型`}
                        style={{ width: 200, flex: "none" }}
                        popupMatchSelectWidth={false}
                        onChange={(value: ModelFormRow["kind"]) => setModelKinds((current) => ({ ...current, [field.key]: value }))}
                        options={[
                          { value: "", label: "无（推理）" },
                          {
                            label: "生图",
                            options: [
                              { value: "openai_images", label: "OpenAI Images" },
                              { value: "gemini", label: "Gemini（Nano Banana）" },
                              { value: "custom", label: "自定义（custom）" },
                            ],
                          },
                          {
                            label: "分割",
                            options: Object.entries(SEGMENTATION_PROTOCOL_LABELS).map(([value, label]) => ({ value, label })),
                          },
                        ]}
                      />
                    </Form.Item>
                    <Tooltip title={persisted ? "仅检测连通性，不消耗生图额度" : "保存后可测试"}>
                      <Button
                        size="small"
                        icon={<PlugZap size={14} strokeWidth={1.75} />}
                        disabled={!persisted}
                        loading={testRow?.state === "loading"}
                        onClick={() => void runTest(index)}
                      >
                        测试
                      </Button>
                    </Tooltip>
                    <Button
                      size="small"
                      type="text"
                      danger
                      aria-label="删除模型"
                      disabled={fields.length <= 1}
                      icon={<Trash2 size={14} strokeWidth={1.75} />}
                      onClick={() => remove(field.name)}
                    />
                  </div>
                  {kind === "" && (
                    <div className={styles.modelRowCaps}>
                      <span className={styles.capsLabel}>能力</span>
                      <label className={styles.switchItem}>
                        <Form.Item name={[field.name, "supportsVision"]} valuePropName="checked" noStyle>
                          <Switch size="small" />
                        </Form.Item>
                        <span>视觉</span>
                      </label>
                      <label className={styles.switchItem}>
                        <Form.Item name={[field.name, "supportsThinking"]} valuePropName="checked" noStyle>
                          <Switch size="small" />
                        </Form.Item>
                        <span>思考</span>
                      </label>
                      <label className={styles.switchItem}>
                        <Form.Item name={[field.name, "supportsTools"]} valuePropName="checked" noStyle>
                          <Switch size="small" />
                        </Form.Item>
                        <span>工具</span>
                      </label>
                      <label className={styles.switchItem}>
                        <Form.Item name={[field.name, "supportsStructuredOutput"]} valuePropName="checked" noStyle>
                          <Switch size="small" />
                        </Form.Item>
                        <span>结构化</span>
                      </label>
                    </div>
                  )}
                  {testRow?.state === "ok" && (
                    <p className={styles.testOk}>
                      <CircleCheck size={14} aria-hidden />
                      <span className="num">连通 · {testRow.latencyMs}ms</span>
                      {testRow.modelAvailable === false && <span>（模型未出现在模型列表中）</span>}
                    </p>
                  )}
                  {testRow?.state === "fail" && (
                    <p className={styles.testFail}>
                      <CircleX size={14} aria-hidden />
                      {testRow.text}
                    </p>
                  )}
                </div>
              );
            })}
            <Button
              type="dashed"
              block
              icon={<Plus size={14} strokeWidth={1.75} />}
              onClick={() => add({ ...EMPTY_MODEL_ROW })}
            >
              添加模型
            </Button>
          </div>
        )}
      </Form.List>

      <div className={styles.formFooter}>
        <Button onClick={() => onDone()}>取消</Button>
        <Button
          type="primary"
          htmlType="submit"
          loading={createProvider.isPending || updateProvider.isPending}
        >
          {editing ? "保存" : "添加"}
        </Button>
      </div>

      <ModelPickerModal
        open={pickerOpen}
        models={discovery.state === "done" ? discovery.models : []}
        latencyMs={discovery.state === "done" ? discovery.latencyMs : undefined}
        existingIds={existingModelIds}
        onCancel={() => setPickerOpen(false)}
        onConfirm={handlePickModels}
      />
    </Form>
  );
}
