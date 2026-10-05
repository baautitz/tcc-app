import { db } from "../db/client.js";
import { savedQueries } from "../db/schema.js";

export interface DashboardSyncRepository {
  listQueryCatalog(): Promise<Array<{ id: string; parameters: unknown }>>;
}

export const drizzleDashboardSyncRepository: DashboardSyncRepository = {
  listQueryCatalog: () =>
    db.select({ id: savedQueries.id, parameters: savedQueries.parameters }).from(savedQueries),
};
