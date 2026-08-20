import { App, AutoComplete, Button, Input, Select, Switch, Tooltip } from "antd";
import { ChevronDown, Globe2, Languages, Layers3, MapPin, Package, SlidersHorizontal, Sparkles, Store, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { PlanningMode, ProjectDetail, TargetMarket, UpdateProjectInput } from "../../api/adapters/projectDetail";
import { useCreatePlanningJob } from "../../api/hooks/usePlanning";
import { useCopywritingResult, useCreateCopywritingJob, type CopywritingTarget } from "../../api/hooks/useCopywriting";
import { useJob, useRetryJob } from "../../api/hooks/useJobs";
import { useHealth } from "../../api/hooks/useHealth";
import { useProviders } from "../../api/hooks/useProviders";
import { useUpdateProject } from "../../api/hooks/useProjects";
import { useTemplates } from "../../api/hooks/useTemplates";
import { errorText } from "../../lib/errorText";
import { loadImageTypes, saveImageTypes } from "../../lib/imageTypes";
import { jobErrorText } from "../../lib/jobError";
import { modelOptions } from "../../lib/modelOptions";
import { canResubmitPlan, isActiveJob, latestPlanJob } from "../../lib/planJob";
import { ASPECT_LABEL, RESOLUTION_LABEL } from "../../lib/roles";
import { DEFAULT_TARGET_IMAGE_COUNT, MAX_TARGET_IMAGE_COUNT, MIN_TARGET_IMAGE_COUNT } from "@ecomgen/contracts";
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

const MARKET_OPTIONS: Array<{ value: Exclude<TargetMarket, null>; label: string }> = [
  { value: "CHINA_MAINLAND", label: "中国大陆" }, { value: "HONG_KONG", label: "香港" },
  { value: "MACAU", label: "澳门" }, { value: "TAIWAN", label: "台湾" },
  { value: "UNITED_STATES", label: "美国" }, { value: "UNITED_KINGDOM", label: "英国" },
  { value: "GERMANY", label: "德国" }, { value: "FRANCE", label: "法国" },
  { value: "ITALY", label: "意大利" }, { value: "SPAIN", label: "西班牙" },
  { value: "JAPAN", label: "日本" }, { value: "SOUTH_KOREA", label: "韩国" },
];

const COPY_LANGUAGE_OPTIONS = [
  { value: "zh-Hans", label: "简体中文 (zh-Hans)" }, { value: "zh-Hant", label: "繁体中文 (zh-Hant)" },
  { value: "en-US", label: "English (US)" }, { value: "en-GB", label: "English (UK)" },
  { value: "de-DE", label: "Deutsch" }, { value: "fr-FR", label: "Francais" },
  { value: "it-IT", label: "Italiano" }, { value: "es-ES", label: "Espanol" },
  { value: "ja-JP", label: "日本語" }, { value: "ko-KR", label: "한국어" },
];

export function SetupPanel({ detail }: { detail: ProjectDetail }) {
  const { notification } = App.useApp();
  const updateProject = useUpdateProject(detail.id);
  const providers = useProviders();
  const health = useHealth();
  const templates = useTemplates();
  const createPlan = useCreatePlanningJob(detail.id);
  const createCopywriting = useCreateCopywritingJob(detail.id);
  const retryJob = useRetryJob(detail.id);
  const catalog = templates.data ?? [];
  const stored = useMemo(() => loadImageTypes(detail.id), [detail.id]);
  const [name, setName] = useState(detail.name);
  const [description, setDescription] = useState(detail.productDescription ?? "");
  const [facts, setFacts] = useState(toLines(detail.verifiedFacts));
  const [claims, setClaims] = useState(toLines(detail.prohibitedClaims));
  const [planningMode, setPlanningMode] = useState<PlanningMode>("AI");
  const [targetImageCount, setTargetImageCount] = useState(DEFAULT_TARGET_IMAGE_COUNT);
  const [selected, setSelected] = useState<string[]>(stored);
  const [instruction, setInstruction] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | undefined>(undefined);
  const [activeCopywritingJob, setActiveCopywritingJob] = useState<{ id: string; target: CopywritingTarget } | undefined>(undefined);
  const [copyLanguage, setCopyLanguage] = useState(detail.copyLanguage ?? "");
  const [savedCopyLanguage, setSavedCopyLanguage] = useState(detail.copyLanguage ?? "");
  const handledCopywritingJobs = useRef(new Set<string>());

  useEffect(() => setName(detail.name), [detail.name]);
  useEffect(() => {
    setDescription(detail.productDescription ?? "");
    setFacts(toLines(detail.verifiedFacts));
    setClaims(toLines(detail.prohibitedClaims));
  }, [detail.productDescription, detail.verifiedFacts, detail.prohibitedClaims]);
  useEffect(() => {
    const next = detail.copyLanguage ?? "";
    setCopyLanguage(next);
    setSavedCopyLanguage(next);
  }, [detail.copyLanguage]);
  useEffect(() => {
    if (selected.length > 0 || catalog.length === 0 || stored.length > 0) return;
    setSelected([catalog[0]!.id]);
  }, [catalog, selected.length, stored.length]);

  const save = async (body: UpdateProjectInput, failureTitle: string) => {
    try {
      await updateProject.mutateAsync(body);
    } catch (error) {
      notification.error({ title: failureTitle, description: errorText(error) });
    }
  };

  const commitName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === detail.name) {
      setName(detail.name);
      return;
    }
    await save({ name: trimmed }, "保存名称失败");
  };

  const commitCopyLanguage = (value: string) => {
    const next = value.trim();
    if (next === savedCopyLanguage) return;
    setCopyLanguage(next);
    setSavedCopyLanguage(next);
    void save({ copyLanguage: next || null }, "保存文案语种失败");
  };

  const seedJob = latestPlanJob(detail.jobs);
  const liveJob = useJob(detail.id, activeJobId ?? seedJob?.id);
  const job = liveJob.data ?? seedJob;
  const planning = isActiveJob(job);
  const productCount = detail.assets.filter((asset) => asset.role === "PRODUCT_TRUTH").length;
  const copywritingJobQuery = useJob(detail.id, activeCopywritingJob?.id);
  const copywritingJob = copywritingJobQuery.data;
  const copywritingResult = useCopywritingResult(
    activeCopywritingJob?.id,
    copywritingJob?.status === "SUCCEEDED",
  );
  const reasoningOptions = modelOptions(providers.data?.items ?? [], "reasoning");
  const imageOptions = modelOptions(providers.data?.items ?? [], "image");
  const reasoningKey = `${detail.reasoningProviderId}::${detail.reasoningModelId}`;
  const imageKey = `${detail.imageProviderId}::${detail.imageModelId}`;
  const webResearchAvailable = health.data?.webResearchAvailable === true;
  const configuredReasoningModel = providers.data?.items
    .find((provider) => provider.id === detail.reasoningProviderId)
    ?.models.find((model) => model.id === detail.reasoningModelId);
  const copywritingUnavailableReason = productCount === 0
    ? "请先上传至少一张产品图"
    : providers.data && !configuredReasoningModel
      ? "当前推理模型不可用"
    : configuredReasoningModel && !configuredReasoningModel.supportsVision
      ? "当前推理模型不支持图片识别"
      : undefined;
  const copywritingActive = createCopywriting.isPending || (Boolean(activeCopywritingJob) && !copywritingJob) || copywritingJob?.status === "QUEUED" || copywritingJob?.status === "RUNNING";
  const splitKey = (value: string) => {
    const [providerId, modelId] = value.split("::");
    return { providerId: providerId!, modelId: modelId! };
  };

  const toggleType = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) {
        return current.length === 1 ? current : current.filter((item) => item !== id);
      }
      return [...current, id];
    });
  };

  const startCopywriting = async (target: CopywritingTarget) => {
    if (copywritingUnavailableReason) {
      notification.warning({ title: copywritingUnavailableReason });
      return;
    }
    try {
      const created = await createCopywriting.mutateAsync({ target, regenerationKey: crypto.randomUUID() });
      setActiveCopywritingJob({ id: created.id, target });
    } catch (error) {
      notification.error({ title: "AI 帮写提交失败", description: errorText(error) });
    }
  };

  useEffect(() => {
    if (!copywritingResult.data || !activeCopywritingJob || handledCopywritingJobs.current.has(activeCopywritingJob.id)) return;
    handledCopywritingJobs.current.add(activeCopywritingJob.id);
    if (copywritingResult.data.target === "PRODUCT_DESCRIPTION") {
      setDescription(copywritingResult.data.content);
      void save({ productDescription: copywritingResult.data.content }, "保存 AI 商品描述失败");
      return;
    }
    setInstruction(copywritingResult.data.content);
  }, [activeCopywritingJob, copywritingResult.data]);

  useEffect(() => {
    if (!copywritingJob || copywritingJob.status !== "FAILED" || handledCopywritingJobs.current.has(copywritingJob.id)) return;
    handledCopywritingJobs.current.add(copywritingJob.id);
    notification.error({ title: "AI 帮写失败", description: jobErrorText(copywritingJob) ?? "生成服务未返回文案" });
  }, [copywritingJob, notification]);

  const submitPlan = async () => {
    if (planningMode === "MANUAL" && selected.length === 0) {
      notification.error({ title: "至少选择一种图片类型" });
      return;
    }
    try {
      const created = await createPlan.mutateAsync({
        planningMode,
        requestedTypes: planningMode === "MANUAL" ? selected : undefined,
        userInstruction: instruction.trim() || undefined,
        candidatesPerType: detail.candidatesPerType,
        ...(planningMode === "AI" ? { targetImageCount } : {}),
        imageResolution: detail.imageResolution,
        imageAspectRatio: detail.imageAspectRatio,
        regenerationKey: seedJob?.status === "SUCCEEDED" ? crypto.randomUUID() : undefined,
      });
      if (selected.length > 0) saveImageTypes(detail.id, selected);
      setActiveJobId(created.id);
      if (created.reused) {
        notification.info({
          title: "已使用已有规划",
          description: "当前配置与上次规划相同，系统复用了已有结果；修改配置或补充说明后可重新规划。",
        });
      }
    } catch (error) {
      notification.error({ title: "规划提交失败", description: errorText(error) });
    }
  };

  return (
    <div className={styles.setup}>
      <p className={styles.sectionTitle}>
        <Package size={14} strokeWidth={1.75} aria-hidden className={styles.sectionTitleIcon} />
        商品
      </p>
      <Input
        aria-label="项目名称"
        className={styles.nameInput}
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => void commitName()}
      />
      <Section title="市场与创作" icon={<Globe2 size={14} strokeWidth={1.75} aria-hidden />}>
        <div className={styles.compactFields}>
          <label className={styles.fieldLabel}>
            <span className={styles.fieldLabelTitle}><Store size={13} strokeWidth={1.75} aria-hidden />目标平台</span>
            <Select
              aria-label="目标平台"
              allowClear
              placeholder="请选择目标平台"
              value={detail.platformTargets[0]}
              options={[{ value: "DOMESTIC", label: "大陆电商" }, { value: "AMAZON", label: "Amazon" }]}
              onChange={(value: "DOMESTIC" | "AMAZON" | undefined) => void save({ platformTargets: value ? [value] : [] }, "保存平台失败")}
            />
          </label>
          <label className={styles.fieldLabel}>
            <span className={styles.fieldLabelTitle}><MapPin size={13} strokeWidth={1.75} aria-hidden />目标市场</span>
            <Select
              aria-label="目标市场"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="请选择目标市场"
              value={detail.targetMarket ?? undefined}
              options={MARKET_OPTIONS}
              onChange={(value: Exclude<TargetMarket, null> | undefined) => void save({ targetMarket: value ?? null }, "保存目标市场失败")}
            />
          </label>
          <label className={styles.fieldLabel}>
            <span className={styles.fieldLabelTitle}><Languages size={13} strokeWidth={1.75} aria-hidden />文案语种</span>
            <AutoComplete
              aria-label="文案语种"
              allowClear
              value={copyLanguage || undefined}
              options={COPY_LANGUAGE_OPTIONS}
              placeholder="请选择或输入文案语种"
              onChange={(value) => setCopyLanguage(value)}
              onSelect={(value) => commitCopyLanguage(value)}
              onBlur={() => commitCopyLanguage(copyLanguage)}
              onClear={() => commitCopyLanguage("")}
            />
          </label>
          <label className={styles.fieldLabel}>
            <span className={styles.fieldLabelTitle}><Sparkles size={13} strokeWidth={1.75} aria-hidden />默认模式</span>
            <Select
              aria-label="默认模式"
              value={detail.defaultMode}
              options={[
                { value: "CREATIVE", label: "创意模式 · 允许场景创作" },
                { value: "PIXEL_PROTECTED", label: "像素保护 · 保留主体像素" },
              ]}
              onChange={(value) => void save({ defaultMode: value }, "保存模式失败")}
            />
          </label>
        </div>
      </Section>

      <Section title="核心卖点" icon={<Sparkles size={14} strokeWidth={1.75} aria-hidden />}>
        <label className={styles.fieldLabel}>
          商品描述
          <div className={styles.aiTextArea}>
            <Input.TextArea
              aria-label="商品描述"
              rows={3}
              maxLength={400}
              value={description}
              placeholder="描述产品特点、目标人群和使用场景；具体可宣称参数请填写在下方。"
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => {
                const next = description.trim();
                if (next === (detail.productDescription ?? "")) return;
                void save({ productDescription: next || null }, "保存描述失败");
              }}
            />
            <AiWriteButton
              label="AI 帮写商品描述"
              disabled={Boolean(copywritingUnavailableReason) || copywritingActive}
              loading={copywritingActive && activeCopywritingJob?.target === "PRODUCT_DESCRIPTION"}
              reason={copywritingUnavailableReason}
              onClick={() => void startCopywriting("PRODUCT_DESCRIPTION")}
            />
          </div>
        </label>
        <label className={styles.fieldLabel}>
          已核验事实（每行一条）
          <Input.TextArea
            aria-label="已核验事实"
            rows={3}
            value={facts}
            placeholder="每行一条，例如：续航 8 小时"
            onChange={(event) => setFacts(event.target.value)}
            onBlur={() => {
              if (facts === toLines(detail.verifiedFacts)) return;
              void save({ verifiedFacts: splitLines(facts) }, "保存事实失败");
            }}
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
            onBlur={() => {
              if (claims === toLines(detail.prohibitedClaims)) return;
              void save({ prohibitedClaims: splitLines(claims) }, "保存禁止宣称失败");
            }}
          />
        </label>
      </Section>

      <Section title="出图参数" icon={<SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden />}>
        <div className={styles.paramGrid}>
          <label className={styles.fieldLabel}>
            推理模型
            <Select
              aria-label="推理模型"
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
              value={imageOptions.some((item) => item.value === imageKey) ? imageKey : undefined}
              options={imageOptions}
              placeholder="仅列出含 imageApiKind 的模型"
              onChange={(value) => void save({ imageModel: splitKey(value) }, "保存生图模型失败")}
            />
          </label>
          <label className={styles.fieldLabel}>
            分辨率
            <Select
              aria-label="分辨率"
              value={detail.imageResolution}
              options={Object.entries(RESOLUTION_LABEL).map(([value, label]) => ({ value, label }))}
              onChange={(imageResolution) => void save({ imageResolution }, "保存分辨率失败")}
            />
          </label>
          <label className={styles.fieldLabel}>
            图片比例
            <Select
              aria-label="图片比例"
              value={detail.imageAspectRatio}
              options={Object.entries(ASPECT_LABEL).map(([value, label]) => ({ value, label }))}
              onChange={(imageAspectRatio) => void save({ imageAspectRatio }, "保存比例失败")}
            />
          </label>
        </div>
        <div className={styles.stepper}>
          <span>每类型出图数</span>
          <button
            type="button"
            aria-label="减少出图数"
            disabled={detail.candidatesPerType <= 1}
            onClick={() => void save({ candidatesPerType: detail.candidatesPerType - 1 }, "保存出图数失败")}
          >
            −
          </button>
          <strong>{detail.candidatesPerType}</strong>
          <button
            type="button"
            aria-label="增加出图数"
            disabled={detail.candidatesPerType >= 4}
            onClick={() => void save({ candidatesPerType: detail.candidatesPerType + 1 }, "保存出图数失败")}
          >
            +
          </button>
        </div>
      </Section>

      <Section title="出图类型" icon={<Layers3 size={14} strokeWidth={1.75} aria-hidden />}>
        <div className={styles.kindToggle} role="group" aria-label="规划方式">
          <button type="button" data-active={planningMode === "AI"} onClick={() => setPlanningMode("AI")}>
            AI 智能规划
          </button>
          <button type="button" data-active={planningMode === "MANUAL"} onClick={() => setPlanningMode("MANUAL")}>
            手动选择
          </button>
        </div>
        {planningMode === "MANUAL" ? (
          <div className={styles.chipRow}>
            {catalog.map((item) => {
              const on = selected.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={styles.chip}
                  data-on={on}
                  aria-pressed={on}
                  onClick={() => toggleType(item.id)}
                >
                  {item.name}
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <p className={styles.hint}>Agent 会根据卖点和素材自动选择一组有转化逻辑的图片类型。</p>
            <div className={styles.stepper}>
              <span>规划图片数</span>
              <button
                type="button"
                aria-label="减少规划图片数"
                disabled={targetImageCount <= MIN_TARGET_IMAGE_COUNT}
                onClick={() => setTargetImageCount((count) => count - 1)}
              >
                −
              </button>
              <strong>{targetImageCount}</strong>
              <button
                type="button"
                aria-label="增加规划图片数"
                disabled={targetImageCount >= MAX_TARGET_IMAGE_COUNT}
                onClick={() => setTargetImageCount((count) => count + 1)}
              >
                +
              </button>
            </div>
          </>
        )}
        <div className={styles.aiTextArea}>
          <Input.TextArea
            aria-label="补充说明"
            value={instruction}
            maxLength={4000}
            rows={3}
            placeholder="补充画面限制、构图偏好或不要出现的内容（可选）"
            onChange={(event) => setInstruction(event.target.value)}
          />
          <AiWriteButton
            label="AI 帮写补充说明"
            disabled={Boolean(copywritingUnavailableReason) || copywritingActive}
            loading={copywritingActive && activeCopywritingJob?.target === "PLANNING_INSTRUCTION"}
            reason={copywritingUnavailableReason}
            onClick={() => void startCopywriting("PLANNING_INSTRUCTION")}
          />
        </div>
        <div className={styles.researchControl}>
          <div>
            <span className={styles.researchLabel}><Globe2 size={14} strokeWidth={1.75} aria-hidden /> 联网视觉研究</span>
            <p className={styles.researchHint}>仅检索近期构图、光线、材质表现和平台版式；不会搜索或补充商品事实。</p>
          </div>
          <Tooltip title={webResearchAvailable ? "搜索服务已配置，启用后本项目的分镜规划可使用视觉研究" : "服务端尚未配置搜索 API Key，暂不能开启"}>
            <Switch
              aria-label="联网视觉研究"
              checked={detail.webResearchEnabled}
              disabled={!webResearchAvailable || updateProject.isPending}
              onChange={(webResearchEnabled) => void save({ webResearchEnabled }, "保存联网视觉研究设置失败")}
            />
          </Tooltip>
        </div>
        {detail.webResearchEnabled && !webResearchAvailable ? <p className={styles.researchUnavailable}>服务端未配置搜索服务，本次规划不会联网。</p> : null}
      </Section>

      {detail.defaultMode === "PIXEL_PROTECTED" && productCount === 0 ? (
        <p className={styles.banner}>像素保护需要至少一张产品图，否则生成会失败。</p>
      ) : null}
      {job?.status === "FAILED" && jobErrorText(job) ? <p className={styles.jobError}>{jobErrorText(job)}</p> : null}
      {job?.status === "QUEUED" || job?.status === "RUNNING" ? (
        <p className={styles.jobStatus}>{job.status === "QUEUED" ? "排队中" : "规划中"}</p>
      ) : null}
      {canResubmitPlan(job) && job?.status === "FAILED" ? (
        <Button loading={retryJob.isPending} onClick={() => job && void retryJob.mutateAsync(job.id).then((next) => setActiveJobId(next.id))}>
          重试规划
        </Button>
      ) : (
        <Button type="primary" loading={createPlan.isPending || planning} onClick={() => void submitPlan()}>
          生成分镜
        </Button>
      )}
    </div>
  );
}

function AiWriteButton({ label, disabled, loading, reason, onClick }: {
  label: string;
  disabled: boolean;
  loading: boolean;
  reason: string | undefined;
  onClick: () => void;
}) {
  const button = (
    <button type="button" className={styles.aiWriteButton} aria-label={label} disabled={disabled} onClick={onClick}>
      <WandSparkles size={14} strokeWidth={1.8} aria-hidden />
      <span>{loading ? "生成中" : "AI 帮写"}</span>
    </button>
  );
  const wrapped = <span className={styles.aiWriteTooltip}>{button}</span>;
  return reason ? <Tooltip title={reason}>{wrapped}</Tooltip> : wrapped;
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={styles.section}>
      <button
        type="button"
        className={styles.sectionHead}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.sectionHeadLabel}>
          <span className={styles.sectionTitleIcon}>{icon}</span>
          {title}
        </span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden className={styles.sectionChevron} data-open={open} />
      </button>
      {open ? <div className={styles.sectionBody}>{children}</div> : null}
    </section>
  );
}
