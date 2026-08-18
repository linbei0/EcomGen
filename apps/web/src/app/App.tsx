import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { MotionConfig } from "motion/react";
import { RouterProvider } from "react-router";

import { isApiError } from "../api/errors";
import { antdTheme } from "../design/antdTheme";
import { router } from "./routes";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // 4xx 是确定性失败（校验/冲突/能力），重试无意义；5xx 与网络错误重试 2 次
      retry: (count, error) => (isApiError(error) && error.status < 500 ? false : count < 2),
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ConfigProvider theme={antdTheme} locale={zhCN} button={{ autoInsertSpace: false }}>
        <AntdApp>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </AntdApp>
      </ConfigProvider>
    </MotionConfig>
  );
}
