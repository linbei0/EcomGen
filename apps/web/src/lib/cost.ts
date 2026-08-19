/**
 * Job.estimatedCost/actualCost 目前仅约束为 object|null。除“明确 KNOWN 金额结构”外，一律展示未知文案，
 * 禁止展示推测金额与"约 ¥0.00"式假精确数字。
 */
export const COST_UNKNOWN_TEXT = "费用由 Provider 决定，当前无法预估";

interface KnownCostShape {
  status: "KNOWN";
  amount: number;
  currency: string;
}

function isKnownCost(value: unknown): value is KnownCostShape {
  if (!value || typeof value !== "object") return false;
  const cost = value as Record<string, unknown>;
  return (
    cost.status === "KNOWN" &&
    typeof cost.amount === "number" &&
    Number.isFinite(cost.amount) &&
    typeof cost.currency === "string" &&
    cost.currency.length > 0
  );
}

export function describeCost(cost: unknown): string {
  if (isKnownCost(cost)) {
    return `预计 ${cost.currency} ${cost.amount.toFixed(2)}`;
  }
  return COST_UNKNOWN_TEXT;
}
