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
const LibraryPage = lazy(() =>
  import("../features/library/LibraryPage").then((module) => ({ default: module.LibraryPage })),
);
const SuiteForgePage = lazy(() =>
  import("../features/suite-forge/SuiteForgePage").then((module) => ({ default: module.SuiteForgePage })),
);
const ModelsPage = lazy(() =>
  import("../features/models/ModelsPage").then((module) => ({ default: module.ModelsPage })),
);
const PatternsPage = lazy(() =>
  import("../features/patterns/PatternsPage").then((module) => ({ default: module.PatternsPage })),
);
const PatternWorkspacePage = lazy(() =>
  import("../features/patterns/PatternWorkspacePage").then((module) => ({ default: module.PatternWorkspacePage })),
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
  {
    path: "/library",
    element: (
      <Suspense fallback={<RouteFallback />}>
        <LibraryPage />
      </Suspense>
    ),
  },
  {
    path: "/suite-forge",
    element: (
      <Suspense fallback={<RouteFallback />}>
        <SuiteForgePage />
      </Suspense>
    ),
  },
  {
    path: "/models",
    element: (
      <Suspense fallback={<RouteFallback />}>
        <ModelsPage />
      </Suspense>
    ),
  },
  {
    path: "/patterns",
    element: (
      <Suspense fallback={<RouteFallback />}>
        <PatternsPage />
      </Suspense>
    ),
  },
  {
    // 花型工作区：全屏详情视图（舞台预览 + 生命周期动作栏 + 版本栈），取代旧的详情抽屉。
    path: "/patterns/:patternId",
    element: (
      <Suspense fallback={<RouteFallback />}>
        <PatternWorkspacePage />
      </Suspense>
    ),
  },
]);
