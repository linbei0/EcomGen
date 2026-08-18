/**
 * jest-dom matcher 的 vitest 类型增强。
 * 官方 @testing-library/jest-dom/vitest 的增强在 pnpm 下解析到根目录的 vitest 实例
 * （本包因 jsdom peer 使用不同实例），增强不可见；此文件等价地在本包实例上声明。
 */
import type * as jestDomMatchers from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends jestDomMatchers.TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining
    extends jestDomMatchers.TestingLibraryMatchers<any, any> {}
}
