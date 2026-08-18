import { useQuery } from "@tanstack/react-query";

import { adaptTemplates } from "../adapters/templates";
import { api, unwrap } from "../client";
import { qk } from "../queryKeys";

export function useTemplates() {
  return useQuery({
    queryKey: qk.templates,
    queryFn: async () => adaptTemplates(await unwrap(api.GET("/ecom-templates"))),
    staleTime: 5 * 60_000,
  });
}
