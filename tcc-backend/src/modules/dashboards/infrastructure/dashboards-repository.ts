import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../../../shared/db/client.js";
import { dashboards } from "../../../shared/db/schema.js";

export type DashboardDbExecutor = Pick<
  typeof db,
  "select" | "insert" | "delete"
>;
export type DashboardRow = { dashboardId: string; filePath: string };

export interface DashboardsRepository {
  list(): Promise<DashboardRow[]>;
  deleteByPathExceptId(filePath: string, dashboardId: string): Promise<void>;
  upsert(row: DashboardRow): Promise<void>;
  insert(row: DashboardRow): Promise<void>;
  deleteByIds(ids: string[]): Promise<void>;
}

/** The executor may be a transaction; defaults to the global db. */
export class DrizzleDashboardsRepository implements DashboardsRepository {
  constructor(private readonly executor: DashboardDbExecutor = db) {}

  list() {
    return this.executor
      .select({
        dashboardId: dashboards.dashboardId,
        filePath: dashboards.filePath,
      })
      .from(dashboards);
  }
  async deleteByPathExceptId(filePath: string, dashboardId: string) {
    await this.executor
      .delete(dashboards)
      .where(
        and(
          eq(dashboards.filePath, filePath),
          ne(dashboards.dashboardId, dashboardId),
        ),
      );
  }
  async upsert(row: DashboardRow) {
    await this.executor
      .insert(dashboards)
      .values(row)
      .onConflictDoUpdate({
        target: dashboards.dashboardId,
        set: { filePath: row.filePath },
      });
  }
  async insert(row: DashboardRow) {
    await this.executor.insert(dashboards).values(row);
  }
  async deleteByIds(ids: string[]) {
    await this.executor
      .delete(dashboards)
      .where(inArray(dashboards.dashboardId, ids));
  }
}
