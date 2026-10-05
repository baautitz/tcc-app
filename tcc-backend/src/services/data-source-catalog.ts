import { DomainError } from "../lib/domain-error.js";
import type { DiscoveredTable } from "./external-postgres.js";

export const MAX_DATA_SOURCE_CATALOG_TABLES = 10_000;

export interface CatalogIdentity {
  id: string;
  schemaName: string;
  tableName: string;
}

export interface DataSourceCatalogTransaction {
  lockDataSource(dataSourceId: string): Promise<CatalogSourceSnapshot | undefined>;
  updateDataSource(dataSourceId: string, update: CatalogSourceUpdate): Promise<void>;
  listCatalogEntries(dataSourceId: string, limit: number): Promise<CatalogIdentity[]>;
  upsertCatalogEntries(
    dataSourceId: string,
    tables: DiscoveredTable[],
    discoveredAt: Date,
    resetContexts: boolean,
  ): Promise<void>;
  deleteCatalogEntries(dataSourceId: string, tableIds: string[]): Promise<void>;
}

export interface CatalogSourceUpdate {
  name: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  encryptedPassword: string;
  context: string;
  contextVersion?: number;
  updatedAt: Date;
}

export interface CatalogSourceSnapshot extends CatalogSourceUpdate {}

export class DataSourceCatalogSnapshotChangedError extends DomainError {
  constructor() {
    super("O servidor foi alterado durante a operação do catálogo.", "SNAPSHOT_CHANGED", "conflict");
    this.name = "DataSourceCatalogSnapshotChangedError";
  }
}

export interface DataSourceTarget {
  host: string;
  port: number;
  databaseName: string;
}

export function hasDataSourceTargetChanged(current: DataSourceTarget, next: DataSourceTarget): boolean {
  return current.host !== next.host
    || current.port !== next.port
    || current.databaseName !== next.databaseName;
}

function snapshotsMatch(left: CatalogSourceSnapshot, right: CatalogSourceSnapshot): boolean {
  return left.name === right.name
    && left.host === right.host
    && left.port === right.port
    && left.databaseName === right.databaseName
    && left.username === right.username
    && left.encryptedPassword === right.encryptedPassword
    && left.context === right.context
    && left.updatedAt.getTime() === right.updatedAt.getTime();
}

export interface DataSourceCatalogDatabase {
  transaction<T>(work: (tx: DataSourceCatalogTransaction) => Promise<T>): Promise<T>;
}

function identityKey(table: Pick<DiscoveredTable, "schemaName" | "tableName">): string {
  return `${table.schemaName}\u0000${table.tableName}`;
}

function validateSnapshot(tables: DiscoveredTable[]): void {
  if (tables.length > MAX_DATA_SOURCE_CATALOG_TABLES) {
    throw new Error(`O catálogo excede o limite de ${MAX_DATA_SOURCE_CATALOG_TABLES} tabelas.`);
  }
  const uniqueIdentities = new Set(tables.map(identityKey));
  if (uniqueIdentities.size !== tables.length) {
    throw new Error("O catálogo recebido contém tabelas duplicadas.");
  }
}

/**
 * Reconciles one bounded live snapshot in a single transaction. The store's
 * upsert operation updates only discovery metadata on identity conflicts,
 * preserving existing table context unless the logical source target changed.
 * A table rename is a new identity: the old row is removed and the new row
 * starts with an empty context. Source metadata can be updated in this same
 * transaction so the endpoint and its catalog never commit separately.
 */
export async function reconcileDataSourceCatalog(
  database: DataSourceCatalogDatabase,
  dataSourceId: string,
  tables: DiscoveredTable[],
  discoveredAt = new Date(),
  options: {
    sourceUpdate?: CatalogSourceUpdate;
    expectedSourceSnapshot?: CatalogSourceSnapshot;
    resetTableContexts?: boolean;
  } = {},
): Promise<{ upserted: number; removed: number }> {
  validateSnapshot(tables);
  const desiredIdentities = new Set(tables.map(identityKey));

  return database.transaction(async (tx) => {
    // Serialize refreshes for the same source before taking the existing snapshot.
    const currentSource = await tx.lockDataSource(dataSourceId);
    if (!currentSource) {
      throw new Error("Servidor PostgreSQL não encontrado para atualizar o catálogo.");
    }
    if (options.expectedSourceSnapshot && !snapshotsMatch(currentSource, options.expectedSourceSnapshot)) {
      throw new DataSourceCatalogSnapshotChangedError();
    }
    if (options.sourceUpdate) {
      await tx.updateDataSource(dataSourceId, options.sourceUpdate);
    }
    const existing = await tx.listCatalogEntries(
      dataSourceId,
      MAX_DATA_SOURCE_CATALOG_TABLES + 1,
    );
    if (existing.length > MAX_DATA_SOURCE_CATALOG_TABLES) {
      throw new Error(`O catálogo salvo excede o limite de ${MAX_DATA_SOURCE_CATALOG_TABLES} tabelas.`);
    }

    const staleIds = existing
      .filter((table) => !desiredIdentities.has(identityKey(table)))
      .map((table) => table.id);

    if (tables.length > 0) {
      await tx.upsertCatalogEntries(dataSourceId, tables, discoveredAt, options.resetTableContexts ?? false);
    }
    if (staleIds.length > 0) {
      await tx.deleteCatalogEntries(dataSourceId, staleIds);
    }

    return { upserted: tables.length, removed: staleIds.length };
  });
}
