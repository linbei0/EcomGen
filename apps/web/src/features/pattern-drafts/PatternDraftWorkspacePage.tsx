import { useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Image, Input, Modal, Popconfirm, Segmented, Select, Slider, Space, Tag, Tooltip } from "antd";
import { ArrowLeft, Download, ImagePlus, Info, Layers, Palette, RefreshCw, Scissors, Sparkles, Trash2, Undo2, Wand2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { PATTERN_DRAFT_MEDIA_MAX } from "@ecomgen/contracts";
import { useProviders } from "../../api/hooks/useProviders";
import {
  useCreateDraftBatch,
  useCreateDraftEdit,
  useCreateDraftMedia,
  useDraftBatches,
  useDraftCandidates,
  useDraftMedia,
  useDraftTileCheck,
  useDeleteDraftCandidate,
  useDeleteDraftMedia,
  useFinalizeDraftCandidate,
  usePatternDraft,
  useRetryDraftBatch,
  useUpdatePatternDraft,
  type CreateDraftBatchBody,
  type DraftBatch,
  type DraftCandidate,
  type DraftConditions,
  type DraftMedia,
  type PatternDraft,
} from "../../api/hooks/usePatternDrafts";
import { relativeTime } from "../../lib/format";
import { DRAFT_COMPOSE_TYPE_OPTIONS, ImageModelSelect, POD_REPEAT_LAYOUT_OPTIONS, TileVerdict, statusLabel } from "../patterns/shared";
import { qk } from "../../api/queryKeys";
import { ApiError } from "../../api/errors";
import { errorText } from "../../lib/errorText";
import { downloadOriginal } from "../../lib/downloadImage";
import { parseModelKey, segmentationModelOptions } from "../../lib/modelOptions";
import { useFileDropTarget } from "../../lib/fileDrop";
import { randomUuid } from "../../lib/randomUuid";
import { MaskEditorDialog } from "./MaskEditorDialog";
import { ReferenceTextArea, type ReferenceOption } from "./ReferenceTextArea";
import { RepeatPreview } from "./RepeatPreview";
import styles from "./PatternDraftWorkspacePage.module.css";

const OPERATION_LABELS: Record<string, string> = {
  GENERATE: "生成",
  EDIT_WHOLE: "整图修改",
  EDIT_LOCAL: "局部修改",
  RECOLOR: "调色",
  PALETTE_VARIANT: "色板变体",
  CUTOUT: "去底",
  SEAM_EDIT: "接缝改稿",
};


function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

interface LocalDraft {
  name: string;
  conditions: DraftConditions;
  selectedCandidateId: string | null;
  compareCandidateId: string | null;
}

function localFrom(draft: PatternDraft): LocalDraft {
  return { name: draft.name, conditions: draft.conditions, selectedCandidateId: draft.selectedCandidateId, compareCandidateId: draft.compareCandidateId };
}

/**
 * AI 起稿工作台。
 *
 * 页面只保存交互过程：主题/条件/参考/选中/比较/候选/任务都以服务端为真相，自动保存走 revision CAS，
 * 冲突时保留本地未提交内容并提示重新加载。生成与改稿都必须显式提交；刷新与离开不中止后台任务。
 */
export function PatternDraftWorkspacePage() {
  const { draftId = "" } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const draftQuery = usePatternDraft(draftId);
  const mediaQuery = useDraftMedia(draftId);
  const batchesQuery = useDraftBatches(draftId);
  const batches = useMemo(() => batchesQuery.data?.items ?? [], [batchesQuery.data]);
  // 界面忙碌态只看是否还有排队/运行中的槽位；候选拉取不看它，避免终态瞬间漏拉。
  const busy = batches.some((batch) => batch.slots.some((slot) => slot.status === "QUEUED" || slot.status === "RUNNING"));
  // 应到候选数＝已成功且仍有产物的槽位数；候选列表追平它之前保持轮询，避免最后一个槽位完成时漏拉新候选。
  // 必须带上 candidateId：候选被删除后槽位仍是 SUCCEEDED，只数状态会把轮询永远吊在追不上的一侧。
  const expectedCandidates = useMemo(
    () => batches.reduce((total, batch) => total + batch.slots.filter((slot) => slot.status === "SUCCEEDED" && slot.candidateId).length, 0),
    [batches],
  );
  const candidatesQuery = useDraftCandidates(draftId, expectedCandidates);
  const candidates = useMemo(() => candidatesQuery.data?.items ?? [], [candidatesQuery.data]);
  const media = useMemo(() => mediaQuery.data?.items ?? [], [mediaQuery.data]);
  const providersQuery = useProviders();

  const updateDraft = useUpdatePatternDraft(draftId);
  const uploadMedia = useCreateDraftMedia(draftId);
  const deleteMedia = useDeleteDraftMedia(draftId);
  const createBatch = useCreateDraftBatch(draftId);
  const createEdit = useCreateDraftEdit(draftId);
  const retryBatch = useRetryDraftBatch(draftId);
  const tileCheck = useDraftTileCheck(draftId);
  const finalize = useFinalizeDraftCandidate(draftId);
  const deleteCandidate = useDeleteDraftCandidate(draftId);

  const [local, setLocal] = useState<LocalDraft | null>(null);
  const localRef = useRef<LocalDraft | null>(null);
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error" | "conflict">("saved");
  const [nonce, setNonce] = useState(0);
  const pendingKeyRef = useRef<string | null>(null);
  const startedBatchesRef = useRef<Set<string>>(new Set());
  const notifiedBatchesRef = useRef<Set<string>>(new Set());
  const retryPendingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!draftQuery.data) return;
    revisionRef.current = Math.max(revisionRef.current, draftQuery.data.revision);
    if (dirtyRef.current || savingRef.current) return;
    const next = localFrom(draftQuery.data);
    localRef.current = next;
    setLocal(next);
  }, [draftQuery.data]);

  const flush = useCallback(async () => {
    const payload = localRef.current;
    if (!payload || !draftId || savingRef.current) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      const saved = await updateDraft.mutateAsync({
        expectedRevision: revisionRef.current,
        name: payload.name,
        conditions: payload.conditions,
        selectedCandidateId: payload.selectedCandidateId,
        compareCandidateId: payload.compareCandidateId,
      });
      revisionRef.current = saved.revision;
      dirtyRef.current = false;
      setSaveState("saved");
    } catch (error) {
      if (isConflict(error)) {
        setSaveState("conflict");
        message.warning("草稿已在别处更新，本地修改未保存；请选择重新加载或再次提交");
      } else {
        setSaveState("error");
        message.error(`自动保存失败：${errorText(error)}`);
      }
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) setNonce((value) => value + 1);
    }
  }, [draftId, message, updateDraft]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => { void flush(); }, 700);
    return () => window.clearTimeout(timer);
  }, [nonce, local, flush]);

  const patchLocal = useCallback((patch: Partial<LocalDraft>) => {
    setLocal((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch, conditions: patch.conditions ?? prev.conditions };
      localRef.current = next;
      return next;
    });
    dirtyRef.current = true;
    setNonce((value) => value + 1);
  }, []);

  const reloadFromServer = async (): Promise<void> => {
    const result = await draftQuery.refetch();
    if (result.data) {
      const next = localFrom(result.data);
      localRef.current = next;
      setLocal(next);
      revisionRef.current = result.data.revision;
      dirtyRef.current = false;
      setSaveState("saved");
    }
  };

  // 未显式选过时回显最新候选：候选按 created_at 升序返回，末位即最近生成的。
  // 一旦用户点过某张，选择就固定在他那张，后续新结果只进轨道、不抢当前视图。
  const selectedId = local?.selectedCandidateId ?? candidates[candidates.length - 1]?.id ?? null;
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[candidates.length - 1] ?? null;
  const compareCandidate = candidates.find((candidate) => candidate.id === local?.compareCandidateId) ?? null;

  // 候选轨按批次倒序分组：最近一批排在最上方，符合"先看最新结果"的浏览顺序。
  // 只保留有候选的批次——无候选的批次（排队中/全部失败）属于进度信息，归「生成记录」。
  const candidateGroups = useMemo(
    () =>
      [...batches]
        .reverse()
        .map((batch) => ({
          batch,
          items: candidates.filter((candidate) => candidate.batchId === batch.id).sort((a, b) => a.slotIndex - b.slotIndex),
        }))
        .filter((group) => group.items.length > 0),
    [batches, candidates],
  );

  const modelKey = local?.conditions.providerId && local.conditions.imageModelId ? `${local.conditions.providerId}::${local.conditions.imageModelId}` : null;
  // 引用编号由服务端分配，客户端只按编号展示与插入；没有编号的条目（老数据）不参与引用。
  // 两层都用 useMemo：输入框每次击键都会重渲染本页，逐击键重建数组会把下游 memo 全部打穿。
  const referenceMedia = useMemo(() => media.filter((item) => item.role === "REFERENCE"), [media]);
  const referenceOptions = useMemo<ReferenceOption[]>(
    () => referenceMedia.flatMap((item) => (item.ordinal === null ? [] : [{ ordinal: item.ordinal, fileName: item.fileName, thumbUrl: item.thumbUrl }])),
    [referenceMedia],
  );

  // 候选轮询只在存在 QUEUED/RUNNING 槽位时开启，最后一个槽位完成时轮询随之中止；
  // 若候选恰好在最后一次轮询之后写库，这一张就永远不会被拉取，表现为"生成成功却不回显"。
  // 槽位状态签名在任一状态迁移时变化，用它显式失效候选查询，保证终态后必有一次拉取。
  const slotSignature = useMemo(
    () => batches.map((batch) => `${batch.id}:${batch.slots.map((slot) => slot.status).join(",")}`).join("|"),
    [batches],
  );
  const slotSignatureRef = useRef("");
  useEffect(() => {
    if (slotSignature === slotSignatureRef.current) return;
    slotSignatureRef.current = slotSignature;
    if (!slotSignature) return;
    void queryClient.invalidateQueries({ queryKey: qk.draftCandidates(draftId) });
  }, [slotSignature, draftId, queryClient]);

  // 本会话提交的批次进入终态时通知结果，避免用户不知道后台已经跑完。
  useEffect(() => {
    const finished = batches.filter(
      (batch) =>
        startedBatchesRef.current.has(batch.id) &&
        !notifiedBatchesRef.current.has(batch.id) &&
        !retryPendingRef.current.has(batch.id) &&
        batch.slots.every((slot) => slot.status !== "QUEUED" && slot.status !== "RUNNING"),
    );
    if (finished.length === 0) return;
    for (const batch of finished) {
      notifiedBatchesRef.current.add(batch.id);
      const succeeded = batch.slots.filter((slot) => slot.status === "SUCCEEDED").length;
      const failed = batch.slots.length - succeeded;
      if (succeeded > 0) message.success(failed > 0 ? `本批完成：${succeeded} 张成功，${failed} 张失败` : `本批完成：${succeeded} 张候选已生成`);
      else message.error("本批全部失败，可在批次中补偿失败项");
    }
  }, [batches, message]);

  const submitBatch = async (operation: CreateDraftBatchBody["operation"], extras: Partial<CreateDraftBatchBody> = {}, parentCandidateId?: string): Promise<void> => {
    if (!local) return;
    const { providerId, modelId } = modelKey ? parseModelKey(modelKey) : { providerId: "", modelId: "" };
    const clientKey = pendingKeyRef.current ?? randomUuid();
    pendingKeyRef.current = clientKey;
    const conditions = local.conditions;
    const body: CreateDraftBatchBody = {
      clientKey,
      operation,
      candidateCount: conditions.candidateCount,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { imageModelId: modelId } : {}),
      theme: conditions.theme,
      aspectRatio: conditions.aspectRatio,
      background: conditions.background,
      ...(conditions.repeatLayout ? { repeatLayout: conditions.repeatLayout } : {}),
      ...(referenceMedia.length ? { references: referenceMedia.map((item) => item.id) } : {}),
      ...(parentCandidateId ? { parentCandidateId } : {}),
      ...extras,
    };
    try {
      const result = parentCandidateId ? await createEdit.mutateAsync({ candidateId: parentCandidateId, body }) : await createBatch.mutateAsync(body);
      startedBatchesRef.current.add(result.batch.id);
      pendingKeyRef.current = null;
      message.success(result.reused ? "已复用同一提交的批次" : "已提交，可在右侧「生成记录」查看进度");
    } catch (error) {
      message.error(errorText(error));
    }
  };

  const onUploadReferences = useCallback(async (files: File[]): Promise<void> => {
    const images = files.filter((file) => file.type.startsWith("image/") || file.type === "");
    if (images.length === 0) {
      message.error("只支持图片文件");
      return;
    }
    // 上限在服务端强制；这里先按剩余额度截断，避免整批被拒后用户不知道哪几张没进去。
    const room = PATTERN_DRAFT_MEDIA_MAX - referenceMedia.length;
    if (room <= 0) {
      message.warning(`参考图最多 ${PATTERN_DRAFT_MEDIA_MAX} 张`);
      return;
    }
    const accepted = images.slice(0, room);
    if (accepted.length < images.length) message.warning(`参考图最多 ${PATTERN_DRAFT_MEDIA_MAX} 张，本次只加入 ${accepted.length} 张`);
    for (const file of accepted) {
      try {
        await uploadMedia.mutateAsync({ file, role: "REFERENCE", source: "UPLOAD" });
      } catch (error) {
        message.error(`参考图上传失败：${errorText(error)}`);
      }
    }
  }, [referenceMedia.length, message, uploadMedia.mutateAsync]);

  // 三个回调都要 useCallback：候选格与生成记录行是 memo 组件，回调每渲染换一次身份就等于没 memo。
  const handleSelectCandidate = useCallback((candidateId: string) => patchLocal({ selectedCandidateId: candidateId }), [patchLocal]);

  // 删除候选后必须把本地指针一起放掉：否则自动保存会把已删候选的 id 写回 selected/compare，
  // 让服务端重新指向一个不存在的候选。清空后由「回显最新候选」规则接管当前视图。
  const handleDeleteCandidate = useCallback((candidateId: string): void => {
    deleteCandidate.mutate(candidateId, {
      onSuccess: () => {
        if (localRef.current?.selectedCandidateId === candidateId || localRef.current?.compareCandidateId === candidateId) {
          patchLocal({
            ...(localRef.current.selectedCandidateId === candidateId ? { selectedCandidateId: null } : {}),
            ...(localRef.current.compareCandidateId === candidateId ? { compareCandidateId: null } : {}),
          });
        }
      },
      onError: (error) => message.error(errorText(error)),
    });
  }, [deleteCandidate, message, patchLocal]);

  // 补偿复用同一批次，需先清掉已完成标记，否则重试结束不会再通知也不会回显。
  const handleRetryBatch = useCallback((batchId: string): void => {
    notifiedBatchesRef.current.delete(batchId);
    retryPendingRef.current.add(batchId);
    retryBatch.mutate(batchId, {
      onSuccess: (result) => {
        startedBatchesRef.current.add(result.batch.id);
        const busy = result.batch.slots.some((slot) => slot.status === "QUEUED" || slot.status === "RUNNING");
        retryPendingRef.current.delete(result.batch.id);
        if (!busy) notifiedBatchesRef.current.add(result.batch.id);
      },
      onError: (error) => {
        retryPendingRef.current.delete(batchId);
        notifiedBatchesRef.current.add(batchId);
        message.error(errorText(error));
      },
    });
  }, [message, retryBatch]);

  const [maskTarget, setMaskTarget] = useState<{ candidateId: string; imageUrl: string; forSeam: boolean } | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  // 预览底色只改变看图方式，绝不写回候选文件；透明是否真实由候选的 hasAlpha 与去底结果决定。
  const [backdrop, setBackdrop] = useState<"checker" | "white" | "black">("checker");

  // 参考图支持直接粘贴：只接管含图片的粘贴，纯文本不受影响；有弹窗时让位给弹窗。
  const modalOpen = Boolean(maskTarget) || finalizeOpen;
  useEffect(() => {
    if (modalOpen) return;
    const onPaste = (event: ClipboardEvent) => {
      const images = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (images.length === 0) return;
      event.preventDefault();
      void onUploadReferences(images);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [modalOpen, onUploadReferences]);
  // 有槽位在跑、或存在失败槽位时自动展开生成记录——这两类信息不该藏在折叠区里；
  // 全部成功的旧记录保持收起，用户的手动开合不会被反复覆盖。
  const recordsNeedAttention = busy || batches.some((batch) => batch.slots.some((slot) => slot.status === "FAILED"));
  const [recordsOpen, setRecordsOpen] = useState(false);
  useEffect(() => {
    if (recordsNeedAttention) setRecordsOpen(true);
  }, [recordsNeedAttention]);

  if (draftQuery.isLoading) return <div className={styles.ws}><div className={styles.centerState}>正在加载草稿…</div></div>;
  if (draftQuery.isError || !draftQuery.data || !local) {
    return (
      <div className={styles.ws}>
        <div className={styles.centerState}>
          <Alert type="error" showIcon message="草稿不存在或加载失败" description={draftQuery.isError ? errorText(draftQuery.error) : undefined} />
          <Button onClick={() => navigate("/patterns")}>返回花型工坊</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.ws}>
      <header className={styles.top}>
        <Space size="small">
          <Button type="text" size="small" icon={<ArrowLeft size={15} />} onClick={() => navigate("/patterns")}>花型工坊</Button>
          <Input
            size="small"
            style={{ width: 220 }}
            value={local.name}
            onChange={(event) => patchLocal({ name: event.target.value })}
            aria-label="草稿名称"
          />
          <span className={styles.saveState} data-state={saveState}>
            {saveState === "saving" ? "保存中…" : saveState === "error" ? "保存失败" : saveState === "conflict" ? "有未保存修改（版本冲突）" : "已保存"}
          </span>
          {saveState === "conflict" || saveState === "error" ? <Button size="small" icon={<RefreshCw size={13} />} onClick={() => void reloadFromServer()}>重新加载</Button> : null}
        </Space>
        <Space size="small">
          {busy ? <Tag color="processing">生成中</Tag> : null}
          <Segmented size="small" value={local.conditions.background} options={[{ value: "WHITE", label: "白底" }, { value: "TRANSPARENT", label: "透明底" }]} onChange={(value) => patchLocal({ conditions: { ...local.conditions, background: value as DraftConditions["background"] } })} />
          <Button
            size="small"
            disabled={!selected}
            onClick={() => selected && void navigator.clipboard?.writeText(selected.url)}
          >复制候选地址</Button>
          <Button size="small" type="primary" disabled={!selected} onClick={() => setFinalizeOpen(true)}>定稿入库</Button>
          <Button size="small" icon={<Download size={13} />} disabled={!selected} onClick={() => selected && void downloadOriginal(selected.url, `${local.name}-${selected.slotIndex}.png`)}>下载原稿</Button>
        </Space>
      </header>

      <div className={styles.body}>
        <aside className={styles.left}>
          <Section title="创作类型">
            <Segmented
              block
              value={draftQuery.data.composeType}
              options={DRAFT_COMPOSE_TYPE_OPTIONS}
              onChange={() => undefined}
              disabled
            />
          </Section>
          <Section title="创作主题" hint="输入 @ 可引用参考图，插入后形如 @图1。编号在上传时固定，删除参考图不会重新编号；引用了已删除的编号会在提交时被拒绝。">
            <ReferenceTextArea
              value={local.conditions.theme}
              onChange={(theme) => patchLocal({ conditions: { ...local.conditions, theme } })}
              references={referenceOptions}
              rows={4}
              placeholder="描述图案主题与画面，例：水彩野花束、奶油色底"
              ariaLabel="创作主题"
            />
          </Section>
          <Section title="参考图">
            <ReferenceList
              media={referenceMedia}
              onUpload={(files) => void onUploadReferences(files)}
              onRemove={(mediaId) => deleteMedia.mutate(mediaId)}
              uploading={uploadMedia.isPending}
            />
          </Section>
          <Section title="底版与比例">
            <Select
              style={{ width: "100%" }}
              value={local.conditions.aspectRatio}
              onChange={(value) => patchLocal({ conditions: { ...local.conditions, aspectRatio: value } })}
              options={["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"].map((value) => ({ value, label: value }))}
            />
            {draftQuery.data.composeType === "REPEAT" ? (
              <Select
                allowClear
                style={{ width: "100%" }}
                placeholder="平铺排列（仅预览几何）"
                value={local.conditions.repeatLayout}
                onChange={(value) => patchLocal({ conditions: { ...local.conditions, repeatLayout: value } })}
                options={POD_REPEAT_LAYOUT_OPTIONS}
              />
            ) : null}
            <div className={styles.sliderRow}>
              <span>候选数</span>
              <Slider style={{ flex: 1 }} min={1} max={4} value={local.conditions.candidateCount} onChange={(value) => patchLocal({ conditions: { ...local.conditions, candidateCount: value } })} />
              <span>{local.conditions.candidateCount}</span>
            </div>
          </Section>
          <Section title="模型">
            <ImageModelSelect
              value={modelKey}
              storageKey="ecomgen.patternDrafts.model"
              onChange={(key) => {
                const { providerId, modelId } = parseModelKey(key);
                patchLocal({ conditions: { ...local.conditions, providerId, imageModelId: modelId } });
              }}
            />
            <Button type="primary" block icon={<Sparkles size={15} />} loading={createBatch.isPending} disabled={!local.conditions.theme.trim() || !modelKey} onClick={() => void submitBatch("GENERATE")}>生成 / 再来一组</Button>
          </Section>

          <details className={styles.tools}>
            <summary>改稿工具</summary>
            <div className={styles.toolStack}>
              <ToolBlock title="整图修改" hint="输入 @ 可引用参考图，指名以哪张参考图为准。">
                <WholeEditTool references={referenceOptions} disabled={!selected || !modelKey} busy={createEdit.isPending} onSubmit={(instruction) => selected && void submitBatch("EDIT_WHOLE", { instruction }, selected.id)} />
              </ToolBlock>
              <ToolBlock title="局部修改" hint="选区外像素在合成时逐像素保持不变。">
                <Button size="small" disabled={!selected || !modelKey} onClick={() => selected && setMaskTarget({ candidateId: selected.id, imageUrl: selected.url, forSeam: false })}>打开选区编辑器</Button>
              </ToolBlock>
              <ToolBlock title="调色（本地）" hint="本地 HSL 调制，不承诺精确色值。">
                <RecolorTool disabled={!selected} busy={createBatch.isPending} onSubmit={(recolor) => selected && void submitBatch("RECOLOR", { recolor }, selected.id)} />
              </ToolBlock>
              <ToolBlock title="色板变体" hint="色板表达配色意图，不保证严格等色。">
                <PaletteTool disabled={!selected || !modelKey} busy={createEdit.isPending} onSubmit={(palette, instruction) => selected && void submitBatch("PALETTE_VARIANT", { palette, instruction }, selected.id)} />
              </ToolBlock>
              <ToolBlock title="去底（真实 alpha）" hint="去底使用分割模型产生真实 alpha，不是把预览底色换成棋盘格。">
                <CutoutTool providers={providersQuery.data?.items ?? []} disabled={!selected} busy={createBatch.isPending} onSubmit={(providerId, modelId) => selected && void submitBatch("CUTOUT", { providerId, imageModelId: modelId }, selected.id)} />
              </ToolBlock>
              {draftQuery.data.composeType === "REPEAT" ? (
                <ToolBlock title="接缝改稿" hint="结果会重新检测，不继承原通过状态。">
                  <SeamTool disabled={!selected || !modelKey} busy={createEdit.isPending} onSubmit={(edge, band, instruction) => selected && void submitBatch("SEAM_EDIT", { seam: { edge, band }, instruction }, selected.id)} />
                </ToolBlock>
              ) : null}
              <ToolBlock title="验缝">
                <Button size="small" loading={tileCheck.isPending} disabled={!selected} onClick={() => selected && tileCheck.mutate(selected.id)}>对当前候选执行检测</Button>
                {selected ? <TileVerdict tileable={selected.tileable} /> : null}
              </ToolBlock>
            </div>
          </details>
        </aside>

        <main className={styles.center}>
          <div className={styles.centerToolbar}>
            <span className={styles.hint}>预览底色</span>
            <Segmented
              size="small"
              value={backdrop}
              onChange={(value) => setBackdrop(value as "checker" | "white" | "black")}
              options={[{ value: "checker", label: "棋盘" }, { value: "white", label: "白底" }, { value: "black", label: "黑底" }]}
            />
          </div>
          <div className={`${styles.viewer} ${backdrop === "white" ? styles.backdropWhite : backdrop === "black" ? styles.backdropBlack : styles.backdropChecker}`}>
            {selected ? (
              compareCandidate ? (
                <div className={styles.compareGrid}>
                  <ComparePane label="当前候选" url={selected.url} />
                  <ComparePane label="对照候选" url={compareCandidate.url} />
                </div>
              ) : draftQuery.data.composeType === "REPEAT" ? (
                <RepeatPreview imageUrl={selected.url} layout={local.conditions.repeatLayout ?? "STRAIGHT"} tileable={selected.tileable} onTileCheck={() => tileCheck.mutate(selected.id)} checking={tileCheck.isPending} />
              ) : (
                <Image src={selected.url} alt="当前候选" className={styles.stageImg} preview={{ mask: <span>点击放大</span> }} />
              )
            ) : (
              <div className={styles.emptyStage}>{busy ? "正在生成首批候选…" : "填写主题并添加参考后点击「生成」"}</div>
            )}
          </div>
        </main>

        <aside className={styles.right}>
          <Section title={selected ? `当前候选 #${selected.slotIndex}` : "选中图"}>
            {selected ? (
              <div className={styles.meta}>
                <Tag>{OPERATION_LABELS[selected.transform] ?? selected.transform}</Tag>
                <Tag color={selected.hasAlpha ? "green" : "default"}>{selected.hasAlpha ? "含透明像素" : "不透明"}</Tag>
                <span>{selected.width ?? "?"}×{selected.height ?? "?"}</span>
                <TileVerdict tileable={selected.tileable} />
                <Space size="small" wrap>
                  <Button size="small" type={local.compareCandidateId === selected.id ? "primary" : "default"} onClick={() => patchLocal({ compareCandidateId: local.compareCandidateId === selected.id ? null : selected.id })}>选入比较</Button>
                  {selected.parentCandidateId ? <span className={styles.hint}>由父候选 #{candidates.find((item) => item.id === selected.parentCandidateId)?.slotIndex ?? "?"} 改稿而来</span> : null}
                </Space>
              </div>
            ) : <span className={styles.hint}>还没有候选。</span>}
          </Section>

          <div className={styles.candidatePane}>
            <div className={styles.paneTitle}>候选（{candidates.length}）</div>
            <div className={styles.candidateScroll}>
              {candidateGroups.length === 0 ? (
                <span className={styles.hint}>还没有候选。</span>
              ) : candidateGroups.map(({ batch, items }) => (
                <div key={batch.id} className={styles.candGroup}>
                  <div className={styles.candGroupHead}>
                    <span>{OPERATION_LABELS[batch.operation] ?? batch.operation}</span>
                    <span className={styles.hint}>{relativeTime(batch.createdAt)}</span>
                  </div>
                  <div className={styles.candidateGrid}>
                    {items.map((candidate) => (
                      <CandidateCell
                        key={candidate.id}
                        candidate={candidate}
                        active={candidate.id === selected?.id}
                        onSelect={handleSelectCandidate}
                        onDelete={handleDeleteCandidate}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <details className={styles.records} open={recordsOpen} onToggle={(event) => setRecordsOpen(event.currentTarget.open)}>
            <summary>生成记录（{batches.length}）</summary>
            <div className={styles.recordList}>
              {batches.length === 0 ? <span className={styles.hint}>还没有生成记录。</span> : [...batches].reverse().map((batch) => (
                <BatchRecordRow key={batch.id} batch={batch} onRetry={handleRetryBatch} />
              ))}
            </div>
          </details>
        </aside>
      </div>


      <MaskEditorDialog
        open={Boolean(maskTarget)}
        imageUrl={maskTarget?.imageUrl ?? null}
        onCancel={() => setMaskTarget(null)}
        onSubmit={async (blob) => {
          if (!maskTarget) return;
          const file = new File([blob], "mask.png", { type: "image/png" });
          const created = await uploadMedia.mutateAsync({ file, role: "MASK", source: "UPLOAD" });
          setMaskTarget(null);
          await submitBatch("EDIT_LOCAL", { maskMediaId: created.id, instruction: "按选区修改" }, maskTarget.candidateId);
        }}
      />

      <FinalizeDialog
        open={finalizeOpen}
        defaultName={local.name}
        candidate={selected}
        onCancel={() => setFinalizeOpen(false)}
        onSubmit={async (name) => {
          if (!selected) return;
          try {
            const result = await finalize.mutateAsync({ candidateId: selected.id, body: { name, clientKey: randomUuid() } });
            message.success(result.reused ? "该候选已入库，已打开既有花型" : "已定稿入库");
            setFinalizeOpen(false);
            navigate(`/patterns/${result.pattern.id}`);
          } catch (error) {
            message.error(errorText(error));
          }
        }}
        busy={finalize.isPending}
      />
    </div>
  );
}

/**
 * 标题旁的 ⓘ 说明。限制性与规则性文案收进悬浮说明，不常显成段落——
 * 常显说明会把同一区块的动作挤到换行里，需要时悬停即可读到。
 *
 * 一律向右展开：这些标题都在左侧窄栏里，默认向上会让说明浮到顶栏上方、并压住上一个区块。
 */
function InfoDot({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip title={hint} placement="right">
      <button type="button" className={styles.toolInfo} aria-label={`${label}说明`}>
        <Info size={12} strokeWidth={1.75} aria-hidden />
      </button>
    </Tooltip>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>
        {title}
        {hint ? <InfoDot label={title} hint={hint} /> : null}
      </h3>
      <div className={styles.blockChildren}>{children}</div>
    </section>
  );
}

function ToolBlock({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={styles.toolBlock}>
      <h4 className={styles.toolTitle}>
        {title}
        {hint ? <InfoDot label={title} hint={hint} /> : null}
      </h4>
      <div className={styles.blockChildren}>{children}</div>
    </div>
  );
}

function ComparePane({ label, url }: { label: string; url: string }) {
  return (
    <div className={styles.comparePane}>
      <span className={styles.hint}>{label}</span>
      <Image src={url} alt={label} className={styles.stageImg} preview={{ mask: <span>点击放大</span> }} />
    </div>
  );
}

function ReferenceList({ media, onUpload, onRemove, uploading }: {
  media: DraftMedia[];
  onUpload: (files: File[]) => void;
  onRemove: (mediaId: string) => void;
  uploading: boolean;
}) {
  const { dragging, dropProps } = useFileDropTarget(onUpload);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={styles.refList}>
      <div
        className={styles.dropzone}
        data-dragging={dragging}
        role="button"
        tabIndex={0}
        aria-label={`选择参考图，最多 ${PATTERN_DRAFT_MEDIA_MAX} 张，也可以直接拖入或粘贴图片`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        {...dropProps}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) onUpload(Array.from(event.target.files));
            event.target.value = "";
          }}
        />
        <ImagePlus size={16} strokeWidth={1.6} aria-hidden />
        <span className={styles.dropTitle}>{uploading ? "正在上传…" : "拖入、粘贴或点击选择图片"}</span>
        <span className={styles.dropHint}>{media.length} / {PATTERN_DRAFT_MEDIA_MAX} 张</span>
      </div>
      {media.map((item) => (
        <div key={item.id} className={styles.refItem}>
          <span className={styles.refBadge} title="在主题或改稿说明里用 @ 引用这张图">{item.ordinal === null ? "—" : `图${item.ordinal}`}</span>
          <img src={item.thumbUrl} alt={item.fileName} className={styles.refThumb} loading="lazy" />
          <span className={styles.refName}>{item.fileName}</span>
          <Button size="small" type="text" danger onClick={() => onRemove(item.id)}>移除</Button>
        </div>
      ))}
    </div>
  );
}

function WholeEditTool({ references, disabled, busy, onSubmit }: { references: ReferenceOption[]; disabled: boolean; busy: boolean; onSubmit: (instruction: string) => void }) {
  const [instruction, setInstruction] = useState("");
  return (
    <>
      <ReferenceTextArea references={references} rows={3} value={instruction} onChange={setInstruction} placeholder="描述整图修改意图" ariaLabel="整图修改说明" />
      <Button size="small" icon={<Wand2 size={13} />} loading={busy} disabled={disabled || !instruction.trim()} onClick={() => onSubmit(instruction.trim())}>提交整图修改</Button>
    </>
  );
}

function RecolorTool({ disabled, busy, onSubmit }: { disabled: boolean; busy: boolean; onSubmit: (recolor: { hueShift: number; saturationPct: number; brightnessPct: number }) => void }) {
  const [hueShift, setHue] = useState(0);
  const [saturationPct, setSaturation] = useState(100);
  const [brightnessPct, setBrightness] = useState(100);
  return (
    <>
      <SliderRow label="色相" value={hueShift} min={-180} max={180} onChange={setHue} />
      <SliderRow label="饱和" value={saturationPct} min={0} max={300} onChange={setSaturation} />
      <SliderRow label="明度" value={brightnessPct} min={10} max={400} onChange={setBrightness} />
      <Button size="small" loading={busy} disabled={disabled} onClick={() => onSubmit({ hueShift, saturationPct, brightnessPct })}>生成调色候选</Button>
    </>
  );
}

function SliderRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className={styles.sliderRow}>
      <span>{label}</span>
      <Slider style={{ flex: 1 }} min={min} max={max} value={value} onChange={onChange} />
      <span>{value}</span>
    </div>
  );
}

function PaletteTool({ disabled, busy, onSubmit }: { disabled: boolean; busy: boolean; onSubmit: (palette: string[], instruction: string) => void }) {
  const [colors, setColors] = useState<string[]>(["#c94f4f", "#4f7dc9"]);
  return (
    <>
      <Space wrap size="small">
        {colors.map((color, index) => (
          <span key={`${color}-${index}`} className={styles.swatch}>
            <input type="color" value={color} onChange={(event) => setColors(colors.map((item, position) => (position === index ? event.target.value : item)))} aria-label={`色板 ${index + 1}`} />
            <button type="button" className={styles.swatchRemove} aria-label={`删除色板 ${index + 1}`} disabled={colors.length <= 1} onClick={() => setColors(colors.filter((_, position) => position !== index))}>×</button>
          </span>
        ))}
        <Button size="small" disabled={colors.length >= 8} onClick={() => setColors([...colors, "#888888"])}>加色</Button>
      </Space>
      <Button size="small" icon={<Palette size={13} />} loading={busy} disabled={disabled || !colors.length} onClick={() => onSubmit(colors, "按色板重配颜色")}>生成色板变体</Button>
    </>
  );
}

function CutoutTool({ providers, disabled, busy, onSubmit }: { providers: Parameters<typeof segmentationModelOptions>[0]; disabled: boolean; busy: boolean; onSubmit: (providerId: string, modelId: string) => void }) {
  const options = useMemo(() => segmentationModelOptions(providers), [providers]);
  const [key, setKey] = useState<string | undefined>(options[0]?.value);
  useEffect(() => { if (!key && options[0]) setKey(options[0].value); }, [key, options]);
  return (
    <>
      <Select style={{ width: "100%" }} placeholder="选择分割模型" value={key} onChange={setKey} options={options.map((option) => ({ value: option.value, label: option.label }))} />
      <Button size="small" icon={<Scissors size={13} />} loading={busy} disabled={disabled || !key} onClick={() => { const parsed = parseModelKey(key ?? ""); onSubmit(parsed.providerId, parsed.modelId); }}>去底生成透明候选</Button>
    </>
  );
}

function SeamTool({ disabled, busy, onSubmit }: { disabled: boolean; busy: boolean; onSubmit: (edge: "LEFT_RIGHT" | "TOP_BOTTOM", band: number, instruction: string) => void }) {
  const [edge, setEdge] = useState<"LEFT_RIGHT" | "TOP_BOTTOM">("LEFT_RIGHT");
  const [band, setBand] = useState(48);
  const [instruction, setInstruction] = useState("");
  return (
    <>
      <Segmented size="small" value={edge} options={[{ value: "LEFT_RIGHT", label: "左右" }, { value: "TOP_BOTTOM", label: "上下" }]} onChange={(value) => setEdge(value as "LEFT_RIGHT" | "TOP_BOTTOM")} />
      <SliderRow label="带宽" value={band} min={8} max={256} onChange={setBand} />
      <Input size="small" value={instruction} placeholder="改稿说明（可选）" onChange={(event) => setInstruction(event.target.value)} />
      <Button size="small" icon={<Layers size={13} />} loading={busy} disabled={disabled} onClick={() => onSubmit(edge, band, instruction)}>提交接缝改稿</Button>
    </>
  );
}

function FinalizeDialog({ open, defaultName, candidate, onCancel, onSubmit, busy }: {
  open: boolean;
  defaultName: string;
  candidate: { url: string; transform: string; tileable: { status: string } } | null;
  onCancel: () => void;
  onSubmit: (name: string) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(`${defaultName} 定稿`);
  useEffect(() => { if (open) setName(`${defaultName} 定稿`); }, [open, defaultName]);
  return (
    <Modal open={open} title="定稿入库" okText="入库为正式花型" cancelText="取消" confirmLoading={busy} onCancel={onCancel} onOk={() => onSubmit(name.trim() || defaultName)}>
      <Space direction="vertical" style={{ width: "100%" }}>
        {candidate ? <img src={candidate.url} alt="待定稿候选" style={{ width: "100%", maxHeight: 320, objectFit: "contain", background: "#111" }} /> : null}
        <Input value={name} onChange={(event) => setName(event.target.value)} addonBefore="花型名称" />
        <span className={styles.hint}>定稿只复制这张候选进入正式花型库并保留其接缝状态，不会自动启动规格包或文案流水线；原稿下载保持该图分辨率与 alpha。</span>
      </Space>
    </Modal>
  );
}

/**
 * 候选格与生成记录行包 memo：主题输入框每次击键都会重渲染本页，而这两块只是候选/批次的纯展示
 * （内部还挂着 antd 的 Popconfirm 与 Tooltip，代价不低）。回调由父级 useCallback 固定，
 * 因此除自身数据变化外，它们在这类逐击键渲染里完全跳过。
 */
const CandidateCell = memo(function CandidateCell({ candidate, active, onSelect, onDelete }: {
  candidate: DraftCandidate;
  active: boolean;
  onSelect: (candidateId: string) => void;
  onDelete: (candidateId: string) => void;
}) {
  return (
    <div className={styles.candCell}>
      <button
        type="button"
        className={`${styles.candTile} ${active ? styles.candTileSelected : ""}`}
        aria-pressed={active}
        aria-label={`候选 #${candidate.slotIndex}`}
        title={`#${candidate.slotIndex} · ${OPERATION_LABELS[candidate.transform] ?? candidate.transform}`}
        onClick={() => onSelect(candidate.id)}
      >
        <img src={candidate.thumbUrl} alt="" loading="lazy" />
        <span className={styles.candIndex}>#{candidate.slotIndex}</span>
        {candidate.tileable.status === "VERIFIED" ? <span className={styles.candSeam} title="接缝已通过">✓</span> : null}
      </button>
      <Popconfirm
        title={`删除候选 #${candidate.slotIndex}？`}
        description="只删除这张草稿候选；已定稿入库的正式花型不受影响。"
        okText="删除"
        okButtonProps={{ danger: true }}
        onConfirm={() => onDelete(candidate.id)}
      >
        <button type="button" className={styles.candDelete} aria-label={`删除候选 #${candidate.slotIndex}`} title="删除这张候选">
          <Trash2 size={12} />
        </button>
      </Popconfirm>
    </div>
  );
});

const BatchRecordRow = memo(function BatchRecordRow({ batch, onRetry }: { batch: DraftBatch; onRetry: (batchId: string) => void }) {
  const failedSlots = batch.slots.filter((slot) => slot.status === "FAILED");
  const succeeded = batch.slots.filter((slot) => slot.status === "SUCCEEDED").length;
  const pending = batch.slots.filter((slot) => slot.status !== "SUCCEEDED");
  return (
    <div className={styles.recordRow}>
      <div className={styles.recordHead}>
        <Tag>{OPERATION_LABELS[batch.operation] ?? batch.operation}</Tag>
        <span className={styles.hint}>{batch.imageModelId ?? "本地处理"} · {succeeded}/{batch.slots.length} 成功 · {relativeTime(batch.createdAt)}</span>
        {failedSlots.length ? (
          <Popconfirm title={`只补 ${failedSlots.length} 个失败槽位？`} description="已成功的候选不会被重新生成。" onConfirm={() => onRetry(batch.id)}>
            <Button size="small" danger icon={<Undo2 size={12} />}>补偿（{failedSlots.length}）</Button>
          </Popconfirm>
        ) : null}
      </div>
      {pending.length ? (
        <div className={styles.slotLine}>
          {pending.map((slot) => (
            <Tooltip key={slot.index} title={[slot.error?.message, slot.error?.warning].filter(Boolean).join(" / ") || undefined}>
              <span className={styles.slotChip} data-status={slot.status}>
                #{slot.index} {statusLabel(slot.status)}{slot.attempt > 1 ? ` · 第${slot.attempt}次` : ""}
              </span>
            </Tooltip>
          ))}
        </div>
      ) : null}
    </div>
  );
});
