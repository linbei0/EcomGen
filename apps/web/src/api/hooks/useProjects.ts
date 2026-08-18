import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adaptProject, adaptProjectDetail, type CreateProjectInput, type UpdateProjectInput } from "../adapters/projectDetail";
import { api, unwrap } from "../client";
import { qk } from "../queryKeys";

export function useProjects() {
  return useQuery({
    queryKey: qk.projects,
    queryFn: async () => {
      const data = await unwrap(api.GET("/projects"));
      return {
        items: data.items.map(adaptProject).filter((item) => item !== null),
        nextCursor: data.nextCursor,
      };
    },
  });
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.project(projectId ?? ""),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const raw = await unwrap(
        api.GET("/projects/{projectId}", { params: { path: { projectId: projectId! } } }),
      );
      return adaptProjectDetail(raw);
    },
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectInput) => unwrap(api.POST("/projects", { body })),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: qk.projects });
      void queryClient.invalidateQueries({ queryKey: qk.project(project.id) });
    },
  });
}

export function useUpdateProject(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProjectInput) =>
      unwrap(api.PATCH("/projects/{projectId}", { params: { path: { projectId: projectId! } }, body })),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: qk.project(project.id) });
      void queryClient.invalidateQueries({ queryKey: qk.projects });
    },
  });
}
