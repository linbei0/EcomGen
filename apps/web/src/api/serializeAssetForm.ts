import type { AssetRole } from "./adapters/projectDetail";

export function serializeAssetForm(input: {
  file: File;
  role: AssetRole;
  variantId?: string | null;
}): FormData {
  const form = new FormData();
  form.append("file", input.file);
  form.append("role", input.role);
  if (input.variantId) form.append("variantId", input.variantId);
  return form;
}
