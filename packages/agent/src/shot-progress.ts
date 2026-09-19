/**
 * 反推响应里每张分镜都会出现的键，且不会出现在分镜正文里（正文是英文生图 prompt）。
 * 用它当计数标记，比解析半个 JSON 便宜得多。
 */
const SHOT_MARKER = '"shotRole"';

/**
 * 从流式 JSON 文本里增量统计已生成的分镜数。
 *
 * 每个 delta 只扫一遍自己带来的字符，整轮合计 O(响应长度)（一套十张分镜的 JSON 约 20KB）。
 * 标记可能被切在两个 delta 之间，所以保留「标记长度减一」的尾巴参与下一次拼接扫描；
 * 只有在一段新文本内**结束**的标记才计数，保证同一个标记恰好计一次。
 *
 * 禁止对累计文本重新正则或 JSON.parse：那是 O(n²)，而且半个 JSON 必然解析失败，
 * 会把异常刷满日志。
 */
export class ShotStreamCounter {
  private tail = "";
  private total = 0;

  /** 追加一段流式文本，返回累计分镜数。计数不保证单调：模型可能回填字段或整轮重试。 */
  push(delta: string): number {
    if (delta.length === 0) return this.total;
    const settled = this.tail.length;
    const text = this.tail + delta;
    for (let start = text.indexOf(SHOT_MARKER); start !== -1; start = text.indexOf(SHOT_MARKER, start + 1)) {
      // 尾巴里的字符属于上一次 push：只有在本段文本内结束的标记才是新的一张。
      if (start + SHOT_MARKER.length > settled) this.total += 1;
    }
    this.tail = text.slice(Math.max(0, text.length - SHOT_MARKER.length + 1));
    return this.total;
  }

  /** 新的一轮 assistant turn（含失败重试）会重发整份 JSON，旧计数必须作废。 */
  reset(): void {
    this.tail = "";
    this.total = 0;
  }
}
