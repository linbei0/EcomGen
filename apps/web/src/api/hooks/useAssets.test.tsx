import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { PROJECT_ID } from "../../test/msw/fixtures";
import { useUploadAsset } from "./useAssets";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useUploadAsset", () => {
  it("上传成功后返回带预览地址的素材", async () => {
    const { result } = renderHook(() => useUploadAsset(), { wrapper });
    const asset = await result.current.mutateAsync({
      projectId: PROJECT_ID,
      file: new File(["img"], "truth.png", { type: "image/png" }),
      role: "PRODUCT_TRUTH",
    });
    expect(asset.role).toBe("PRODUCT_TRUTH");
    expect(asset.url).toContain("/files/assets/");
  });
});
