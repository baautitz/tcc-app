

import type { dataSources, dataSourceTables } from "../shared/db/schema.js";
import { dataSourcesRepository } from "../repositories/data-sources-repository.js";

import { inspectReadOnlyPostgres } from "./external-postgres.js";

import { DataSourceCatalogSnapshotChangedError, reconcileDataSourceCatalog, type CatalogSourceSnapshot, type CatalogSourceUpdate } from "./data-source-catalog.js";
import { DataSourceContextSourceNotFoundError, DataSourceContextVersionConflictError, DataSourceTableContextVersionConflictError, updateTableContextIfSourceVersionMatches } from "./data-source-context.js";

import { ApiError } from "../shared/lib/domain-error.js";

export function catalogSourceSnapshot(source: typeof dataSources.$inferSelect): CatalogSourceSnapshot {
  return {
    name: source.name,
    host: source.host,
    port: source.port,
    databaseName: source.databaseName,
    username: source.username,
    encryptedPassword: source.encryptedPassword,
    context: source.context,
    updatedAt: source.updatedAt,
  };
}

export function safeSource(source: typeof dataSources.$inferSelect) {
  const { encryptedPassword: _encryptedPassword, ...safe } = source;
  return safe;
}
export async function getSourceOrThrow(sourceId: string) {
  const source = await dataSourcesRepository.findById(sourceId);
  if (!source) throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
  return source;
}
export async function catalogSourceTables(
  sourceId: string,
  tables: Awaited<ReturnType<typeof inspectReadOnlyPostgres>>,
  options: {
    sourceUpdate?: CatalogSourceUpdate;
    expectedSourceSnapshot?: CatalogSourceSnapshot;
    resetTableContexts?: boolean;
  } = {},
): Promise<void> {
  try {
    await reconcileDataSourceCatalog({
      transaction: dataSourcesRepository.catalogTransaction,
    }, sourceId, tables, new Date(), options);
  } catch (error) {
    if (error instanceof DataSourceCatalogSnapshotChangedError) {
      throw new ApiError(409, "O servidor foi alterado durante a operação. Tente atualizar o catálogo novamente.");
    }
    throw error;
  }
}
export async function updateCatalogTableContext(sourceId: string, tableId: string, input: { context: string; expectedSourceUpdatedAt: string; expectedContextVersion: number }) {
  let table: typeof dataSourceTables.$inferSelect | undefined;
  try {
    table = await updateTableContextIfSourceVersionMatches<typeof dataSourceTables.$inferSelect>({
      transaction: dataSourcesRepository.contextTransaction,
    }, sourceId, tableId, input.context, input.expectedSourceUpdatedAt, input.expectedContextVersion);
  } catch (error) {
    if (error instanceof DataSourceContextVersionConflictError) {
      throw new ApiError(409, "O servidor foi alterado. Recarregue os dados antes de salvar o contexto.");
    }
    if (error instanceof DataSourceContextSourceNotFoundError) {
      throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
    }
    if (error instanceof DataSourceTableContextVersionConflictError) {
      const tableExists = await dataSourcesRepository.tableExists(sourceId, tableId);
      if (!tableExists) throw new ApiError(404, "Tabela catalogada não encontrada.");
      throw new ApiError(409, error.message);
    }
    throw error;
  }
  if (!table) throw new ApiError(404, "Tabela catalogada não encontrada.");
  return table;
}

