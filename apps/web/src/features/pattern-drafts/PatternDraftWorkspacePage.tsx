import { useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Image, Input, Modal, Popconfirm, Segmented, Select, Slider, Space, Tag, Tooltip, Typography } from "antd";
import { ArrowLeft, Download, ImagePlus, Info, Layers, MessageSquarePlus, MessageSquareText, Pencil, RefreshCw, Scissors, Sparkles, Trash2, Undo2, Wand2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { DRAFT_BACKGROUNDS, IMAGE_QUALITIES, MAX_DRAFT_MEDIA_NOTES_LENGTH, PATTERN_DRAFT_REFERENCES_MAX, imageParamSupportFor } from "@ecomgen/contracts";
import { defaultSketchNote } from "@ecomgen/ecom-skill";
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
  useUpdateDraftMedia,
  useUpdatePatternDraft,
  type CreateDraftBatchBody,
  type DraftBatch,
  type DraftCandidate,
  type DraftConditions,
  type DraftMedia,
  type PatternDraft,
} from "../../api/hooks/usePatternDrafts";
import { relativeTime } from "../../lib/format";
import { BackgroundModeSelect, DRAFT_COMPOSE_TYPE_OPTIONS, ImageModelSelect, POD_REPEAT_LAYOUT_OPTIONS, TileVerdict, statusLabel } from "../patterns/shared";
import { qk } from "../../api/queryKeys";
import { ApiError } from "../../api/errors";
import { errorText } from "../../lib/errorText";
import { downloadOriginal } from "../../lib/downloadImage";
import { modelOptions, parseModelKey, segmentationModelOptions } from "../../lib/modelOptions";
import { useFileDropTarget } from "../../lib/fileDrop";
import { randomUuid } from "../../lib/randomUuid";
import { DrawSurface, type DrawSurfaceHandle } from "./DrawSurface";
import backdropStyles from "./backdrop.module.css";
import { DraftEditPanel } from "./DraftEditPanel";
import { ReferenceTextArea, type ReferenceOption } from "./ReferenceTextArea";
import { RepeatPreview } from "./RepeatPreview";
import { SketchDialog } from "./SketchDialog";
import styles from "./PatternDraftWorkspacePage.module.css";

const OPERATION_LABELS: Record<string, string> = {
  GENERATE: "生成",
  EDIT: "改稿",
  RECOLOR: "调色",
  CUTOUT: "去底",
  SEAM_EDIT: "接缝改稿",
};

/** quality 档位的展示名；取值元组在 contracts 单源维护，这里只做中文标注。 */
const QUALITY_LABELS: Record<string, string> = { auto: "自动", low: "低", medium: "中", high: "高" };

/**
 * 改稿画布的笔色。笔色在这里是**要表达的颜色**：它既指出要改哪里，也提示改成什么。
 *
 * 所以纯白与纯黑必须在列——"改成白色/黑色"是最常见的诉求，不提供就得让用户去取色器里自己找。
 * 它们在个别底图上会看不清（白笔迹压在白色花朵上），那是用户一眼能看见并自己换色的事，
 * 比"想改成黑色却挑不到黑色"轻得多。
 * 定义在模块级而不是内联：内联数组每次渲染换身份，会让 DrawSurface 里挑默认色的 effect 每帧空跑。
 */
const EDIT_PAINT_COLORS = ["#e0503a", "#d9a441", "#3fa06a", "#4f7dc9", "#b45fd0", "#ffffff", "#000000"] as const;


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
  const updateMedia = useUpdateDraftMedia(draftId);
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
  // 当前所选生图模型的能力项；底版选择据此禁用/退回「透明底」。
  const imageModel = useMemo(
    () => modelOptions(providersQuery.data?.items ?? [], "image").find((option) => option.value === modelKey),
    [providersQuery.data, modelKey],
  );
  /**
   * Provider 列表加载完成前按"支持"处理：加载窗口里的"不知道"不等于"不支持"，
   * 否则刷新页面会把已保存的透明底在列表到达前的那一瞬间改写成白底。
   * 列表到达后模型若真不支持，BackgroundModeSelect 会禁用该项并自动退回白底。
   */
  const transparentAvailable = imageModel ? imageModel.transparentBackground : true;
  // 所选模型真实可调的出图参数：判定与 worker 同源（contracts 的 imageParamSupportFor）。
  // 没有真实档位的维度不渲染选择器，避免"选了也不生效"的假开关。
  const modelSupport = useMemo(() => {
    if (!modelKey) return null;
    const { providerId, modelId } = parseModelKey(modelKey);
    const kind = providersQuery.data?.items.find((provider) => provider.id === providerId)?.models.find((model) => model.id === modelId)?.imageApiKind ?? null;
    return imageParamSupportFor(modelId, kind as "openai_images" | "gemini" | "custom" | null);
  }, [modelKey, providersQuery.data]);
  const effectiveResolution = modelSupport && modelSupport.resolutionTiers.length > 1 && modelSupport.resolutionTiers.includes((local?.conditions.imageResolution ?? "1K") as never)
    ? local?.conditions.imageResolution ?? "1K"
    : "1K";
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

  /**
   * 提交批次。返回是否被接受，供调用方决定要不要退出绘制态——画了半天的笔迹不该因为一次失败就丢掉。
   *
   * 参考图不由这里声明：下发哪些由服务端按操作与文本推导（起稿全发，改稿只发文本里 @ 到的）。
   * 起稿的下发上限与参考图列表上限是同一个数值，所以这里只在超限时拦一道，给出比 400 更清楚的提示。
   */
  const submitBatch = async (operation: CreateDraftBatchBody["operation"], extras: Partial<CreateDraftBatchBody> = {}, parentCandidateId?: string): Promise<boolean> => {
    if (!local) return false;
    if (operation === "GENERATE" && referenceMedia.length > PATTERN_DRAFT_REFERENCES_MAX) {
      message.error(`起稿一次最多下发 ${PATTERN_DRAFT_REFERENCES_MAX} 张参考图，请先删掉多余的参考图`);
      return false;
    }
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
      imageResolution: effectiveResolution,
      ...(conditions.quality ? { quality: conditions.quality } : {}),
      background: conditions.background,
      ...(conditions.repeatLayout ? { repeatLayout: conditions.repeatLayout } : {}),
      ...(parentCandidateId ? { parentCandidateId } : {}),
      ...extras,
    };
    try {
      const result = parentCandidateId ? await createEdit.mutateAsync({ candidateId: parentCandidateId, body }) : await createBatch.mutateAsync(body);
      startedBatchesRef.current.add(result.batch.id);
      pendingKeyRef.current = null;
      message.success(result.reused ? "已复用同一提交的批次" : "已提交，可在右侧「生成记录」查看进度");
      return true;
    } catch (error) {
      message.error(errorText(error));
      return false;
    }
  };

  const onUploadReferences = useCallback(async (files: File[]): Promise<void> => {
    const images = files.filter((file) => file.type.startsWith("image/") || file.type === "");
    if (images.length === 0) {
      message.error("只支持图片文件");
      return;
    }
    // 上限在服务端强制；这里先按剩余额度截断，避免整批被拒后用户不知道哪几张没进去。
    // 计数与下发共用一个上限：上传能装下的张数，就是起稿发得出去的张数。
    const room = PATTERN_DRAFT_REFERENCES_MAX - referenceMedia.length;
    if (room <= 0) {
      message.warning(`参考图最多 ${PATTERN_DRAFT_REFERENCES_MAX} 张`);
      return;
    }
    const accepted = images.slice(0, room);
    if (accepted.length < images.length) message.warning(`参考图最多 ${PATTERN_DRAFT_REFERENCES_MAX} 张，本次只加入 ${accepted.length} 张`);
    for (const file of accepted) {
      try {
        await uploadMedia.mutateAsync({ file, role: "REFERENCE", source: "UPLOAD" });
      } catch (error) {
        message.error(`参考图上传失败：${errorText(error)}`);
      }
    }
  }, [referenceMedia.length, message, uploadMedia.mutateAsync]);

  /** 参考图额度已满时不给开面板：让用户先删，好过画完一张再被服务端拒绝。 */
  const referenceRoomFull = (): boolean => {
    if (referenceMedia.length < PATTERN_DRAFT_REFERENCES_MAX) return false;
    message.warning(`参考图最多 ${PATTERN_DRAFT_REFERENCES_MAX} 张，请先移除一张再添加`);
    return true;
  };

  /** 草图落为一张参考图：备注按创作类型预填，用户可改可删——草图的语义就靠这条备注表达。 */
  const submitSketch = async (blob: Blob): Promise<void> => {
    try {
      await uploadMedia.mutateAsync({
        file: new File([blob], "sketch.png", { type: "image/png" }),
        role: "REFERENCE",
        source: "UPLOAD",
        notes: draftQuery.data ? defaultSketchNote(draftQuery.data.composeType) : undefined,
      });
      setSketchBase(null);
      message.success("草图已加入参考图，可在主题或改稿说明里用 @ 引用它");
    } catch (error) {
      message.error(`草图上传失败：${errorText(error)}`);
    }
  };

  /**
   * 提交改稿：画了笔迹就先把笔迹落成媒体再提交批次，没画就是整图改稿。
   *
   * 笔迹是"整图"与"按笔迹"唯一的分界——没有它，服务端就只有父候选可下发；有它，服务端会把笔迹
   * 叠在父候选上再交给模型。所以它只在真的导出成功之后才写进请求。只有批次被接受才退出绘制态，
   * 提交失败一次不用重画。
   */
  const submitEdit = async (instruction: string): Promise<void> => {
    if (!editDraw) return;
    const extras: Partial<CreateDraftBatchBody> = { instruction };
    if (editHasAnnotation) {
      const blob = await editSurfaceRef.current?.exportPng();
      if (!blob) {
        message.error("还没有画出笔迹");
        return;
      }
      try {
        const created = await uploadMedia.mutateAsync({ file: new File([blob], "marks.png", { type: "image/png" }), role: "ANNOTATION", source: "UPLOAD" });
        extras.annotationMediaId = created.id;
      } catch (error) {
        message.error(`笔迹上传失败：${errorText(error)}`);
        return;
      }
    }
    if (await submitBatch("EDIT", extras, editDraw.candidateId)) setEditDraw(null);
  };

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

  // 改稿的绘制态：绘制层叠在主图区上而不是弹窗里，笔迹与结果才在同一视线内。
  // REPEAT 草稿进入绘制态时切单块视图——笔迹坐标必须唯一，平铺预览上的一笔没有唯一归属。
  const [editDraw, setEditDraw] = useState<{ candidateId: string; imageUrl: string; width: number | null; height: number | null } | null>(null);
  const editSurfaceRef = useRef<DrawSurfaceHandle | null>(null);
  const [editHasAnnotation, setEditHasAnnotation] = useState(false);
  // 草图板：baseImageUrl 为空表示空白新建，非空表示在那张参考图上绘制。
  const [sketchBase, setSketchBase] = useState<{ imageUrl: string | null } | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  // 预览底色只改变看图方式，绝不写回候选文件；透明是否真实由候选的 hasAlpha 与去底结果决定。
  const [backdrop, setBackdrop] = useState<"checker" | "white" | "black">("checker");

  // 参考图支持直接粘贴：只接管含图片的粘贴，纯文本不受影响；有弹窗或正在绘制时让位。
  const modalOpen = Boolean(editDraw) || sketchBase !== null || finalizeOpen;
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
          <Section title="创作主题" hint="输入 @ 引用参考图，插入后形如 @图1；输入 # 挑一个颜色，一次一种，直接落成 #c94f4f。编号在上传时固定，删除参考图不会重新编号；引用了已删除的编号会在提交时被拒绝。">
            <ReferenceTextArea
              value={local.conditions.theme}
              onChange={(theme) => patchLocal({ conditions: { ...local.conditions, theme } })}
              references={referenceOptions}
              rows={4}
              placeholder="描述图案主题与画面，例：水彩野花束、奶油色底"
              ariaLabel="创作主题"
            />
          </Section>
          <Section title="参考图" hint="参考图仅在起稿时全部下发；改稿只下发说明里用 @ 引用到的那几张。草图也是一张参考图，靠它自己的备注说明用途。">
            <ReferenceList
              media={referenceMedia}
              onUpload={(files) => void onUploadReferences(files)}
              onRemove={(mediaId) => deleteMedia.mutate(mediaId)}
              onSketch={(media) => { if (!referenceRoomFull()) setSketchBase({ imageUrl: media.url }); }}
              onNote={(mediaId, notes) => updateMedia.mutate({ mediaId, body: { notes } })}
              onDraw={() => { if (!referenceRoomFull()) setSketchBase({ imageUrl: null }); }}
              uploading={uploadMedia.isPending}
            />
          </Section>
          <Section
            title="底版与比例"
            hint="底版决定下一批候选的背景，不动当前候选与预览底色；「透明底」需要模型支持真透明（模型名里会标注），不支持的模型会禁用该项并退回白底。"
          >
            <BackgroundModeSelect
              value={local.conditions.background}
              onChange={(background) => patchLocal({ conditions: { ...local.conditions, background } })}
              modes={DRAFT_BACKGROUNDS}
              fallback="WHITE"
              transparentAvailable={transparentAvailable}
            />
            <Select
              style={{ width: "100%" }}
              value={local.conditions.aspectRatio}
              onChange={(value) => patchLocal({ conditions: { ...local.conditions, aspectRatio: value } })}
              options={["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"].map((value) => ({ value, label: value }))}
            />
            {modelSupport && modelSupport.resolutionTiers.length > 1 ? (
              <Select
                style={{ width: "100%" }}
                value={effectiveResolution}
                onChange={(value) => patchLocal({ conditions: { ...local.conditions, imageResolution: value } })}
                options={modelSupport.resolutionTiers.map((value) => ({ value, label: `分辨率 ${value}` }))}
              />
            ) : null}
            {modelSupport?.quality ? (
              <Select
                style={{ width: "100%" }}
                value={local.conditions.quality ?? "high"}
                onChange={(value) => patchLocal({ conditions: { ...local.conditions, quality: value } })}
                options={IMAGE_QUALITIES.map((value) => ({ value, label: `质量 ${QUALITY_LABELS[value]}` }))}
              />
            ) : null}
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
              <ToolBlock title="调色（本地）" hint="本地 HSL 调制，不承诺精确色值。">
                <RecolorTool disabled={!selected} busy={createBatch.isPending} onSubmit={(recolor) => selected && void submitBatch("RECOLOR", { recolor }, selected.id)} />
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
            {editDraw ? (
              <>
                <Segmented
                  size="small"
                  value={backdrop}
                  onChange={(value) => setBackdrop(value as "checker" | "white" | "black")}
                  options={[{ value: "checker", label: "棋盘" }, { value: "white", label: "白底" }, { value: "black", label: "黑底" }]}
                />
                <span className={styles.canvasHint}>在图上画出要改的地方，画好可拖动调整；不画即整图</span>
                {draftQuery.data.composeType === "REPEAT" ? <span className={styles.canvasHint}>单块视图：四条边即对边，笔迹坐标就是单元坐标</span> : null}
              </>
            ) : (
              <>
                <span className={styles.hint}>预览底色</span>
                <Segmented
                  size="small"
                  value={backdrop}
                  onChange={(value) => setBackdrop(value as "checker" | "white" | "black")}
                  options={[{ value: "checker", label: "棋盘" }, { value: "white", label: "白底" }, { value: "black", label: "黑底" }]}
                />
                <Button
                  size="small"
                  icon={<Wand2 size={13} />}
                  disabled={!selected || !modelKey}
                  onClick={() => {
                    if (!selected) return;
                    setEditHasAnnotation(false);
                    setEditDraw({ candidateId: selected.id, imageUrl: selected.url, width: selected.width, height: selected.height });
                  }}
                >改稿</Button>
              </>
            )}
          </div>
          {editDraw ? (
            <div className={styles.editDraw}>
              <DrawSurface
                ref={editSurfaceRef}
                mode="annotation"
                size={editDraw.width && editDraw.height ? { width: editDraw.width, height: editDraw.height } : null}
                imageUrl={editDraw.imageUrl}
                brushColors={EDIT_PAINT_COLORS}
                // 画笔放第一位：直接画是这里的默认动作，也默认被选中。
                tools={["brush", "lasso", "rect", "ellipse", "erase"]}
                stageHeight="fill"
                stageBackdrop={backdrop}
                underlayDisplay="overlay"
                onDirtyChange={setEditHasAnnotation}
              />
              <div className={styles.editPanel}>
                <DraftEditPanel
                  references={referenceOptions}
                  annotated={editHasAnnotation}
                  busy={createEdit.isPending}
                  onSubmit={(instruction) => void submitEdit(instruction)}
                  onCancel={() => setEditDraw(null)}
                />
              </div>
            </div>
          ) : (
            <div className={`${styles.viewer} ${PREVIEW_BACKDROPS[backdrop]}`}>
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
          )}
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


      <SketchDialog
        open={sketchBase !== null}
        aspectRatio={local.conditions.aspectRatio}
        baseImageUrl={sketchBase?.imageUrl ?? null}
        busy={uploadMedia.isPending}
        onCancel={() => setSketchBase(null)}
        onSubmit={submitSketch}
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

/** 显式列全会用到的键，而不是 `backdropStyles[backdrop]`：键写错时这里会直接报缺键，字符串索引不会。 */
const PREVIEW_BACKDROPS = {
  checker: backdropStyles.checker,
  white: backdropStyles.white,
  black: backdropStyles.black,
} satisfies Record<"checker" | "white" | "black", string | undefined>;

/**
 * 参考图备注：静止时按行截断显示，点编辑才换成自增高文本框。
 *
 * 此前是常驻一个单行输入框，在 300px 的侧栏里被挤到只剩几个字。备注通常是一整句话
 * （草图预填的那句约 110 字），常驻输入框既读不出来也改不进去，等于没有。所以拆成两种状态：
 * 静止按两行截断（antd 自己测量，没被截断就不出现"展开"，避免三行文字下面挂一个假的展开按钮），
 * 编辑才换成自增高文本框。状态留在组件内部：提到页面上会让每次击键重渲染整页，
 * 把候选格与生成记录一起打穿。
 *
 * 键盘约定沿用通行做法：回车保存、Shift+回车换行、Esc 取消、失焦保存。
 * 回车必须避开输入法组词——中文输入法用回车确认候选词，那一下不能当成保存。
 */
function ReferenceNote({ mediaId, notes, onCommit }: { mediaId: string; notes: string | null; onCommit: (mediaId: string, notes: string) => void }) {
  const text = notes ?? "";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const composingRef = useRef(false);

  // 服务端值变化（保存成功或重新加载）时同步草稿；正在编辑时不打断用户正在打的字。
  useEffect(() => { if (!editing) setValue(text); }, [text, editing]);

  const save = () => {
    setEditing(false);
    const next = value.trim();
    if (next === text) return;
    onCommit(mediaId, next);
  };

  if (editing) {
    return (
      <div className={styles.refNoteEdit}>
        <Input.TextArea
          autoFocus
          size="small"
          autoSize={{ minRows: 2, maxRows: 6 }}
          maxLength={MAX_DRAFT_MEDIA_NOTES_LENGTH}
          showCount
          value={value}
          placeholder="这张图用来做什么（会写进提示词）"
          aria-label="参考图备注"
          onChange={(event) => setValue(event.target.value)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onKeyDown={(event) => {
            // 组词中的回车/Esc 归输入法：回车是确认候选词，Esc 是取消候选，都不能算这次编辑的结束。
            const composing = composingRef.current || event.nativeEvent.isComposing;
            if (event.key === "Escape") {
              if (composing) return;
              event.preventDefault();
              setValue(text);
              setEditing(false);
              return;
            }
            if (event.key !== "Enter" || event.shiftKey) return;
            if (composing) return;
            event.preventDefault();
            save();
          }}
          onBlur={save}
        />
        <span className={styles.refNoteHint}>回车保存，Shift+回车换行</span>
      </div>
    );
  }

  if (!text) {
    return (
      <Button size="small" type="text" className={styles.refNoteAdd} icon={<MessageSquarePlus size={12} />} onClick={() => setEditing(true)}>添加备注</Button>
    );
  }

  return (
    <div className={styles.refNote}>
      <Typography.Paragraph
        ellipsis={{ rows: 2, expandable: "collapsible", symbol: (expanded: boolean) => (expanded ? "收起" : "展开") }}
      >
        {text}
      </Typography.Paragraph>
      <Tooltip title="编辑备注">
        <Button size="small" type="text" aria-label="编辑备注" icon={<MessageSquareText size={13} />} onClick={() => setEditing(true)} />
      </Tooltip>
    </div>
  );
}

function ReferenceList({ media, onUpload, onRemove, onSketch, onNote, onDraw, uploading }: {
  media: DraftMedia[];
  onUpload: (files: File[]) => void;
  onRemove: (mediaId: string) => void;
  /** 以这张参考图为底图打开草图板。 */
  onSketch: (media: DraftMedia) => void;
  onNote: (mediaId: string, notes: string) => void;
  /** 空白新建一张草图。 */
  onDraw: () => void;
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
        aria-label={`选择参考图，最多 ${PATTERN_DRAFT_REFERENCES_MAX} 张，也可以直接拖入或粘贴图片`}
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
        <span className={styles.dropHint}>{media.length} / {PATTERN_DRAFT_REFERENCES_MAX} 张</span>
      </div>
      <Button size="small" block icon={<Pencil size={13} />} onClick={onDraw}>画一张草图</Button>
      {media.map((item) => (
        // 两行结构：上行是编号、缩略图、文件名与操作，下行是整行宽度的备注。
        // 备注独占一行才有可读宽度——挤在缩略图和按钮之间只剩几十像素，是它以前没法用的直接原因。
        <div key={item.id} className={styles.refItem}>
          <div className={styles.refHead}>
            <span className={styles.refBadge} title="在主题或改稿说明里用 @ 引用这张图">{item.ordinal === null ? "—" : `图${item.ordinal}`}</span>
            <img src={item.thumbUrl} alt={item.fileName} className={styles.refThumb} loading="lazy" />
            <span className={styles.refName} title={item.fileName}>{item.fileName}</span>
            <span className={styles.refActions}>
              <Tooltip title="在这张图上画草图">
                <Button size="small" type="text" aria-label="在这张图上画草图" icon={<Pencil size={13} />} onClick={() => onSketch(item)} />
              </Tooltip>
              <Tooltip title="移除">
                <Button size="small" type="text" danger aria-label="移除参考图" icon={<Trash2 size={13} />} onClick={() => onRemove(item.id)} />
              </Tooltip>
            </span>
          </div>
          <ReferenceNote mediaId={item.id} notes={item.notes} onCommit={onNote} />
        </div>
      ))}
    </div>
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
      <Space orientation="vertical" style={{ width: "100%" }}>
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
