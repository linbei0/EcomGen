import { describeCost } from "../lib/cost";

export function CostHint({ cost }: { cost?: unknown }) {
  return <span>{describeCost(cost)}</span>;
}
