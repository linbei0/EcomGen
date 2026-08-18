import { App, Button, Form, Input, Modal, Select, Steps } from "antd";
import { ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import type { CreateProjectInput } from "../../api/adapters/projectDetail";
import type { EcomTemplate } from "../../api/adapters/templates";
import { tipExcerpt } from "../../api/adapters/templates";
import { useCreateProject } from "../../api/hooks/useProjects";
import { useProviders, type ProviderConfig } from "../../api/hooks/useProviders";
import { useTemplates } from "../../api/hooks/useTemplates";
import { errorText } from "../../lib/errorText";
import { saveImageTypes } from "../../lib/imageTypes";
import styles from "./wizard.module.css";

type Mode = CreateProjectInput["defaultMode"];

interface WizardValues {
  name: string;
  category?: string;
  productDescription?: string;
  platformTargets: ("DOMESTIC" | "AMAZON")[];
  defaultMode: Mode;
  verifiedFacts: string;
  prohibitedClaims: string;
  reasoningKey?: string;
  imageKey?: string;
}

function modelOptions(providers: ProviderConfig[], kind: "reasoning" | "image") {
  return providers.flatMap((provider) =>
    provider.models
      .filter((model) => (kind === "image" ? Boolean(model.imageApiKind) : true))
      .map((model) => ({
        value: `${provider.id}::${model.id}`,
        label: `${provider.name} / ${model.id}`,
        vision: model.supportsVision,
      })),
  );
}

function splitLines(value: string | undefined): string[] {
  return (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseModelKey(value: string | undefined): { providerId: string; modelId: string } | null {
  if (!value) return null;
  const [providerId, modelId] = value.split("::");
  return providerId && modelId ? { providerId, modelId } : null;
}

export function CreateProjectWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [form] = Form.useForm<WizardValues>();
  const navigate = useNavigate();
  const { notification } = App.useApp();
  const templates = useTemplates();
  const providers = useProviders();
  const createProject = useCreateProject();
  const providerItems = providers.data?.items ?? [];
  const reasoningOptions = useMemo(() => modelOptions(providerItems, "reasoning"), [providerItems]);
  const imageOptions = useMemo(() => modelOptions(providerItems, "image"), [providerItems]);
  const reasoningKey = Form.useWatch("reasoningKey", form);
  const selectedReasoning = reasoningOptions.find((item) => item.value === reasoningKey);

  useEffect(() => {
    if (!open) return;
    const current = form.getFieldsValue();
    const patch: Partial<WizardValues> = {};
    if (!current.reasoningKey && reasoningOptions[0]) patch.reasoningKey = reasoningOptions[0].value;
    if (!current.imageKey && imageOptions[0]) patch.imageKey = imageOptions[0].value;
    if (Object.keys(patch).length > 0) form.setFieldsValue(patch);
  }, [form, imageOptions, open, reasoningOptions]);

  const toggleType = (id: string) => {
    setSelectedTypes((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const reset = () => {
    setStep(0);
    setSelectedTypes([]);
    form.resetFields();
  };

  const close = () => {
    reset();
    onClose();
  };

  const goNext = async () => {
    if (step === 0) {
      await form.validateFields(["name", "platformTargets"]);
      setStep(1);
      return;
    }
    if (step === 1) {
      if (selectedTypes.length === 0) {
        notification.error({ title: "请至少选择一种图片类型" });
        return;
      }
      setStep(2);
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    const reasoning = parseModelKey(values.reasoningKey);
    const image = parseModelKey(values.imageKey);
    if (!reasoning || !image) {
      notification.error({ title: "请选择推理模型与生图模型" });
      return;
    }
    const body: CreateProjectInput = {
      name: values.name.trim(),
      category: values.category?.trim() || null,
      productDescription: values.productDescription?.trim() || null,
      platformTargets: values.platformTargets,
      defaultMode: values.defaultMode,
      verifiedFacts: splitLines(values.verifiedFacts),
      prohibitedClaims: splitLines(values.prohibitedClaims),
      reasoningProviderId: reasoning.providerId,
      reasoningModelId: reasoning.modelId,
      imageProviderId: image.providerId,
      imageModelId: image.modelId,
    };
    try {
      const project = await createProject.mutateAsync(body);
      saveImageTypes(project.id, selectedTypes);
      notification.success({ title: "项目已创建" });
      close();
      void navigate(`/projects/${project.id}?stage=assets`);
    } catch (error) {
      notification.error({ title: "创建失败", description: errorText(error) });
    }
  };

  return (
    <Modal
      open={open}
      onCancel={close}
      title="新建项目"
      width={760}
      destroyOnHidden
      footer={
        <div className={styles.footer}>
          <Button onClick={step === 0 ? close : () => setStep((value) => value - 1)}>
            {step === 0 ? "取消" : "上一步"}
          </Button>
          {step < 2 ? (
            <Button type="primary" onClick={() => void goNext()}>
              下一步
            </Button>
          ) : (
            <Button type="primary" loading={createProject.isPending} onClick={() => void submit()}>
              创建项目
            </Button>
          )}
        </div>
      }
    >
      <Steps
        current={step}
        size="small"
        className={styles.steps}
        items={[{ title: "平台" }, { title: "图片类型" }, { title: "模式" }]}
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          platformTargets: ["DOMESTIC"],
          defaultMode: "CREATIVE",
          reasoningKey: reasoningOptions[0]?.value,
          imageKey: imageOptions[0]?.value,
        }}
      >
        <div hidden={step !== 0}>
          <Form.Item
            name="platformTargets"
            label="目标平台"
            rules={[{ required: true, type: "array", min: 1, message: "至少选择一个平台" }]}
          >
            <PlatformField />
          </Form.Item>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: "请填写项目名称" }]}>
            <Input placeholder="例如：无线耳机 SPU" maxLength={80} />
          </Form.Item>
          <Form.Item name="category" label="类目">
            <Input placeholder="可选" maxLength={40} />
          </Form.Item>
          <Form.Item name="productDescription" label="商品描述">
            <Input.TextArea rows={3} maxLength={400} placeholder="只写可核验事实，不要写疗效或未证实规格" />
          </Form.Item>
        </div>

        <div hidden={step !== 1}>
          <p className={styles.hint}>选择至少一种图片类型。规划阶段会读取本次选择。</p>
          {templates.isError ? <p className={styles.error}>{errorText(templates.error)}</p> : null}
          <div className={styles.gallery} role="list">
            {(templates.data ?? []).map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                selected={selectedTypes.includes(template.id)}
                onToggle={() => toggleType(template.id)}
              />
            ))}
          </div>
        </div>

        <div hidden={step !== 2} className={styles.stepThree}>
          <Form.Item name="defaultMode" label="默认模式" rules={[{ required: true }]}>
            <ModeField />
          </Form.Item>
          <Form.Item name="verifiedFacts" label="已核验事实">
            <Input.TextArea rows={3} placeholder="每行一条，例如：续航 8 小时" />
          </Form.Item>
          <Form.Item name="prohibitedClaims" label="禁止宣称">
            <Input.TextArea rows={2} placeholder="每行一条，例如：医用级" />
          </Form.Item>
          {providerItems.length === 0 ? (
            <p className={styles.hint}>还没有 Provider。可先创建项目所需模型，或到设置里添加。</p>
          ) : null}
          <Form.Item name="reasoningKey" label="推理模型" rules={[{ required: true, message: "请选择推理模型" }]}>
            <Select options={reasoningOptions} placeholder="选择推理模型" />
          </Form.Item>
          {selectedReasoning && !selectedReasoning.vision ? (
            <p className={styles.hint}>当前推理模型无视觉能力，可继续，但不会自动识图。</p>
          ) : null}
          <Form.Item name="imageKey" label="生图模型" rules={[{ required: true, message: "请选择生图模型" }]}>
            <Select options={imageOptions} placeholder="仅列出含 imageApiKind 的模型" />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}

function PlatformField({
  value,
  onChange,
}: {
  value?: ("DOMESTIC" | "AMAZON")[];
  onChange?: (value: ("DOMESTIC" | "AMAZON")[]) => void;
}) {
  const selected = value ?? [];
  const toggle = (next: "DOMESTIC" | "AMAZON") => {
    const exists = selected.includes(next);
    const updated = exists ? selected.filter((item) => item !== next) : [...selected, next];
    onChange?.(updated);
  };
  return (
    <div className={styles.platformRow}>
      <button type="button" data-active={selected.includes("DOMESTIC")} onClick={() => toggle("DOMESTIC")}>
        国内平台
      </button>
      <button type="button" data-active={selected.includes("AMAZON")} onClick={() => toggle("AMAZON")}>
        Amazon
      </button>
    </div>
  );
}

function ModeField({ value, onChange }: { value?: Mode; onChange?: (value: Mode) => void }) {
  return (
    <div className={styles.modeRow}>
      <button type="button" data-active={value === "CREATIVE"} onClick={() => onChange?.("CREATIVE")}>
        <Sparkles size={16} strokeWidth={1.75} aria-hidden />
        <strong>创意模式</strong>
        <span>语义一致，允许场景创作</span>
      </button>
      <button type="button" data-active={value === "PIXEL_PROTECTED"} onClick={() => onChange?.("PIXEL_PROTECTED")}>
        <ShieldCheck size={16} strokeWidth={1.75} aria-hidden />
        <strong>像素保护</strong>
        <span>保留主体像素，仅生成外部</span>
      </button>
    </div>
  );
}

function TemplateCard({
  template,
  selected,
  onToggle,
}: {
  template: EcomTemplate;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.templateCard}
      data-selected={selected}
      onClick={onToggle}
      role="listitem"
      aria-label={template.name}
      aria-pressed={selected}
    >
      <span className={styles.templateName}>{template.name}</span>
      <span className={styles.templateSize}>{template.defaultSize}</span>
      <span className={styles.templatePhrases}>{template.triggerPhrases.slice(0, 3).join(" / ")}</span>
      <span className={styles.templateTip}>{tipExcerpt(template.categoryTips)}</span>
    </button>
  );
}
