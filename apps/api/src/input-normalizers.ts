import type { FastifyRequest } from "fastify";
import type { ModelDefinition, SearchSourceKind } from "@ecomgen/contracts";
import { ApiError } from "./errors.js";

/** 输入归一化只处理兼容性，不承担资源存在性或状态机规则。 */
export function parameter(request: FastifyRequest, name: string): string {
  const value = (request.params as Record<string, unknown>)[name];
  return readText(value, name);
}

export function readObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "VALIDATION_ERROR", `${path} must be an object`);
  return value as Record<string, unknown>;
}

export function readText(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "VALIDATION_ERROR", `${path} must be a non-empty string`);
  return value.trim();
}

export function readOptionalText(value: unknown): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : readText(value, "value");
}

export function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new ApiError(400, "VALIDATION_ERROR", `${path} must be a boolean`);
  return value;
}

export function readPriority(value: unknown): number {
  const priority = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(priority) || priority < 0 || priority > 100_000) throw new ApiError(400, "VALIDATION_ERROR", "priority must be an integer between 0 and 100000");
  return priority;
}

export function searchSourceBaseUrl(kind: SearchSourceKind, value: string | undefined): string {
  const baseUrl = value ?? (kind === "brave" ? "https://api.search.brave.com/res/v1/web/search" : kind === "tavily" ? "https://api.tavily.com/search" : "http://127.0.0.1:8080/search");
  try { new URL(baseUrl); } catch { throw new ApiError(400, "VALIDATION_ERROR", "baseUrl must be a valid URL"); }
  return baseUrl;
}

export function readTextArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new ApiError(400, "VALIDATION_ERROR", `${path} must be an array of strings`);
  return value as string[];
}

export function readOptionalTextArray(value: unknown): string[] | undefined {
  return value === undefined ? undefined : readTextArray(value, "value");
}

export function readJsonObject(value: string | undefined, path: string): Record<string, unknown> {
  if (!value) return {};
  try { return readObject(JSON.parse(value), path); } catch { throw new ApiError(400, "VALIDATION_ERROR", `${path} must be valid JSON object`); }
}

export function readJsonTextArray(value: string | undefined, path: string): string[] {
  if (!value) return [];
  try { return readTextArray(JSON.parse(value), path); } catch { throw new ApiError(400, "VALIDATION_ERROR", `${path} must be a JSON array of strings`); }
}

export function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  const item = readText(value, path) as T;
  if (!allowed.includes(item)) throw new ApiError(400, "VALIDATION_ERROR", `${path} must be one of ${allowed.join(", ")}`);
  return item;
}

export function enumArray<T extends string>(value: unknown, allowed: readonly T[], path: string): T[] {
  const items = readTextArray(value, path).map((item) => enumValue<T>(item, allowed, path));
  return [...new Set(items)];
}

export function objectOfStrings(value: unknown, path: string): Record<string, string> {
  const result = readObject(value, path);
  for (const [key, item] of Object.entries(result)) if (typeof item !== "string") throw new ApiError(400, "VALIDATION_ERROR", `${path}.${key} must be a string`);
  return result as Record<string, string>;
}

export function normalizeModels(value: unknown): ModelDefinition[] {
  if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, "VALIDATION_ERROR", "models must contain at least one model");
  return value.map((model, index) => {
    const entry = readObject(model, `models[${index}]`);
    return {
      id: readText(entry.id, `models[${index}].id`),
      supportsVision: Boolean(entry.supportsVision),
      supportsThinking: Boolean(entry.supportsThinking),
      supportsTools: Boolean(entry.supportsTools),
      supportsStructuredOutput: Boolean(entry.supportsStructuredOutput),
      imageApiKind: entry.imageApiKind === "openai_images" || entry.imageApiKind === "gemini" || entry.imageApiKind === "custom" ? entry.imageApiKind : null,
    };
  });
}
