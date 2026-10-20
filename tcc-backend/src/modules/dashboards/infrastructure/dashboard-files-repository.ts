import { and, eq, isNull } from "drizzle-orm";
import {
  dashboardProposalReceipts,
  dashboards,
} from "../../../shared/db/schema.js";
import type { DbExecutor } from "../../../shared/db/db-executor.js";

export interface DashboardFilesRepository {
  lockByDashboardId(
    tx: DbExecutor,
    dashboardId: string,
  ): Promise<typeof dashboards.$inferSelect | undefined>;
  lockReceipt(
    tx: DbExecutor,
    receiptId: string,
  ): Promise<typeof dashboardProposalReceipts.$inferSelect | undefined>;
  registerFile(
    tx: DbExecutor,
    dashboardId: string,
    storedPath: string,
  ): Promise<{ dashboardId: string }[]>;
  consumeReceipt(
    tx: DbExecutor,
    receiptId: string,
    consumedAt: Date,
  ): Promise<void>;
}

export class DrizzleDashboardFilesRepository implements DashboardFilesRepository {
  async lockByDashboardId(tx: DbExecutor, dashboardId: string) {
    return (
      await tx
        .select()
        .from(dashboards)
        .where(eq(dashboards.dashboardId, dashboardId))
        .for("update")
        .limit(1)
    )[0];
  }
  async lockReceipt(tx: DbExecutor, receiptId: string) {
    return (
      await tx
        .select()
        .from(dashboardProposalReceipts)
        .where(eq(dashboardProposalReceipts.id, receiptId))
        .for("update")
        .limit(1)
    )[0];
  }
  async registerFile(tx: DbExecutor, dashboardId: string, storedPath: string) {
    return tx
      .insert(dashboards)
      .values({ dashboardId, filePath: storedPath })
      .onConflictDoUpdate({
        target: dashboards.dashboardId,
        set: { filePath: storedPath },
        where: eq(dashboards.filePath, storedPath),
      })
      .returning({ dashboardId: dashboards.dashboardId });
  }
  async consumeReceipt(tx: DbExecutor, receiptId: string, consumedAt: Date) {
    await tx
      .update(dashboardProposalReceipts)
      .set({ consumedAt })
      .where(
        and(
          eq(dashboardProposalReceipts.id, receiptId),
          isNull(dashboardProposalReceipts.consumedAt),
        ),
      );
  }
}
