import { aiApi } from "@/modules/ai/api/ai.api";
import { dashboardsApi } from "@/modules/dashboards/api/dashboards.api";
import { dataSourcesApi } from "@/modules/data-sources/api/data-sources.api";
import { identityApi } from "@/modules/identity/api/identity.api";
import { queriesApi } from "@/modules/queries/api/queries.api";

// barrel temporario: consumidores migram por modulo
export const api = {
  ...identityApi,
  ...dashboardsApi,
  ...queriesApi,
  ...dataSourcesApi,
  ...aiApi,
};
