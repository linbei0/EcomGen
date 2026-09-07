import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "../client";
import { qk } from "../queryKeys";
import type { components } from "../schema.d.ts";

export type UserTemplate = components["schemas"]["UserTemplateItem"];
export type CreateUserTemplateInput = components["schemas"]["CreateUserTemplateInput"];
export type UpdateUserTemplateInput = components["schemas"]["UpdateUserTemplateInput"];

export function useUserTemplates() {
  return useQuery({
    queryKey: qk.userTemplates,
    queryFn: async () => (await unwrap(api.GET("/user-templates"))).items,
    staleTime: 30_000,
  });
}

export function useCreateUserTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserTemplateInput) => unwrap(api.POST("/user-templates", { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.userTemplates }),
  });
}

export function useUpdateUserTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, body }: { templateId: string; body: UpdateUserTemplateInput }) =>
      unwrap(api.PATCH("/user-templates/{templateId}", { params: { path: { templateId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.userTemplates }),
  });
}

export function useDeleteUserTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      await api.DELETE("/user-templates/{templateId}", { params: { path: { templateId } } });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.userTemplates }),
  });
}
