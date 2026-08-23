import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { adaptProject, adaptProjectDetail, type CreateProjectInput, type Project, type UpdateProjectInput } from "../adapters/projectDetail";
import { api, unwrap } from "../client";
import { qk } from "../queryKeys";

export function useProjects(options: { archived?: boolean } = {}) {
  const archived = options.archived ?? false;
  return useQuery({
    queryKey: qk.projects(archived),
    queryFn: async () => {
      const data = await unwrap(api.GET("/projects", { params: { query: { archived } } }));
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
    // SSE 是即时通知，但连接建立或重连期间可能错过事件；生成中时轮询确保状态最终收敛。
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      return jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING") ? 2000 : false;
    },
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectInput) => unwrap(api.POST("/projects", { body })),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: qk.projects() });
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
      void queryClient.invalidateQueries({ queryKey: qk.projects() });
    },
  });
}

export function useArchiveProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, archived }: { projectId: string; archived: boolean }) =>
      unwrap(api.PATCH("/projects/{projectId}", { params: { path: { projectId } }, body: { archived } })),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: qk.project(project.id) });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      await api.DELETE("/projects/{projectId}", { params: { path: { projectId } } });
    },
    onSuccess: (_, projectId) => {
      queryClient.setQueryData<{ items: Project[]; nextCursor: string | null }>(qk.projects(true), (current) =>
        current ? { ...current, items: current.items.filter((project) => project.id !== projectId) } : current,
      );
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.removeQueries({ queryKey: qk.project(projectId) });
    },
  });
}
