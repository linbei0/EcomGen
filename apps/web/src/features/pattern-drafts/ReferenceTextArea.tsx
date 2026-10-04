import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { findDraftPalettes, findDraftReferences } from "@ecomgen/contracts";
import styles from "./ReferenceTextArea.module.css";

export interface ReferenceOption {
  /** 参考图的持久编号，即界面上的「图N」。 */
  ordinal: number;
  fileName: string;
  /** 按内容 hash 寻址的缩略图：下拉里只显示 22px 小图，不拉原图。 */
  thumbUrl: string;
}

/**
 * 配色下拉里的颜色。
 *
 * 与画布上的标记色是两回事：那几个只决定"看不看得见"，这一组是给模型的配色建议，
 * 所以要有几个中性锚点（近白、灰、近黑）——一个配色方案里往往需要"底色"这一档。
 */
const PALETTE_PRESETS = ["#c94f4f", "#d9a441", "#3fa06a", "#4f7dc9", "#b45fd0", "#edece6", "#8b897f", "#1b1b1f"] as const;

interface ReferenceTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  /** 可引用的参考图；为空时输入框退化成普通文本域，不会弹出空引用下拉。 */
  references: readonly ReferenceOption[];
  rows?: number;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
}

/**
 * 光标前正在输入的触发片段。
 *
 * 参考图是 `@` / `@图` / `@图1`（`@图1的` 不算，那是句子里正好写了三个字）；
 * 颜色是 `#` / `#c9` / `#c94f4f`，也就是 `#` 后紧跟的十六进制串——`#` 本来就是色值的写法。
 *
 * 代价是正文里 `#` 后紧跟十六进制字符时会短暂弹下拉（"第 #2 版"这种）。触发只发生在光标正好停在
 * 那串字符末尾时，继续输入或挪开光标就消失；`#标签` 之类不触发，因为 `标` 不是十六进制字符，
 * 正则要求 `#` 之后直接到词尾。
 *
 * 插入之后下拉不会自己重开：接受插入走的是 `onChange(next)` 这个 prop，而不是 textarea 的输入事件，
 * 所以没有任何一次 syncTrigger 会在新值落地后跑。光标此后停在色值末尾，点那里会重开下拉——那是
 * "改这个颜色"的意思，插进去的新颜色会替换掉整段色值。
 */
type Trigger = { kind: "reference"; start: number; query: string } | { kind: "color"; start: number };

/** 已经写完的 CSS 色值（三/四/六/八位）。用来判断用户是不是把颜色直接敲了出来。 */
const COMPLETE_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** 插入 token 后光标该落的位置：跳过插入点后面已有的空白，免得下一个字紧贴着 token 写。 */
function skipWhitespace(text: string, from: number): number {
  let index = from;
  while (index < text.length && (text[index] === " " || text[index] === "\u3000")) index += 1;
  return index;
}

/**
 * 色值 chip 的底色与描边，取自色值本身。
 *
 * 底色是"色值三成 + 一层固定的中性提亮"，描边是"色值内侧 + 中性外侧"两层。中性那层不是装饰：
 * 只用色值本身的话，近黑的颜色在暗色界面上等于没画，而 `#1b1b1f` 就在预设里——和当初"白笔在白底图上"
 * 是同一个错误。中性层保证"这里有个 chip"永远成立，色值层负责说明是哪个颜色。
 *
 * 一律用 box-shadow 而不是 border：镜像层与 textarea 必须逐字符对齐，
 * 任何会改变盒子尺寸的边框都会把两侧的文字推开。
 */
function paletteTokenStyle(color: string): React.CSSProperties {
  const rgb = parseHexRgb(color);
  if (!rgb) return {};
  const [r, g, b] = rgb;
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.3)`,
    backgroundImage: "linear-gradient(rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.07))",
    boxShadow: `inset 0 0 0 1px rgba(${r}, ${g}, ${b}, 0.9), inset 0 0 0 3px rgba(255, 255, 255, 0.1)`,
  };
}

/** `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` → rgb；高亮只取色相，透明度不进底色。 */
function parseHexRgb(color: string): [number, number, number] | null {
  const hex = color.slice(1);
  const full = hex.length <= 4 ? [...hex].map((char) => char + char).join("") : hex;
  if (full.length !== 6 && full.length !== 8) return null;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function activeTrigger(value: string, caret: number): Trigger | null {
  const before = value.slice(0, caret);
  const color = /#([0-9a-fA-F]{0,8})?$/.exec(before);
  if (color) return { kind: "color", start: caret - color[0].length };
  const reference = /@(图\d*)?$/.exec(before);
  if (!reference) return null;
  return { kind: "reference", start: caret - reference[0].length, query: reference[1]?.slice(1) ?? "" };
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
 * 支持在正文里插入参考图与颜色的文本域。
 *
 * textarea 无法给局部文字上样式——HTML 规范把它的内容当纯文本，所以这里用「textarea 照常输入 +
 * 底层镜像层只画引用底色」的做法：镜像层与 textarea 共用同一套字号、行高、内边距与换行规则，
 * 滚动同步后两者字符位置重合，用户看到的就是带底色的 chip。这样输入法组合、选区、撤销全部仍是
 * 原生行为，中文输入法下比自绘富文本安全得多；代价是镜像与输入框必须像素对齐，下面所有看似
 * 啰嗦的尺寸与滚动处理都是在维持这条对齐。
 *
 * 颜色走触发符而不是"先攒几个色、再一次性插入"：攒色时颜色是一个独立对象，
 * 用户记不住哪个色是给哪句话的，插进去也只是一串并列的色值。一次插一个颜色、插在光标处，
 * 颜色就落在它该在的那半句里，作用范围由句子本身表达。
 *
 * 输入框里始终是纯文本：参考图是 `@图N`，颜色是 `#d9a441` 这样的色值本身，不存结构化标记。
 * 高亮与提交校验复用契约里的同一份解析，界面上看起来是什么、提交时就一定是什么。
 */
export function ReferenceTextArea({ value, onChange, references, rows = 4, placeholder, ariaLabel, disabled }: ReferenceTextAreaProps) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  /** 接受选项后待落的光标位置；在值真正写回 DOM 之后再生效，避免用 rAF 猜渲染时机。 */
  const pendingCaretRef = useRef<number | null>(null);
  const listId = `draft-ref-${useId()}`;
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerAt, setPickerAt] = useState<{ top: number; left: number } | null>(null);
  /** 自定义色槽位的当前值；取色器改一次就插入一次，所以它只是"下一个要插的颜色"。 */
  const [customColor, setCustomColor] = useState("#888888");

  const knownOrdinals = useMemo(() => new Set(references.map((reference) => reference.ordinal)), [references]);
  const options = useMemo(() => {
    if (trigger?.kind !== "reference") return [];
    const matched = references.filter((reference) => trigger.query === "" || String(reference.ordinal).includes(trigger.query));
    // 查不到就把全部列出来：编号写错或指向已删除的参考图时，用户得有地方把它改回一张真实存在的图。
    return (matched.length ? matched : references).slice(0, 8);
  }, [trigger, references]);
  /** 键盘可选中项的数量：颜色下拉只让预设进键盘序列，自定义色要靠鼠标开取色器。 */
  const optionCount = trigger?.kind === "color" ? PALETTE_PRESETS.length : options.length;
  const open = Boolean(trigger) && optionCount > 0;

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
      const next = current.slice(0, trigger.start) + token + current.slice(caret);
      pendingCaretRef.current = skipWhitespace(next, trigger.start + token.length);
      onChange(next);
      setTrigger(null);
    },
    [onChange, trigger],
  );

  /**
   * 用选中的颜色替换触发片段。
   *
   * 插进去的就是色值本身：用户敲 `#` 挑起下拉，选完之后那个 `#` 原地长成一个完整的 `#d9a441`，
   * 没有第二层包装。一次只插一个色、插在光标处，"这个色是给谁的"由它所在的半句决定。
   */
  const acceptColor = useCallback(
    (hex: string) => {
      const input = inputRef.current;
      if (!input || trigger?.kind !== "color") return;
      const caret = input.selectionStart;
      const current = input.value;
      // 与引用同样的分隔处理：后面已跟空白就不再补，否则接着输入的字会黏在色值尾巴上
      // （#d9a441 后再输数字就成了更长的一串，位数一变颜色就没了）。
      const separator = /^[\s\u3000]/.test(current.slice(caret)) ? "" : " ";
      const token = `${hex}${separator}`;
      const next = current.slice(0, trigger.start) + token + current.slice(caret);
      pendingCaretRef.current = skipWhitespace(next, trigger.start + token.length);
      onChange(next);
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

  /*
   * 关闭只看「指针按在面板之外」，不靠 textarea 的 onBlur。
   *
   * 原生取色器打开时浏览器会把焦点从 textarea 拿走，onBlur 就会在用户选好颜色之前把整个下拉
   * 连同 `<input type="color">` 一起拆掉，取色结果没有元素可回传——表现出来就是"选了颜色却没插进去"。
   * 下拉挂在 fieldRef 内部，所以"点在面板或输入框上"天然不触发关闭。
   */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (fieldRef.current?.contains(event.target as Node)) return;
      setTrigger(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  /*
   * 引用与配色两种 token 的高亮。解析只有契约里那两份，界面的底色范围和提交时的校验范围因此必然一致。
   *
   * 两种 token 合并成一条区间序列后再渲染：镜像层的字符位置必须与 textarea 完全重合，
   * 分别插入节点会让两处 `<mark>` 的相邻边界各自带上换行机会，行数一变就整体错开。
   */
  const segments = useMemo(() => {
    const spans: Array<{ start: number; end: number; node: React.ReactNode }> = [];
    for (const match of findDraftReferences(value)) {
      spans.push({
        start: match.start,
        end: match.end,
        node: (
          <mark key={`ref-${match.start}`} className={knownOrdinals.has(match.ordinal) ? styles.refToken : styles.refTokenDangling}>
            {value.slice(match.start, match.end)}
          </mark>
        ),
      });
    }
    for (const match of findDraftPalettes(value)) {
      spans.push({
        start: match.start,
        end: match.end,
        // 底色与描边都用色值本身调出来：一眼看得出这是个什么颜色，暗底上的深色也因为描边在。
        node: (
          <mark key={`palette-${match.start}`} className={styles.paletteToken} style={paletteTokenStyle(match.color)}>
            {match.color}
          </mark>
        ),
      });
    }
    spans.sort((left, right) => left.start - right.start);
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const span of spans) {
      if (span.start > cursor) parts.push(value.slice(cursor, span.start));
      parts.push(span.node);
      cursor = span.end;
    }
    // 末尾换行时补一个换行：镜像层最后一行若为空行，高度会塌掉，光标位置随即偏一行。
    parts.push(value.slice(cursor) + (value.endsWith("\n") ? "\n" : ""));
    return parts;
  }, [value, knownOrdinals]);

  /**
   * 光标前这段 `#…` 是否已经是一个写完整的色值。
   *
   * 用户可能不用鼠标点预设，而是直接把色值敲出来；回车必须认他敲的那一串，
   * 否则敲了 `#000000` 回车却落成高亮预设色，等于把用户输入丢掉。
   */
  const typedColor = (): string | null => {
    const input = inputRef.current;
    if (!input || trigger?.kind !== "color") return null;
    const typed = input.value.slice(trigger.start, input.selectionStart);
    return COMPLETE_HEX.test(typed) ? typed : null;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法组合期间的回车是「确认候选词」，不能当成选择引用。
    if (composingRef.current || !open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % optionCount);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + optionCount) % optionCount);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      if (trigger?.kind === "color") {
        acceptColor(typedColor() ?? PALETTE_PRESETS[activeIndex] ?? PALETTE_PRESETS[0]);
        return;
      }
      const option = options[activeIndex] ?? options[0];
      if (option) accept(option);
      return;
    }
    /*
     * 空格不做特殊处理：敲完的色值本身就是 token，不需要再"落一次"。
     * 上一版要拦空格，是因为 token 被包在 `#配色(…)` 里，光敲颜色只是半成品；
     * 现在拦它反而会吃掉用户的空格。
     */
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
        // relatedTarget 为空说明焦点交给了页面外（原生取色器就是这样），这时不能关：
        // 面板一拆，取色器选中的颜色就无处可落。
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (!next || fieldRef.current?.contains(next)) return;
          setTrigger(null);
        }}
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
          className={trigger?.kind === "color" ? styles.colorPicker : styles.refPicker}
          style={{ top: pickerAt?.top, left: pickerAt?.left }}
          role="listbox"
          aria-label={trigger?.kind === "color" ? "选择要插入的颜色" : "选择要引用的参考图"}
          // 按下不夺焦：否则 textarea 先失焦关掉下拉，点击根本落不到选项上。
          onMouseDown={(event) => event.preventDefault()}
        >
          {trigger?.kind === "color" ? (
            <>
              {PALETTE_PRESETS.map((hex, index) => (
                <button
                  key={hex}
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={styles.colorSwatch}
                  data-active={index === activeIndex ? "true" : undefined}
                  style={{ background: hex }}
                  aria-label={hex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => acceptColor(hex)}
                />
              ))}
              {/*
                自定义色：取色器改一次就插入一次，插入后下拉随之关闭。
                不给"调好了再点确认"的按钮对：这里的单位就是"一次一个颜色"，
                多一步确认反而让人以为可以先攒着。
              */}
              <label className={styles.colorCustom} title="自定义颜色（选中即插入）">
                <input
                  type="color"
                  value={customColor}
                  aria-label="自定义颜色"
                  onChange={(event) => {
                    setCustomColor(event.target.value);
                    acceptColor(event.target.value);
                  }}
                />
              </label>
            </>
          ) : (
            options.map((option, index) => (
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
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
