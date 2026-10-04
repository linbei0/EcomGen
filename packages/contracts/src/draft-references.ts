/**
 * 参考图引用的两条领域规则：`@图N` 的语法，以及由此决定的「参考图下发」。
 *
 * N 是参考图在草稿内的持久编号（DraftMedia.ordinal），不是它在某次请求里的位置。
 * 只认带 `@` 前缀的写法：裸的「图3」保持普通文本，避免把用户的正常叙述误判成引用。
 *
 * 语法解析只有这一份实现：界面高亮、提交校验与提示词改写全部复用它；下发规则也放在这里，
 * 因为它就是"文本里出现了哪些 `@图N`"的直接推论。如果分成两份，就会出现
 * 「界面上看着像引用、提交后却当普通文字」这类用户看不见的错位。
 */

import type { DraftBatchOperation } from "./pattern-draft-schemas.js";

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

/**
 * 本次提交实际下发的参考图编号，即术语表里的「参考图下发」。
 *
 * 起稿下发草稿内的全部参考图；改稿只下发文本里 `@` 到的；
 * 其余操作（接缝改稿、本地调色、去底）不下发任何参考图——它们的输入里根本没有说明文本。
 *
 * 为什么由服务端推导而不是让调用方声明：起稿与改稿的下发规则不同，而"这张图是否参与本次修改"
 * 是领域规则而非界面偏好。客户端各实现一份，迟早出现"界面上看着带上了、实际没发"这类
 * 用户查不出来的错位；放在这里则只有一份实现，且与 `@图N` 的解析共用同一处语法。
 *
 * 返回按编号升序，与快照、以及提示词里的 `Image k` 顺序一致。编号在草稿里不存在时仍会返回，
 * 由调用方在解析媒体时按"引用了不存在的参考图"拒绝整次提交，而不是在这里静默丢弃。
 */
export function dispatchedReferenceOrdinals(input: {
  operation: DraftBatchOperation;
  /** 改稿的引用来源。 */
  instruction?: string | null;
  /** 草稿内全部参考图的编号。 */
  availableOrdinals: readonly number[];
}): number[] {
  if (input.operation === "GENERATE") return [...input.availableOrdinals].sort((left, right) => left - right);
  if (input.operation !== "EDIT") return [];
  const cited = new Set(findDraftReferences(input.instruction ?? "").map((match) => match.ordinal));
  return [...cited].sort((left, right) => left - right);
}
