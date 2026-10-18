import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../../../shared/db/client.js";
import { dashboards } from "../../../shared/db/schema.js";

export type DashboardDbExecutor = Pick<typeof db, "select" | "insert" | "delete">;
export type DashboardRow = { dashboardId: string; filePath: string };

export interface DashboardsRepository {
  list(): Promise<DashboardRow[]>;
  deleteByPathExceptId(filePath: string, dashboardId: string): Promise<void>;
  upsert(row: DashboardRow): Promise<void>;
  insert(row: DashboardRow): Promise<void>;
  deleteByIds(ids: string[]): Promise<void>;
}

/** The executor may be a transaction; defaults to the global db. */
export function createDashboardsRepository(
  executor: DashboardDbExecutor = db,
): DashboardsRepository {
  return {
    list: () =>
      executor
        .select({ dashboardId: dashboards.dashboardId, filePath: dashboards.filePath })
        .from(dashboards),
    async deleteByPathExceptId(filePath, dashboardId) {
      await executor
        .delete(dashboards)
        .where(and(eq(dashboards.filePath, filePath), ne(dashboards.dashboardId, dashboardId)));
    },
    async upsert(row) {
      await executor
        .insert(dashboards)
        .values(row)
        .onConflictDoUpdate({ target: dashboards.dashboardId, set: { filePath: row.filePath } });
    },
    async insert(row) {
      await executor.insert(dashboards).values(row);
    },
    async deleteByIds(ids) {
      await executor.delete(dashboards).where(inArray(dashboards.dashboardId, ids));
    },
  };
}
