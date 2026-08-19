import { useMutation, useQueryClient } from "@tanstack/react-query";

import { adaptAsset, type UserAssetKind } from "../adapters/projectDetail";
import { api, unwrap } from "../client";
import { ApiError } from "../errors";
import { qk } from "../queryKeys";
import { serializeAssetForm } from "../serializeAssetForm";

export interface UploadAssetInput {
  projectId: string;
  file: File;
  kind: UserAssetKind;
}

export function useUploadAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, file, kind }: UploadAssetInput) => {
      const raw = await unwrap(
        api.POST("/projects/{projectId}/assets", {
          params: { path: { projectId } },
          body: {
            file: file as unknown as string,
            kind,
          },
          bodySerializer(body) {
            return serializeAssetForm({ file, kind: body.kind ?? kind });
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

export function useDeleteAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId }: { assetId: string; projectId: string }) => {
      await api.DELETE("/assets/{assetId}", { params: { path: { assetId } } });
    },
    onSuccess: (_result, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}
