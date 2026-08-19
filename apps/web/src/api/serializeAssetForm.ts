import type { UserAssetKind } from "./adapters/projectDetail";

export function serializeAssetForm(input: {
  file: File;
  kind: UserAssetKind;
}): FormData {
  const form = new FormData();
  form.append("kind", input.kind);
  form.append("file", input.file);
  return form;
}
