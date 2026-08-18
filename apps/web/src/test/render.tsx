import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { MotionConfig } from "motion/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router";

import { antdTheme } from "../design/antdTheme";

interface Options extends Omit<RenderOptions, "wrapper"> {
  initialEntries?: string[];
}

/** 与应用一致的最小 Provider 栈；每次渲染独立 QueryClient，用例间无缓存泄漏。 */
export function renderWithProviders(ui: ReactElement, options?: Options) {
  const { initialEntries = ["/"], ...renderOptions } = options ?? {};
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ConfigProvider theme={antdTheme} locale={zhCN} button={{ autoInsertSpace: false }}>
          <AntdApp>
            <MotionConfig reducedMotion="always">
              <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
            </MotionConfig>
          </AntdApp>
        </ConfigProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
