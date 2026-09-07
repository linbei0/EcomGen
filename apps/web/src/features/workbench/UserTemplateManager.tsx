import { App, Button, Form, Input, Modal, Select, Switch, Upload } from "antd";
import { ArrowLeft, FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  useCreateUserTemplate,
  useDeleteUserTemplate,
  useUpdateUserTemplate,
  type CreateUserTemplateInput,
  type UpdateUserTemplateInput,
  type UserTemplate,
} from "../../api/hooks/useUserTemplates";
import { errorText } from "../../lib/errorText";
import styles from "./workbench.module.css";

const NAME_MAX = 40;
/** 与契约 CreateUserTemplateInput.prompt.maxLength 一致；模板是规划输入，预算独立于最终 promptInstruction 的 4000。 */
const PROMPT_MAX = 20000;

const SIZE_OPTIONS = [
  { value: "1024x1024", label: "1:1 方图（1024×1024）" },
  { value: "1024x1536", label: "2:3 竖图（1024×1536）" },
];

interface TemplateFormValues {
  name: string;
  prompt: string;
  defaultSize: "1024x1024" | "1024x1536";
  supportsImageReference: boolean;
}

const EMPTY_VALUES: TemplateFormValues = {
  name: "",
  prompt: "",
  defaultSize: "1024x1024",
  supportsImageReference: true,
};

/** 自定义模板管理：列表 + 新建/编辑表单；提示词支持直接粘贴或导入 .txt/.md 文件。仅手动选择模式可用。 */
export function UserTemplateManager({
  open,
  items,
  onClose,
}: {
  open: boolean;
  items: UserTemplate[];
  onClose: () => void;
}) {
  const { notification } = App.useApp();
  const [editing, setEditing] = useState<UserTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const deleteTemplate = useDeleteUserTemplate();

  useEffect(() => {
    if (!open) {
      setEditing(null);
      setCreating(false);
    }
  }, [open]);

  const requestDelete = (template: UserTemplate) => {
    Modal.confirm({
      title: "删除自定义模板？",
      content: `「${template.name}」删除后无法恢复；引用它的旧分镜将无法生成或重新生成，需删除对应分镜或重新规划。`,
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteTemplate.mutateAsync(template.id);
        } catch (error) {
          notification.error({ title: "删除失败", description: errorText(error) });
          throw error;
        }
      },
    });
  };

  return (
    <Modal
      open={open}
      title={editing || creating ? (editing ? "编辑自定义模板" : "新建自定义模板") : `自定义模板（${items.length}）`}
      footer={null}
      onCancel={onClose}
      width={640}
      destroyOnHidden
    >
      {editing || creating ? (
        <TemplateForm
          key={editing?.id ?? "create"}
          template={editing}
          onBack={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      ) : (
        <div className={styles.userTemplateList}>
          {items.length === 0 ? (
            <p className={styles.userTemplateEmpty}>
              还没有自定义模板。新建后可在「手动选择」出图类型中勾选使用。
            </p>
          ) : (
            items.map((template) => (
              <div key={template.id} className={styles.userTemplateItem}>
                <div className={styles.userTemplateMain}>
                  <strong className={styles.userTemplateName} title={template.name}>{template.name}</strong>
                  <span className={styles.userTemplateMeta}>
                    {template.defaultSize === "1024x1536" ? "2:3 竖图" : "1:1 方图"}
                    {" · "}
                    {template.supportsImageReference ? "携带参考图" : "纯文生图"}
                  </span>
                  <p className={styles.userTemplatePrompt}>{template.prompt}</p>
                </div>
                <div className={styles.userTemplateActions}>
                  <Button size="small" icon={<Pencil size={13} strokeWidth={1.75} aria-hidden />} onClick={() => setEditing(template)}>
                    编辑
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<Trash2 size={13} strokeWidth={1.75} aria-hidden />}
                    loading={deleteTemplate.isPending}
                    onClick={() => requestDelete(template)}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))
          )}
          <Button
            type="dashed"
            block
            icon={<Plus size={14} strokeWidth={1.75} aria-hidden />}
            onClick={() => setCreating(true)}
          >
            新建模板
          </Button>
        </div>
      )}
    </Modal>
  );
}

function TemplateForm({
  template,
  onBack,
}: {
  template: UserTemplate | null;
  onBack: () => void;
}) {
  const { notification } = App.useApp();
  const [form] = Form.useForm<TemplateFormValues>();
  const createTemplate = useCreateUserTemplate();
  const updateTemplate = useUpdateUserTemplate();

  const initialValues: TemplateFormValues = template
    ? {
      name: template.name,
      prompt: template.prompt,
      defaultSize: template.defaultSize,
      supportsImageReference: template.supportsImageReference,
    }
    : EMPTY_VALUES;

  const handleFinish = async (values: TemplateFormValues) => {
    try {
      if (template) {
        const body: UpdateUserTemplateInput = {
          name: values.name.trim(),
          prompt: values.prompt,
          defaultSize: values.defaultSize,
          supportsImageReference: values.supportsImageReference,
        };
        await updateTemplate.mutateAsync({ templateId: template.id, body });
        notification.success({ title: "已保存自定义模板" });
      } else {
        const body: CreateUserTemplateInput = {
          name: values.name.trim(),
          prompt: values.prompt,
          defaultSize: values.defaultSize,
          supportsImageReference: values.supportsImageReference,
        };
        await createTemplate.mutateAsync(body);
        notification.success({ title: "已创建自定义模板" });
      }
      onBack();
    } catch (error) {
      notification.error({
        title: template ? "保存失败" : "创建失败",
        description: errorText(error),
      });
    }
  };

  // 导入 .txt/.md：文件名（去扩展名）回填空名称，全文截断到契约上限
  const importFile = async (file: File) => {
    const text = (await file.text()).slice(0, PROMPT_MAX);
    const current = form.getFieldsValue();
    form.setFieldsValue({
      ...current,
      prompt: text,
      name: current.name?.trim() ? current.name : file.name.replace(/\.[^.]+$/, "").slice(0, NAME_MAX),
    });
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onFinish={(values) => void handleFinish(values)}
      requiredMark="optional"
      className={styles.userTemplateForm}
    >
      <Button
        size="small"
        type="text"
        className={styles.userTemplateBack}
        icon={<ArrowLeft size={14} strokeWidth={1.75} aria-hidden />}
        onClick={onBack}
      >
        返回列表
      </Button>

      <Form.Item
        name="name"
        label="模板名称"
        rules={[{ required: true, whitespace: true, message: "填写模板名称" }]}
      >
        <Input placeholder="如：节日礼盒氛围主图" maxLength={NAME_MAX} />
      </Form.Item>

      <Form.Item
        name="prompt"
        label={
          <span className={styles.userTemplatePromptLabel}>
            提示词模板
            {/* beforeUpload 拦截后返回 false：文件只在本地读取，不产生上传请求 */}
            <Upload
              accept=".txt,.md,text/plain,text/markdown"
              showUploadList={false}
              maxCount={1}
              beforeUpload={(file) => {
                void importFile(file);
                return false;
              }}
            >
              <Button size="small" type="text" icon={<FileUp size={13} strokeWidth={1.75} aria-hidden />}>
                导入 .txt / .md
              </Button>
            </Upload>
          </span>
        }
        extra="完整提示词文本；可包含 {占位符}，规划 Agent 会结合项目上下文改写。"
        rules={[{ required: true, whitespace: true, message: "填写提示词模板" }]}
      >
        <Input.TextArea
          placeholder={"可直接粘贴提示词，或点击上方按钮导入文件。\n例如：极简白底产品图，柔和顶光，居中构图，85% 画面占比，突出 {产品卖点}。"}
          rows={8}
          maxLength={PROMPT_MAX}
          showCount
        />
      </Form.Item>

      <div className={styles.userTemplateParams}>
        <Form.Item name="defaultSize" label="默认尺寸" className={styles.userTemplateParamItem}>
          <Select options={SIZE_OPTIONS} />
        </Form.Item>
        <Form.Item
          name="supportsImageReference"
          label="携带参考图"
          valuePropName="checked"
          className={styles.userTemplateParamItem}
          extra="关闭后按纯文生图执行，不附加项目素材。"
        >
          <Switch />
        </Form.Item>
      </div>

      <div className={styles.userTemplateFormActions}>
        <Button onClick={onBack}>取消</Button>
        <Button type="primary" htmlType="submit" loading={createTemplate.isPending || updateTemplate.isPending}>
          {template ? "保存" : "创建"}
        </Button>
      </div>
    </Form>
  );
}
