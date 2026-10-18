import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../../shared/db/client.js";
import { dataSources, dataSourceTables, savedQueries } from "../../../shared/db/schema.js";
import { ApiError } from "../../../shared/lib/domain-error.js";
import type { reconcileDataSourceCatalog } from "../domain/data-source-catalog.js";
import type { updateTableContextIfSourceVersionMatches } from "../domain/data-source-context.js";

type CatalogDeps = Parameters<typeof reconcileDataSourceCatalog>[0];
type ContextDeps = Parameters<typeof updateTableContextIfSourceVersionMatches>[0];

export const dataSourcesRepository = {
  async listAll() {
    return db.select().from(dataSources).orderBy(asc(dataSources.name));
  },
  async findById(sourceId: string) {
    return (await db.select().from(dataSources).where(eq(dataSources.id, sourceId)).limit(1))[0];
  },
  async listTables(sourceId: string, limit: number) {
    return db.select().from(dataSourceTables)
      .where(eq(dataSourceTables.dataSourceId, sourceId))
      .orderBy(asc(dataSourceTables.schemaName), asc(dataSourceTables.tableName))
      .limit(limit);
  },
  async tableExists(sourceId: string, tableId: string) {
    return (await db.select({ id: dataSourceTables.id }).from(dataSourceTables).where(and(
      eq(dataSourceTables.id, tableId),
      eq(dataSourceTables.dataSourceId, sourceId),
    )).limit(1)).length > 0;
  },
  async insert(values: typeof dataSources.$inferInsert) {
    return (await db.insert(dataSources).values(values).returning())[0];
  },
  async deleteWithQueries(sourceId: string) {
    return db.transaction(async (tx) => {
      await tx.delete(savedQueries).where(eq(savedQueries.dataSourceId, sourceId));
      return tx.delete(dataSources).where(eq(dataSources.id, sourceId)).returning({ id: dataSources.id });
    });
  },
  /** Adapter consumed by reconcileDataSourceCatalog. */
  catalogTransaction: ((work) => db.transaction(async (tx) => work({
    async lockDataSource(dataSourceId) {
      const row = (await tx.select({
        name: dataSources.name,
        host: dataSources.host,
        port: dataSources.port,
        databaseName: dataSources.databaseName,
        username: dataSources.username,
        encryptedPassword: dataSources.encryptedPassword,
        context: dataSources.context,
        updatedAt: dataSources.updatedAt,
      })
        .from(dataSources)
        .where(eq(dataSources.id, dataSourceId))
        .for("update")
        .limit(1))[0];
      if (!row) throw new ApiError(404, "Servidor PostgreSQL não encontrado para atualizar o catálogo.");
      return row;
    },
    async updateDataSource(dataSourceId, update) {
      const row = (await tx.update(dataSources)
        .set(update)
        .where(eq(dataSources.id, dataSourceId))
        .returning({ id: dataSources.id }))[0];
      if (!row) throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
    },
    listCatalogEntries(dataSourceId, limit) {
      return tx.select({
        id: dataSourceTables.id,
        schemaName: dataSourceTables.schemaName,
        tableName: dataSourceTables.tableName,
      }).from(dataSourceTables)
        .where(eq(dataSourceTables.dataSourceId, dataSourceId))
        .limit(limit);
    },
    async upsertCatalogEntries(dataSourceId, discoveredTables, discoveredAt, resetContexts) {
      await tx.insert(dataSourceTables).values(discoveredTables.map((table) => ({
        dataSourceId,
        ...table,
        discoveredAt,
      }))).onConflictDoUpdate({
        target: [dataSourceTables.dataSourceId, dataSourceTables.schemaName, dataSourceTables.tableName],
        // Keep human-authored table context on unchanged identities.
        set: resetContexts ? {
          discoveredAt,
          context: "",
          contextVersion: sql`${dataSourceTables.contextVersion} + 1`,
        } : { discoveredAt },
      });
    },
    async deleteCatalogEntries(dataSourceId, tableIds) {
      await tx.delete(dataSourceTables).where(and(
        eq(dataSourceTables.dataSourceId, dataSourceId),
        inArray(dataSourceTables.id, tableIds),
      ));
    },
  }))) as CatalogDeps["transaction"],
  contextTransaction: ((work) => db.transaction((tx) => work({
    async lockSourceUpdatedAt(dataSourceId) {
      const row = (await tx.select({ updatedAt: dataSources.updatedAt })
        .from(dataSources)
        .where(eq(dataSources.id, dataSourceId))
        .for("update")
        .limit(1))[0];
      return row?.updatedAt;
    },
    async updateTableContext(dataSourceId, targetTableId, tableContext, expectedContextVersion) {
      return (await tx.update(dataSourceTables)
        .set({ context: tableContext, contextVersion: sql`${dataSourceTables.contextVersion} + 1` })
        .where(and(
          eq(dataSourceTables.id, targetTableId),
          eq(dataSourceTables.dataSourceId, dataSourceId),
          eq(dataSourceTables.contextVersion, expectedContextVersion),
        ))
        .returning())[0];
    },
  }))) as ContextDeps["transaction"],
};
