import { App, Input, Select } from "antd";
import { useEffect, useState } from "react";

import type { ProjectDetail, UpdateProjectInput } from "../../api/adapters/projectDetail";
import { useProviders } from "../../api/hooks/useProviders";
import { useUpdateProject } from "../../api/hooks/useProjects";
import { errorText } from "../../lib/errorText";
import { modelOptions } from "../../lib/modelOptions";
import styles from "./workbench.module.css";

function toLines(value: string[] | null | undefined): string {
  return (value ?? []).join("\n");
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 右栏检视（非分镜步）：文本失焦保存，模型下拉即时保存；改模型只影响后续任务。 */
export function ProjectInspector({ detail }: { detail: ProjectDetail }) {
  const { notification } = App.useApp();
  const updateProject = useUpdateProject(detail.id);
  const providers = useProviders();
  const reasoningOptions = modelOptions(providers.data?.items ?? [], "reasoning");
  const imageOptions = modelOptions(providers.data?.items ?? [], "image");

  const [description, setDescription] = useState(detail.productDescription ?? "");
  const [facts, setFacts] = useState(toLines(detail.verifiedFacts));
  const [claims, setClaims] = useState(toLines(detail.prohibitedClaims));

  useEffect(() => {
    setDescription(detail.productDescription ?? "");
    setFacts(toLines(detail.verifiedFacts));
    setClaims(toLines(detail.prohibitedClaims));
  }, [detail.productDescription, detail.verifiedFacts, detail.prohibitedClaims]);

  const save = async (body: UpdateProjectInput, failureTitle: string) => {
    try {
      await updateProject.mutateAsync(body);
    } catch (error) {
      notification.error({ title: failureTitle, description: errorText(error) });
    }
  };

  const commitDescription = () => {
    const next = description.trim();
    if (next === (detail.productDescription ?? "")) return;
    void save({ productDescription: next || null }, "保存描述失败");
  };
  const commitFacts = () => {
    if (facts === toLines(detail.verifiedFacts)) return;
    void save({ verifiedFacts: splitLines(facts) }, "保存事实失败");
  };
  const commitClaims = () => {
    if (claims === toLines(detail.prohibitedClaims)) return;
    void save({ prohibitedClaims: splitLines(claims) }, "保存禁止宣称失败");
  };

  const reasoningKey = `${detail.reasoningProviderId}::${detail.reasoningModelId}`;
  const imageKey = `${detail.imageProviderId}::${detail.imageModelId}`;
  const splitKey = (value: string) => {
    const [providerId, modelId] = value.split("::");
    return { providerId: providerId!, modelId: modelId! };
  };

  return (
    <div className={styles.inspector}>
      <p className={styles.sectionTitle}>检视</p>
      <label className={styles.fieldLabel}>
        商品描述
        <Input.TextArea
          aria-label="商品描述"
          rows={3}
          maxLength={400}
          value={description}
          placeholder="只写可核验事实，不要写疗效或未证实规格"
          onChange={(event) => setDescription(event.target.value)}
          onBlur={commitDescription}
        />
      </label>
      <label className={styles.fieldLabel}>
        已核验事实（每行一条）
        <Input.TextArea
          aria-label="已核验事实"
          rows={3}
          value={facts}
          placeholder="每行一条，例如：续航 8 小时"
          onChange={(event) => setFacts(event.target.value)}
          onBlur={commitFacts}
        />
      </label>
      <label className={styles.fieldLabel}>
        禁止宣称（每行一条）
        <Input.TextArea
          aria-label="禁止宣称"
          rows={2}
          value={claims}
          placeholder="每行一条，例如：医用级"
          onChange={(event) => setClaims(event.target.value)}
          onBlur={commitClaims}
        />
      </label>
      <label className={styles.fieldLabel}>
        推理模型
        <Select
          aria-label="推理模型"
          style={{ width: "100%", marginTop: 6 }}
          value={reasoningOptions.some((item) => item.value === reasoningKey) ? reasoningKey : undefined}
          options={reasoningOptions}
          placeholder="选择推理模型"
          onChange={(value) => void save({ reasoningModel: splitKey(value) }, "保存推理模型失败")}
        />
      </label>
      <label className={styles.fieldLabel}>
        生图模型
        <Select
          aria-label="生图模型"
          style={{ width: "100%", marginTop: 6 }}
          value={imageOptions.some((item) => item.value === imageKey) ? imageKey : undefined}
          options={imageOptions}
          placeholder="仅列出含 imageApiKind 的模型"
          onChange={(value) => void save({ imageModel: splitKey(value) }, "保存生图模型失败")}
        />
      </label>
    </div>
  );
}
