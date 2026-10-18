import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../../../shared/db/client.js";
import { dataSources, queryTestRuns, savedQueries } from "../../../shared/db/schema.js";
import { ApiError } from "../../../shared/lib/domain-error.js";
import type { QueryLifecycleRepository, QueryLifecycleTransaction, QuerySaveMode } from "../domain/query-lifecycle.js";

export function createQueryLifecycleRepository(): QueryLifecycleRepository {
  return {
    transaction<T>(operation: (tx: QueryLifecycleTransaction) => Promise<T>) {
      return db.transaction(async (tx) => operation({
        async lockSource(dataSourceId) {
          return (await tx.select().from(dataSources)
            .where(eq(dataSources.id, dataSourceId))
            .for("update")
            .limit(1))[0];
        },
        async lockQuery(queryId) {
          return (await tx.select().from(savedQueries)
            .where(eq(savedQueries.id, queryId))
            .for("update")
            .limit(1))[0];
        },
        async insertReceipt(receipt) {
          await tx.execute(sql`DELETE FROM query_test_runs
            WHERE id IN (
              SELECT id FROM query_test_runs
              WHERE expires_at <= now()
                OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '1 day')
              ORDER BY expires_at ASC
              LIMIT 500
            )`);
          const inserted = (await tx.insert(queryTestRuns).values(receipt).returning())[0];
          if (!inserted) throw new ApiError(500, "Não foi possível registrar a prévia.");
          return { ...inserted, mode: inserted.mode as QuerySaveMode };
        },
        async consumeReceipt(receiptId, actorId, now) {
          const consumed = (await tx.update(queryTestRuns)
            .set({ consumedAt: now })
            .where(and(
              eq(queryTestRuns.id, receiptId),
              eq(queryTestRuns.actorId, actorId),
              isNull(queryTestRuns.consumedAt),
              gt(queryTestRuns.expiresAt, now),
            ))
            .returning())[0];
          return consumed ? { ...consumed, mode: consumed.mode as QuerySaveMode } : undefined;
        },
        async insertQuery(query) {
          const inserted = (await tx.insert(savedQueries).values(query).returning())[0];
          if (!inserted) throw new ApiError(500, "Não foi possível criar a query.");
          return inserted;
        },
        async updateQuery(queryId, update) {
          return (await tx.update(savedQueries)
            .set(update)
            .where(eq(savedQueries.id, queryId))
            .returning())[0];
        },
      }));
    },
  };
}
