/** 各子仓库共享的底层工具；仅限 repositories/ 目录内部使用，不属于公共 API。 */
export type Row = Record<string, unknown>;
export const now = (): string => new Date().toISOString();
export const json = (value: unknown): string => JSON.stringify(value);
export const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;
