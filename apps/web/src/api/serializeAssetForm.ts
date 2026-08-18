import type { AssetRole } from "./adapters/projectDetail";

export function serializeAssetForm(input: {
  file: File;
  role: AssetRole;
  variantId?: string | null;
}): FormData {
  const form = new FormData();
  // 字段必须先于 file：Fastify multipart 的 request.file() 解析第一个 part，
  // file 在前时 handler 读 data.fields.role 会得到 undefined（契约报 role 非空校验失败）
  form.append("role", input.role);
  if (input.variantId) form.append("variantId", input.variantId);
  form.append("file", input.file);
  return form;
}
