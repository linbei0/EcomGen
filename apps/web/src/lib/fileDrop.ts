import { useCallback, useState, type DragEvent } from "react";

/**
 * 文件投放区的状态机：拖入高亮、离开整个区域才熄灭、放下后把文件交回调用方。
 *
 * 三种入口（素材区、套图工坊、起稿参考图）各自只有文案与样式不同，拖放语义完全一致；
 * 与其各写一份，不如共用这一个。`onDragLeave` 按 `relatedTarget` 判断是否真的离开容器——
 * 拖拽经过内部文字/图标时也会触发 dragleave，不看 relatedTarget 就会一路闪烁。
 */
export function useFileDropTarget(onFiles: (files: File[]) => void): {
  dragging: boolean;
  dropProps: {
    onDragEnter: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDragLeave: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
} {
  const [dragging, setDragging] = useState(false);
  const onDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    setDragging(true);
  }, []);
  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
  }, []);
  const onDragLeave = useCallback((event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  }, []);
  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    onFiles(Array.from(event.dataTransfer.files));
  }, [onFiles]);
  return { dragging, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
