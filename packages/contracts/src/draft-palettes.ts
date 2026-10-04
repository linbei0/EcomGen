/**
 * 配色 token 的语法，以及把 token 变成提示词子句的改写。
 *
 * 配色不是一种操作，而是说明文本里的一个色值：`#d9a441`。这个选择是为了解决原「色板变体」操作的
 * 根本问题——它没有指令框，于是没有任何办法说"只改哪里"，只能整张图变色。把颜色放进文本之后，
 * 同一句话里就能同时限定范围（"把叶子改成 #4f7dc9 的配色"）与引用参考图。
 *
 * token 就是色值本身，不再套一层包装：曾经的 `@色板(#d9a441)` 让正文平白多出一串字符，
 * 读起来是"配色(#d9a441)"这种拗口的写法，而 `@` 又已经被参考图（`@图N`）占着——一个符号管一件事。
 * 现在敲 `#` 挑起选色、插进去的就是那个色值，入口与 token 是同一个符号。
 *
 * 认法是"看起来就是色值"：`#` 后跟 3/4/6/8 位十六进制。长度卡死是刻意的，正文里 `#` 太常见
 *（"第 #2 版"、`#标签`），而它们都不是 3 位以上的十六进制串。代价是手写错长度的色值（漏一位的
 * `#12345`）既不算颜色也不报错；但界面上的颜色都从取色器插入，没有手写出错的路径，
 * 因此不再需要"token 写坏了"那类校验。
 *
 * 与 draft-references.ts 同源：解析只有这一份实现，界面高亮与提示词改写共用它。
 */

export interface DraftPaletteMatch {
  /** 命中区间 [start, end)，供界面包裹高亮与提示词改写替换。 */
  start: number;
  end: number;
  /** 命中的色值，形如 `#d9a441`。 */
  color: string;
}

/**
 * 列出文本里出现的全部色值 token，按出现顺序返回。
 *
 * 长写法排在短写法前面：`#11223344` 必须整体命中，否则会先被六位规则吃掉前六位、把剩下的字符
 * 留在正文里。结尾的 `(?![0-9a-fA-F])` 同理：七位十六进制不是色值，不能截前六位当命中。
 */
export function findDraftPalettes(text: string): DraftPaletteMatch[] {
  const matches: DraftPaletteMatch[] = [];
  // 每次新建正则：带 g 的实例会记忆 lastIndex，跨调用复用一个实例会漏掉命中。
  const pattern = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    matches.push({ start: hit.index, end: hit.index + hit[0].length, color: hit[0] });
  }
  return matches;
}

/**
 * 把说明文本里的色值 token 改写成模型能读的形式，并告知是否出现过配色。
 *
 * 用一个带方括号的短标记而不是原样的十六进制：括号让它在一句话里仍然是一个"整体"，
 * 模型会把它读成一组配色而不是散落的色值。第二个返回值给调用方决定要不要追加配色意图句。
 */
export function rewriteDraftPalettes(text: string): { text: string; hasPalette: boolean } {
  const matches = findDraftPalettes(text);
  if (matches.length === 0) return { text, hasPalette: false };
  let rewritten = "";
  let cursor = 0;
  for (const match of matches) {
    rewritten += text.slice(cursor, match.start) + `[配色 ${match.color}]`;
    cursor = match.end;
  }
  return { text: rewritten + text.slice(cursor), hasPalette: true };
}
