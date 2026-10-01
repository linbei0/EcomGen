/**
 * hero-patterns 未随包发布类型声明：按本项目实际用到的图案收紧签名，
 * 新增图案时在这里补一行导出。
 */
declare module "hero-patterns" {
  /** 返回可直接用于 CSS backgroundImage 的 url('data:image/svg+xml,...') 字符串。 */
  export type HeroPattern = (fill?: string, opacity?: number) => string;
  export const topography: HeroPattern;
  export const signal: HeroPattern;
}
