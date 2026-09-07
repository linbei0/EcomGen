import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { adaptTemplates } from "../adapters/templates";
import { api, unwrap } from "../client";
import { qk } from "../queryKeys";
import { useUserTemplates } from "./useUserTemplates";

export function useTemplates() {
  return useQuery({
    queryKey: qk.templates,
    queryFn: async () => adaptTemplates(await unwrap(api.GET("/ecom-templates"))),
    staleTime: 5 * 60_000,
  });
}

/** 分镜/结果链路的模板名解析：合并内置与自定义模板；自定义模板仅手动选择，但名称需全链路可读。 */
export function useTemplateNames() {
  const templates = useTemplates();
  const userTemplates = useUserTemplates();
  return useMemo(
    () => [
      ...(templates.data ?? []).map((template) => ({ id: template.id, name: template.name })),
      ...(userTemplates.data ?? []).map((template) => ({ id: template.id, name: template.name })),
    ],
    [templates.data, userTemplates.data],
  );
}
