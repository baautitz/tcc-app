import type { ExternalSourcePort } from "../../data-sources/domain/external-source.js";
import { and, asc, count, eq } from "drizzle-orm";
import { db } from "../../../shared/db/client.js";
import { dataSourceTables, dataSources, savedQueries } from "../../../shared/db/schema.js";
import { externalSource } from "../../data-sources/application/external-source.js";
import type { AiReadSource, AiReadTable, AiReadTableName } from "../application/tools/ai-read-tools.js";
import { MAX_DATA_SOURCE_CATALOG_TABLES } from "../../data-sources/domain/data-source-catalog.js";
import { issueQueryTestReceipt, querySourceTargetHash } from "../../queries/domain/query-lifecycle.js";
import { savedQueriesPort } from "../../queries/application/saved-queries.js";

function aiReadSource(source: typeof dataSources.$inferSelect): AiReadSource {
  return {
    id: source.id,
    name: source.name,
    databaseName: source.databaseName,
    context: source.context,
    connection: externalSource().sourceConnection(source),
  };
}


function aiReadTable(table: typeof dataSourceTables.$inferSelect): AiReadTable {
  return {
    id: table.id,
    dataSourceId: table.dataSourceId,
    schemaName: table.schemaName,
    tableName: table.tableName,
    context: table.context,
  };
}

function aiReadTableName(table: Pick<typeof dataSourceTables.$inferSelect, "id" | "dataSourceId" | "schemaName" | "tableName">): AiReadTableName {
  return {
    id: table.id,
    dataSourceId: table.dataSourceId,
    schemaName: table.schemaName,
    tableName: table.tableName,
  };
}

export function createAiReadToolsRepository() {
  return {
    async listSources(offset: number, limit: number) {
      const [sources, countResult] = await Promise.all([
        db.select({ id: dataSources.id, name: dataSources.name })
          .from(dataSources)
          .orderBy(asc(dataSources.name))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(dataSources),
      ]);
      return { sources, total: Number(countResult[0]?.total ?? 0) };
    },
    async findSource(dataSourceId: string) {
      const source = (await db.select().from(dataSources).where(eq(dataSources.id, dataSourceId)).limit(1))[0];
      return source ? aiReadSource(source) : undefined;
    },
    async findSourceVersion(dataSourceId: string) {
      const source = (await db.select().from(dataSources).where(eq(dataSources.id, dataSourceId)).limit(1))[0];
      return source ? { updatedAt: source.updatedAt, targetHash: querySourceTargetHash(source) } : undefined;
    },
    async findQueryTarget(queryId: string) {
      const query = (await db.select({
        id: savedQueries.id,
        dataSourceId: savedQueries.dataSourceId,
        name: savedQueries.name,
        updatedAt: savedQueries.updatedAt,
      }).from(savedQueries).where(eq(savedQueries.id, queryId)).limit(1))[0];
      return query;
    },
    createTestReceipt(input: Parameters<typeof issueQueryTestReceipt>[1]) {
      return issueQueryTestReceipt(savedQueriesPort().createLifecycleRepository(), input);
    },
    async listCatalogTables(dataSourceId: string) {
      const tables = await db.select({
        id: dataSourceTables.id,
        dataSourceId: dataSourceTables.dataSourceId,
        schemaName: dataSourceTables.schemaName,
        tableName: dataSourceTables.tableName,
      }).from(dataSourceTables)
        .where(eq(dataSourceTables.dataSourceId, dataSourceId))
        .orderBy(asc(dataSourceTables.schemaName), asc(dataSourceTables.tableName))
        .limit(MAX_DATA_SOURCE_CATALOG_TABLES + 1);
      if (tables.length > MAX_DATA_SOURCE_CATALOG_TABLES) {
        throw new Error(`O catálogo salvo excede o limite de ${MAX_DATA_SOURCE_CATALOG_TABLES} tabelas.`);
      }
      return tables.map(aiReadTableName);
    },
    async findCatalogTable(dataSourceId: string, tableId: string) {
      const table = (await db.select().from(dataSourceTables)
        .where(and(eq(dataSourceTables.dataSourceId, dataSourceId), eq(dataSourceTables.id, tableId)))
        .limit(1))[0];
      return table ? aiReadTable(table) : undefined;
    },
    listLiveBaseTables: (...a: Parameters<ExternalSourcePort["listPostgresBaseTables"]>) => externalSource().listPostgresBaseTables(...a),
    findUnsafeColumnTypes: (...a: Parameters<ExternalSourcePort["findUnsafeAiColumnTypes"]>) => externalSource().findUnsafeAiColumnTypes(...a),
    getLiveColumns: (...a: Parameters<ExternalSourcePort["getPostgresTableColumns"]>) => externalSource().getPostgresTableColumns(...a),
  };
}
