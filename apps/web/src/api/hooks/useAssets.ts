import { useMutation, useQueryClient } from "@tanstack/react-query";

import { adaptAsset, type AssetRole } from "../adapters/projectDetail";
import { api, unwrap } from "../client";
import { ApiError } from "../errors";
import { qk } from "../queryKeys";
import { serializeAssetForm } from "../serializeAssetForm";

export interface UploadAssetInput {
  projectId: string;
  file: File;
  role: AssetRole;
  variantId?: string | null;
}

export function useUploadAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, file, role, variantId }: UploadAssetInput) => {
      const raw = await unwrap(
        api.POST("/projects/{projectId}/assets", {
          params: { path: { projectId } },
          body: {
            file: file as unknown as string,
            role,
            variantId: variantId ?? null,
          },
          bodySerializer(body) {
            return serializeAssetForm({ file, role: body.role, variantId: body.variantId });
          },
        }),
      );
      const asset = adaptAsset(raw);
      if (!asset) {
        throw new ApiError({ code: "UNKNOWN", message: "上传响应无法解析", status: 0 });
      }
      return asset;
    },
    onSuccess: (_asset, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}
