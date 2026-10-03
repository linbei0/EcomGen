import { App, Button, Input, Popconfirm } from "antd";
import { ArrowLeft, Layers, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { useDeletePatternDraft, usePatternDrafts } from "../../api/hooks/usePatternDrafts";
import { AppTopbar } from "../../components/AppTopbar";
import { errorText } from "../../lib/errorText";
import { relativeTime } from "../../lib/format";
import { DRAFT_COMPOSE_TYPE_LABELS } from "../patterns/shared";
import { StartDraftDialog } from "./StartDraftDialog";
import styles from "./PatternDraftsPage.module.css";


/**
 * 草稿列表：AI 起稿的未定稿作品有自己的目的地，不与正式花型同屏。
 * 卡片沿用花型墙的方图卡语言（棋盘格底、角标、名称/元信息），点卡即回工作台续做。
 */
export function PatternDraftsPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const draftsQuery = usePatternDrafts();
  const remove = useDeletePatternDraft();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [search, setSearch] = useState("");

  const drafts = useMemo(() => draftsQuery.data?.items ?? [], [draftsQuery.data]);
  const keyword = search.trim().toLowerCase();
  const visible = useMemo(
    () => (keyword ? drafts.filter((draft) => draft.name.toLowerCase().includes(keyword)) : drafts),
    [drafts, keyword],
  );

  const openDraft = (id: string): void => {
    void navigate(`/pattern-drafts/${id}`);
  };
  const createButton = (
    <Button type="primary" icon={<Plus size={15} strokeWidth={2} />} onClick={() => setStartOpen(true)}>
      新建起稿
    </Button>
  );

  return (
    <div className={styles.page}>
      <AppTopbar current="drafts" settingsOpen={settingsOpen} onSettingsOpenChange={setSettingsOpen} />
      <div className={styles.content}>
        <div className={styles.header}>
          <div>
            <Button type="text" size="small" className={styles.back} icon={<ArrowLeft size={15} />} onClick={() => void navigate("/patterns")}>
              花型工坊
            </Button>
            <h1 className={styles.title}>草稿</h1>
            <p className={styles.subtitle}>AI 起稿的未定稿作品：候选留在这里，明确「定稿入库」后才进入正式花型库。</p>
          </div>
          <div className={styles.toolbar}>{createButton}</div>
        </div>

        {drafts.length > 0 ? (
          <div className={styles.toolbar}>
            <Input
              size="small"
              className={styles.search}
              placeholder="搜索草稿名称"
              aria-label="搜索草稿名称"
              allowClear
              prefix={<Search size={13} strokeWidth={2} />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <span className={styles.count}>
              {visible.length} / {drafts.length} 份草稿
            </span>
          </div>
        ) : null}

        {drafts.length === 0 ? (
          <div className={styles.empty}>
            <Layers size={26} strokeWidth={1.5} />
            <span className={styles.emptyTitle}>还没有创作草稿</span>
            <span className={styles.emptyDesc}>从主题起稿，生成的候选留在草稿里；只有你定稿的那一张才会成为正式花型。</span>
            {createButton}
          </div>
        ) : (
          <div className={styles.grid} role="list" aria-label="草稿列表">
            {keyword ? null : (
              <button type="button" className={styles.create} onClick={() => setStartOpen(true)}>
                <span className={styles.createIcon} aria-hidden>
                  <Plus size={18} strokeWidth={2} />
                </span>
                <span className={styles.createLabel}>新建起稿</span>
                <span className={styles.createHint}>单幅印花或连续花型</span>
              </button>
            )}
            {visible.map((draft) => (
              <div
                key={draft.id}
                role="listitem"
                className={styles.card}
                tabIndex={0}
                onClick={() => openDraft(draft.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openDraft(draft.id);
                  }
                }}
              >
                <div className={styles.thumb}>
                  {draft.previewUrl ? (
                    <img src={draft.previewUrl} alt="" loading="lazy" />
                  ) : (
                    <span className={styles.thumbEmpty}>
                      <Layers size={20} strokeWidth={1.6} />
                    </span>
                  )}
                  <div className={styles.badges}>
                    <span className={styles.badge}>{DRAFT_COMPOSE_TYPE_LABELS[draft.composeType]}</span>
                    {draft.candidateCount > 0 ? <span className={styles.badge}>{draft.candidateCount} 张候选</span> : null}
                  </div>
                  <Popconfirm
                    title="删除该草稿？"
                    description="正式花型与已入库原稿不会被删除。"
                    onConfirm={() => remove.mutate(draft.id, { onError: (error) => message.error(errorText(error)) })}
                  >
                    <button
                      type="button"
                      className={styles.cardDelete}
                      aria-label={`删除草稿 ${draft.name}`}
                      title="删除草稿"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Trash2 size={13} strokeWidth={2} />
                    </button>
                  </Popconfirm>
                </div>
                <div className={styles.body}>
                  <span className={styles.name}>{draft.name}</span>
                  <span className={styles.metaRow}>
                    <span className={styles.meta}>{relativeTime(draft.updatedAt)}更新</span>
                    <span className={styles.continue}>继续 ›</span>
                  </span>
                </div>
              </div>
            ))}
            {visible.length === 0 ? <span className={styles.noMatch}>没有匹配「{search.trim()}」的草稿。</span> : null}
          </div>
        )}
      </div>

      <StartDraftDialog
        open={startOpen}
        onClose={() => setStartOpen(false)}
        onCreated={(draft) => {
          setStartOpen(false);
          openDraft(draft.id);
        }}
      />
    </div>
  );
}
