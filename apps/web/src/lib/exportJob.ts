/** 导出只允许 SELECTED；其余决策不计入也不可选。 */
export function exportableOutputs(outputs: readonly { id: string; reviewDecision: string }[]): string[] {
  return outputs.filter((output) => output.reviewDecision === "SELECTED").map((output) => output.id);
}
