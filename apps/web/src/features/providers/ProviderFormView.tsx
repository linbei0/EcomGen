import { App, Button, Form, Input, Select, Switch, Tooltip } from "antd";
import { CircleCheck, CircleX, PlugZap, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  useCreateProvider,
  useTestProvider,
  useUpdateProvider,
  type CreateProviderInput,
  type ModelCapability,
  type ProviderConfig,
} from "../../api/hooks/useProviders";
import { errorText } from "../../lib/errorText";
import styles from "./providers.module.css";

type ImageApiKindValue = NonNullable<ModelCapability["imageApiKind"]>;

interface ModelFormRow {
  id: string;
  supportsVision: boolean;
  supportsThinking: boolean;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  /** 表单哨兵值："" 表示推理模型（提交时转 null） */
  imageApiKind: "" | ImageApiKindValue;
}

interface ProviderFormValues {
  name: string;
  baseUrl: string;
  reasoningProtocol: "openai" | "dashscope_qwen";
  apiKey: string;
  models: ModelFormRow[];
}

type TestRowState =
  | { state: "loading" }
  | { state: "ok"; latencyMs: number; modelAvailable: boolean | null }
  | { state: "fail"; text: string };

const EMPTY_MODEL_ROW: ModelFormRow = {
  id: "",
  supportsVision: false,
  supportsThinking: false,
  supportsTools: false,
  supportsStructuredOutput: false,
  imageApiKind: "",
};

function toModelCapability(row: ModelFormRow): ModelCapability {
  return {
    id: row.id.trim(),
    // 生图模型的能力开关未渲染，antd onFinish 不返回未挂载字段，这里必须兜底
    supportsVision: Boolean(row.supportsVision),
    supportsThinking: Boolean(row.supportsThinking),
    supportsTools: Boolean(row.supportsTools),
    supportsStructuredOutput: Boolean(row.supportsStructuredOutput),
    imageApiKind: row.imageApiKind === "" ? null : row.imageApiKind,
  };
}

interface Props {
  view: { kind: "create" } | { kind: "edit"; provider: ProviderConfig };
  onDone: () => void;
}

export function ProviderFormView({ view, onDone }: Props) {
  const editing = view.kind === "edit" ? view.provider : null;
  const [form] = Form.useForm<ProviderFormValues>();
  const models = Form.useWatch("models", form);
  const createProvider = useCreateProvider();
  const updateProvider = useUpdateProvider();
  const testProvider = useTestProvider();
  const { notification } = App.useApp();
  const [testRows, setTestRows] = useState<Record<number, TestRowState>>({});
  const [modelKinds, setModelKinds] = useState<Record<number, "" | ImageApiKindValue>>({});

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
          imageApiKind: m.imageApiKind ?? "",
        })),
      }
    : { name: "", baseUrl: "", reasoningProtocol: "openai", apiKey: "", models: [EMPTY_MODEL_ROW] };

  const handleFinish = async (values: ProviderFormValues) => {
    const body: CreateProviderInput = {
      name: values.name.trim(),
      baseUrl: values.baseUrl.trim(),
      reasoningProtocol: values.reasoningProtocol,
      apiKey: values.apiKey,
      models: values.models.map(toModelCapability),
    };
    try {
      if (editing) {
        await updateProvider.mutateAsync({ providerId: editing.id, body });
        notification.success({ title: "已保存 Provider" });
      } else {
        await createProvider.mutateAsync(body);
        notification.success({ title: "已添加 Provider" });
      }
      onDone();
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
    setTestRows((s) => ({ ...s, [index]: { state: "loading" } }));
    try {
      const result = await testProvider.mutateAsync({
        providerId: editing.id,
        modelId: row.id.trim(),
        // 契约要求 kind：生图模型按 image 探测，其余按 reasoning
        kind: row.imageApiKind === "" ? "reasoning" : "image",
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
      >
        <Input placeholder="https://api.openai.com/v1" className="font-mono" />
      </Form.Item>

      <Form.Item name="reasoningProtocol" label="推理协议">
        <Select
          options={[
            { value: "openai", label: "OpenAI Completions" },
            { value: "dashscope_qwen", label: "DashScope Qwen" },
          ]}
        />
      </Form.Item>

      <Form.Item
        name="apiKey"
        label="API Key"
        rules={[{ required: true, message: "填写 API Key" }]}
        extra={
          editing
            ? "密钥不会回显。按当前契约，更新 Provider 需重新输入密钥（契约缺口 13.12）。"
            : "密钥仅通过 API 加密保存，任何响应都不会回传。"
        }
      >
        <Input.Password placeholder={editing ? "重新输入密钥" : "sk-..."} autoComplete="off" />
      </Form.Item>

      <div className={styles.modelsHeader}>
        <span className={styles.modelsLabel}>模型（至少 1 个）</span>
        <span className={styles.modelsHint}>能力标签用于模型选择时的前置拦截</span>
      </div>

      <Form.List name="models">
        {(fields, { add, remove }) => (
          <div className={styles.modelList}>
            {fields.map((field, index) => {
              const testRow = testRows[index];
              const imageApiKind = modelKinds[field.key] ?? models?.[field.name]?.imageApiKind ?? "";
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
                    {imageApiKind === "" && (
                      <>
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
                      </>
                    )}
                    <Form.Item name={[field.name, "imageApiKind"]} className={styles.kindSelect} noStyle>
                      <Select
                        aria-label={`模型 ${index + 1} 的生图 API 类型`}
                        onChange={(value: "" | ImageApiKindValue) => setModelKinds((current) => ({ ...current, [field.key]: value }))}
                        options={[
                          { value: "", label: "无（推理）" },
                          { value: "openai_images", label: "openai_images" },
                          { value: "gemini", label: "gemini (Nano Banana)" },
                          { value: "custom", label: "custom" },
                        ]}
                      />
                    </Form.Item>
                    <Tooltip title={editing ? "仅检测连通性，不消耗生图额度" : "保存后可测试"}>
                      <Button
                        size="small"
                        icon={<PlugZap size={14} strokeWidth={1.75} />}
                        disabled={!editing}
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
        <Button onClick={onDone}>取消</Button>
        <Button
          type="primary"
          htmlType="submit"
          loading={createProvider.isPending || updateProvider.isPending}
        >
          {editing ? "保存" : "添加"}
        </Button>
      </div>
    </Form>
  );
}
