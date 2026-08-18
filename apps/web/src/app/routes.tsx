import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router";

import { Skeleton } from "antd";

// 路由级代码分割：首页与工作台互不阻塞，首屏只载入当前页 chunk（文档 10 性能预算）。
const HomePage = lazy(() =>
  import("../features/home/HomePage").then((module) => ({ default: module.HomePage })),
);
const WorkbenchPage = lazy(() =>
  import("../features/workbench/WorkbenchPage").then((module) => ({ default: module.WorkbenchPage })),
);

function RouteFallback() {
  return (
    <div style={{ padding: 32 }}>
      <Skeleton active paragraph={{ rows: 6 }} />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <Suspense fallback={<RouteFallback />}>
        <HomePage />
      </Suspense>
    ),
  },
  {
    path: "/projects/:projectId",
    element: (
      <Suspense fallback={<RouteFallback />}>
        <WorkbenchPage />
      </Suspense>
    ),
  },
]);
