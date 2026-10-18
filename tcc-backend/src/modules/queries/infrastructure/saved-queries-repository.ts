import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../../../shared/db/client.js";
import { dashboardProposalReceipts, dataSources, savedQueries } from "../../../shared/db/schema.js";
import type { DbExecutor } from "../../../shared/db/db-executor.js";

export const savedQueriesRepository = {
  async listSummaries() {
    return db.select({
      id: savedQueries.id,
      dataSourceId: savedQueries.dataSourceId,
      name: savedQueries.name,
      parameters: savedQueries.parameters,
      createdAt: savedQueries.createdAt,
      updatedAt: savedQueries.updatedAt,
    }).from(savedQueries).orderBy(asc(savedQueries.name));
  },
  async findById(queryId: string) {
    return (await db.select().from(savedQueries).where(eq(savedQueries.id, queryId)).limit(1))[0];
  },
  async listAllIds() {
    return db.select({ id: savedQueries.id }).from(savedQueries);
  },
  async listParametersByIds(ids: string[]) {
    return db.select({ id: savedQueries.id, parameters: savedQueries.parameters }).from(savedQueries).where(inArray(savedQueries.id, ids));
  },
  async listWithSourcesByIds(ids: string[], tx?: DbExecutor) {
    const query = (tx ?? db).select({ query: savedQueries, source: dataSources })
      .from(savedQueries)
      .innerJoin(dataSources, eq(savedQueries.dataSourceId, dataSources.id))
      .where(inArray(savedQueries.id, ids));
    return tx ? query.for("update") : query;
  },
  async lockNameById(tx: DbExecutor, queryId: string) {
    return (await tx.select({ id: savedQueries.id, name: savedQueries.name })
      .from(savedQueries).where(eq(savedQueries.id, queryId)).for("update").limit(1))[0];
  },
  async deleteById(tx: DbExecutor, queryId: string) {
    return tx.delete(savedQueries).where(eq(savedQueries.id, queryId)).returning({ id: savedQueries.id });
  },
  async findReceipt(receiptId: string) {
    return (await db.select().from(dashboardProposalReceipts)
      .where(eq(dashboardProposalReceipts.id, receiptId)).limit(1))[0];
  },
};
