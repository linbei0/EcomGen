/** 统一 query key 工厂，SSE 事件失效映射也以此为准。 */
export const qk = {
  health: ["health"] as const,
  templates: ["ecom-templates"] as const,
  providers: ["providers"] as const,
  searchSources: ["search-sources"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  storyboard: (id: string) => ["projects", id, "storyboard"] as const,
  job: (id: string) => ["jobs", id] as const,
  editTurn: (id: string) => ["edit-turns", id] as const,
  export: (id: string) => ["exports", id] as const,
  exports: (id: string) => ["projects", id, "exports"] as const,
};
