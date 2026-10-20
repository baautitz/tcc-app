import { db } from "../../../shared/db/client.js";
import { savedQueries } from "../../../shared/db/schema.js";

export interface DashboardSyncRepository {
  listQueryCatalog(): Promise<Array<{ id: string; parameters: unknown }>>;
}

export const drizzleDashboardSyncRepository: DashboardSyncRepository = {
  listQueryCatalog: () =>
    db
      .select({ id: savedQueries.id, parameters: savedQueries.parameters })
      .from(savedQueries),
};
