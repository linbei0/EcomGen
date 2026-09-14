import { Value } from "@sinclair/typebox/value";
import { EcomSuiteFile } from "./api-schemas.js";
import { API_SCHEMA_REGISTRY } from "./api-registry.js";

const references = Object.values(API_SCHEMA_REGISTRY);

export interface SuiteFileValidation {
  ok: boolean;
  errors: string[];
}

/**
 * 校验套图文档（内置 JSON、用户上传或目录投放）是否符合 EcomSuiteFile 契约。
 * 与 API 的 parseBody 共用同一批 $ref，保证运行时校验与 OpenAPI 视图一致。
 */
export function validateEcomSuiteFile(value: unknown): SuiteFileValidation {
  if (Value.Check(EcomSuiteFile, references, value)) return { ok: true, errors: [] };
  const errors = [...Value.Errors(EcomSuiteFile, references, value)].map((error) => `${error.path || "/"}: ${error.message}`);
  return { ok: false, errors };
}
