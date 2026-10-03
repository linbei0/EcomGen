/**
 * 输入框内显式引用参考图的唯一语法：`@图N`。
 *
 * N 是参考图在草稿内的持久编号（DraftMedia.ordinal），不是它在某次请求里的位置。
 * 只认带 `@` 前缀的写法：裸的「图3」保持普通文本，避免把用户的正常叙述误判成引用。
 *
 * 解析只有这一份实现：界面高亮、提交校验与提示词改写全部复用它。如果分成两份，
 * 就会出现「界面上看着像引用、提交后却当普通文字」这类用户看不见的错位。
 */

export interface DraftReferenceMatch {
  /** 命中区间 [start, end)，供界面包裹高亮与提交前替换。 */
  start: number;
  end: number;
  ordinal: number;
}

/** 列出文本里出现的全部引用，按出现顺序返回；同一编号可出现多次。 */
export function findDraftReferences(text: string): DraftReferenceMatch[] {
  const matches: DraftReferenceMatch[] = [];
  // 每次新建正则：带 g 的实例会记忆 lastIndex，跨调用复用一个实例会漏掉命中。
  const pattern = /@图(\d+)/g;
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    matches.push({ start: hit.index, end: hit.index + hit[0].length, ordinal: Number(hit[1]) });
  }
  return matches;
}

/** 文本引用了、但当前草稿没有对应编号的参考图；调用方在提交前据此拒绝整个请求，而不是替用户猜。 */
export function danglingDraftReferenceOrdinals(text: string, validOrdinals: Iterable<number>): number[] {
  const valid = new Set(validOrdinals);
  const dangling = new Set<number>();
  for (const match of findDraftReferences(text)) if (!valid.has(match.ordinal)) dangling.add(match.ordinal);
  return [...dangling].sort((left, right) => left - right);
}
