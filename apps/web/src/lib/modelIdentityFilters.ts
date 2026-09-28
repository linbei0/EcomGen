import type { ModelSpec } from "@ecomgen/contracts";
import { MODEL_SPEC_FIELDS } from "@ecomgen/ecom-skill";

/**
 * 身份内核五个维度：模特库与资产库「模特」类型共用同一份取值与中文文案。
 * 选项直接以 ecom-skill 的 MODEL_SPEC_FIELDS 为键单源派生，不维护第二份映射，
 * 也不含 MODEL_SPEC_DEFAULTS 的基准值——空筛选表示「全部」，基准值不是用户选中的筛选值。
 */
export type ModelIdentityKey = "gender" | "age" | "heritage" | "stature" | "build";

export interface ModelIdentityFilterDef {
  key: ModelIdentityKey;
  label: string;
  options: Array<{ value: string; label: string }>;
}

const IDENTITY_KEYS: readonly ModelIdentityKey[] = ["gender", "age", "heritage", "stature", "build"];

export const MODEL_IDENTITY_FILTERS: ReadonlyArray<ModelIdentityFilterDef> = IDENTITY_KEYS.map((key) => {
  const field = MODEL_SPEC_FIELDS[key];
  return {
    key,
    label: field.label,
    options: Object.entries(field.options).map(([value, option]) => ({ value, label: option.label })),
  };
});

/** 已选身份维度：键缺省即该维度不参与筛选。 */
export type ModelIdentityFilters = Partial<Record<ModelIdentityKey, string>>;

/** 维度之间取交集：每个已选维度都必须与模特规格完全一致。 */
export function matchesModelIdentity(spec: ModelSpec, filters: ModelIdentityFilters): boolean {
  const values = spec as unknown as Record<string, unknown>;
  return Object.entries(filters).every(([key, wanted]) => !wanted || values[key] === wanted);
}
