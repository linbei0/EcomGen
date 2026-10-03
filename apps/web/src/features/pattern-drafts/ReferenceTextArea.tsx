import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { findDraftReferences } from "@ecomgen/contracts";
import styles from "./ReferenceTextArea.module.css";

export interface ReferenceOption {
  /** 参考图的持久编号，即界面上的「图N」。 */
  ordinal: number;
  fileName: string;
  /** 按内容 hash 寻址的缩略图：下拉里只显示 22px 小图，不拉原图。 */
  thumbUrl: string;
}

interface ReferenceTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  /** 可引用的参考图；为空时输入框退化成普通文本域，不会弹出空下拉。 */
  references: readonly ReferenceOption[];
  rows?: number;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
}

/** 光标前正在输入的引用片段：`@`、`@图`、`@图1` 都算触发，`@图1的` 不算。 */
function activeTrigger(value: string, caret: number): { start: number; query: string } | null {
  const hit = /@(图\d*)?$/.exec(value.slice(0, caret));
  if (!hit) return null;
  return { start: caret - hit[0].length, query: hit[1]?.slice(1) ?? "" };
}

/**
 * 光标前这段是否已经是写好的、且编号存在的引用。
 *
 * 已写完的引用不再弹下拉：回车选中后光标正停在 `@图1` 词尾，若不判定为「已完成」，
 * 紧随其后的 select 事件会立刻把下拉重新打开，用户会以为回车没生效。
 */
function isCompleteReference(fragment: string, known: ReadonlySet<number>): boolean {
  const match = /^@图(\d+)$/.exec(fragment);
  return match !== null && known.has(Number(match[1]));
}

/**
 * 支持显式引用参考图的文本域。
 *
 * textarea 无法给局部文字上样式——HTML 规范把它的内容当纯文本，所以这里用「textarea 照常输入 +
 * 底层镜像层只画引用底色」的做法：镜像层与 textarea 共用同一套字号、行高、内边距与换行规则，
 * 滚动同步后两者字符位置重合，用户看到的就是带底色的 chip。这样输入法组合、选区、撤销全部仍是
 * 原生行为，中文输入法下比自绘富文本安全得多；代价是镜像与输入框必须像素对齐，下面所有看似
 * 啰嗦的尺寸与滚动处理都是在维持这条对齐。
 *
 * 输入框里始终是纯文本 `@图N`，不存结构化标记：高亮与提交校验复用契约里的同一份解析，
 * 界面上看起来是引用、提交时也一定是引用。
 */
export function ReferenceTextArea({ value, onChange, references, rows = 4, placeholder, ariaLabel, disabled }: ReferenceTextAreaProps) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  /** 接受引用后待落的光标位置；在值真正写回 DOM 之后再生效，避免用 rAF 猜渲染时机。 */
  const pendingCaretRef = useRef<number | null>(null);
  const listId = `draft-ref-${useId()}`;
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerAt, setPickerAt] = useState<{ top: number; left: number } | null>(null);

  const knownOrdinals = useMemo(() => new Set(references.map((reference) => reference.ordinal)), [references]);
  const options = useMemo(() => {
    if (!trigger) return [];
    const matched = references.filter((reference) => trigger.query === "" || String(reference.ordinal).includes(trigger.query));
    // 查不到就把全部列出来：编号写错或指向已删除的参考图时，用户得有地方把它改回一张真实存在的图。
    return (matched.length ? matched : references).slice(0, 8);
  }, [trigger, references]);
  const open = Boolean(trigger) && options.length > 0;

  const syncScroll = useCallback(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    // 用 transform 而不是同步 scrollTop：不触发重排，也不会和浏览器自身的滚动打架。
    mirror.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
  }, []);

  // 滚动条占位用实测差值补齐，不猜浏览器滚动条宽度——这一项差几像素，换行位置就会整体错开。
  useEffect(() => {
    const field = fieldRef.current;
    const input = inputRef.current;
    if (!field || !input) return;
    const measure = () => {
      const computed = getComputedStyle(input);
      const borders = Number.parseFloat(computed.borderLeftWidth || "0") + Number.parseFloat(computed.borderRightWidth || "0");
      field.style.setProperty("--ref-gutter", `${Math.max(0, input.offsetWidth - input.clientWidth - borders)}px`);
      syncScroll();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(input);
    return () => observer.disconnect();
  }, [syncScroll]);

  const syncTrigger = useCallback(() => {
    const input = inputRef.current;
    // 输入法组合期间不解析触发符：此时 value 还是半成品，弹下拉会打断候选词选择。
    if (!input || composingRef.current) return;
    const caret = input.selectionStart;
    const next = activeTrigger(input.value, caret);
    setTrigger(next && !isCompleteReference(input.value.slice(next.start, caret), knownOrdinals) ? next : null);
    setActiveIndex(0);
  }, [knownOrdinals]);

  const accept = useCallback(
    (option: ReferenceOption) => {
      const input = inputRef.current;
      if (!input || !trigger) return;
      const caret = input.selectionStart;
      const current = input.value;
      // 后面已经跟空白就不再补：否则接着输入的字会黏在编号上，更糟的是数字会被并进编号
      // （@图1 后再输 2 就成了 @图12，直接指向另一张图或变成悬空引用）。
      const separator = /^[\s\u3000]/.test(current.slice(caret)) ? "" : " ";
      const token = `@图${option.ordinal}${separator}`;
      pendingCaretRef.current = trigger.start + token.length;
      onChange(current.slice(0, trigger.start) + token + current.slice(caret));
      setTrigger(null);
    },
    [onChange, trigger],
  );

  // 光标必须在新的值写进 DOM 之后再落：早一步会被浏览器夹回旧文本长度，
  // 之后 React 再写值又把光标推到末尾，接着输入的字符就会插到错误的位置。
  useLayoutEffect(() => {
    const input = inputRef.current;
    const caret = pendingCaretRef.current;
    if (!input || caret === null) return;
    pendingCaretRef.current = null;
    input.focus();
    input.setSelectionRange(caret, caret);
    syncScroll();
  }, [value, syncScroll]);

  // 下拉贴着光标：把光标前的文本复刻到离屏层量出插入点，再减掉 textarea 自身的滚动量。
  useLayoutEffect(() => {
    const input = inputRef.current;
    const measure = measureRef.current;
    if (!open || !trigger || !input || !measure) {
      setPickerAt(null);
      return;
    }
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    measure.replaceChildren(document.createTextNode(input.value.slice(0, trigger.start)), marker);
    const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight || "22");
    setPickerAt({
      top: marker.offsetTop - input.scrollTop + (Number.isFinite(lineHeight) ? lineHeight : 22),
      left: Math.max(0, marker.offsetLeft - input.scrollLeft),
    });
  }, [open, trigger, value]);

  // 引用高亮：解析只有契约里那一份，界面的 chip 范围和提交时的校验范围因此必然一致。
  const segments = useMemo(() => {
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const match of findDraftReferences(value)) {
      if (match.start > cursor) parts.push(value.slice(cursor, match.start));
      parts.push(
        <mark key={`${match.start}-${match.ordinal}`} className={knownOrdinals.has(match.ordinal) ? styles.refToken : styles.refTokenDangling}>
          {value.slice(match.start, match.end)}
        </mark>,
      );
      cursor = match.end;
    }
    // 末尾换行时补一个换行：镜像层最后一行若为空行，高度会塌掉，光标位置随即偏一行。
    parts.push(value.slice(cursor) + (value.endsWith("\n") ? "\n" : ""));
    return parts;
  }, [value, knownOrdinals]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法组合期间的回车是「确认候选词」，不能当成选择引用。
    if (composingRef.current || !open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + options.length) % options.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const option = options[activeIndex] ?? options[0];
      if (option) accept(option);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setTrigger(null);
    }
  };

  return (
    <div ref={fieldRef} className={styles.refField} data-disabled={disabled ? "true" : undefined}>
      <div ref={measureRef} className={`${styles.refMetrics} ${styles.refMeasure}`} aria-hidden="true" />
      <div className={styles.refMirror} aria-hidden="true">
        <div ref={mirrorRef} className={styles.refMetrics}>{segments}</div>
      </div>
      <textarea
        ref={inputRef}
        className={styles.refInput}
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        onScroll={syncScroll}
        onChange={(event) => {
          onChange(event.target.value);
          syncTrigger();
        }}
        onSelect={syncTrigger}
        onClick={syncTrigger}
        onBlur={() => setTrigger(null)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          syncTrigger();
        }}
        onKeyDown={handleKeyDown}
      />
      {open ? (
        <div
          id={listId}
          className={styles.refPicker}
          style={{ top: pickerAt?.top, left: pickerAt?.left }}
          role="listbox"
          aria-label="选择要引用的参考图"
          // 按下不夺焦：否则 textarea 先失焦关掉下拉，点击根本落不到选项上。
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) => (
            <button
              key={option.ordinal}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={styles.refPickerItem}
              data-active={index === activeIndex ? "true" : undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => accept(option)}
            >
              <img src={option.thumbUrl} alt="" className={styles.refPickerThumb} />
              <span className={styles.refPickerOrdinal}>图{option.ordinal}</span>
              <span className={styles.refPickerName}>{option.fileName}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
