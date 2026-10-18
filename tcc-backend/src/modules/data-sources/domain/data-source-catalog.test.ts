import { describe, expect, it } from "vitest";
import {
  MAX_DATA_SOURCE_CATALOG_TABLES,
  DataSourceCatalogSnapshotChangedError,
  hasDataSourceTargetChanged,
  reconcileDataSourceCatalog,
  type CatalogIdentity,
  type DataSourceCatalogDatabase,
  type CatalogSourceSnapshot,
  type DataSourceCatalogTransaction,
} from "./data-source-catalog.js";
import type { DiscoveredTable } from "../infrastructure/external-pg/index.js";

interface CatalogRow extends CatalogIdentity {
  dataSourceId: string;
  context: string;
  discoveredAt: Date;
}

class FakeCatalogDatabase implements DataSourceCatalogDatabase {
  rows: CatalogRow[];
  currentSourceSnapshot: CatalogSourceSnapshot | undefined;
  sourceUpdates: Array<{ dataSourceId: string; update: unknown }> = [];
  transactionCount = 0;
  lockCount = 0;
  failUpsert = false;

  constructor(rows: CatalogRow[], sourceSnapshot?: CatalogSourceSnapshot) {
    this.rows = rows;
    this.currentSourceSnapshot = sourceSnapshot ?? {
      name: "Analytics",
      host: "db.internal",
      port: 5432,
      databaseName: "analytics",
      username: "readonly",
      encryptedPassword: "encrypted-v1",
      context: "Analytics context",
      updatedAt: new Date(0),
    };
  }

  async transaction<T>(work: (tx: DataSourceCatalogTransaction) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    const workingRows = this.rows.map((row) => ({ ...row }));
    const workingSourceUpdates = [...this.sourceUpdates];
    let workingSourceSnapshot = this.currentSourceSnapshot ? { ...this.currentSourceSnapshot } : undefined;
    let nextId = 1;
    const tx: DataSourceCatalogTransaction = {
      lockDataSource: async () => {
        this.lockCount += 1;
        return workingSourceSnapshot ? { ...workingSourceSnapshot } : undefined;
      },
      updateDataSource: async (dataSourceId, update) => {
        workingSourceUpdates.push({ dataSourceId, update });
        workingSourceSnapshot = { ...update };
      },
      listCatalogEntries: async (dataSourceId, limit) => workingRows
        .filter((row) => row.dataSourceId === dataSourceId)
        .slice(0, limit)
        .map(({ id, schemaName, tableName }) => ({ id, schemaName, tableName })),
      upsertCatalogEntries: async (dataSourceId, tables, discoveredAt, resetContexts) => {
        if (this.failUpsert) throw new Error("simulated failure");
        for (const table of tables) {
          const existing = workingRows.find((row) => row.dataSourceId === dataSourceId
            && row.schemaName === table.schemaName
            && row.tableName === table.tableName);
          if (existing) {
            existing.discoveredAt = discoveredAt;
            if (resetContexts) existing.context = "";
          } else {
            workingRows.push({
              id: `new-${nextId++}`,
              dataSourceId,
              schemaName: table.schemaName,
              tableName: table.tableName,
              context: "",
              discoveredAt,
            });
          }
        }
      },
      deleteCatalogEntries: async (dataSourceId, tableIds) => {
        const removeIds = new Set(tableIds);
        for (let index = workingRows.length - 1; index >= 0; index -= 1) {
          const row = workingRows[index];
          if (row?.dataSourceId === dataSourceId && removeIds.has(row.id)) workingRows.splice(index, 1);
        }
      },
    };
    const result = await work(tx);
    this.rows = workingRows;
    this.sourceUpdates = workingSourceUpdates;
    this.currentSourceSnapshot = workingSourceSnapshot;
    return result;
  }
}

const sourceId = "source-a";
const otherSourceId = "source-b";
const discoveredAt = new Date("2026-09-28T12:00:00.000Z");

describe("reconciliação do catálogo de servidor", () => {
  it("considera host, porta e banco como identidade semântica do servidor", () => {
    const current = { host: "db.internal", port: 5432, databaseName: "analytics" };
    expect(hasDataSourceTargetChanged(current, { ...current })).toBe(false);
    expect(hasDataSourceTargetChanged(current, { ...current, host: "db-v2.internal" })).toBe(true);
    expect(hasDataSourceTargetChanged(current, { ...current, port: 5433 })).toBe(true);
    expect(hasDataSourceTargetChanged(current, { ...current, databaseName: "analytics_v2" })).toBe(true);
  });

  it("remove tabelas apagadas e renomeadas, cria a nova identidade e preserva contextos inalterados", async () => {
    const rows: CatalogRow[] = [
      { id: "stable-id", dataSourceId: sourceId, schemaName: "public", tableName: "orders", context: "Keep this context", discoveredAt: new Date(0) },
      { id: "renamed-old-id", dataSourceId: sourceId, schemaName: "public", tableName: "legacy_orders", context: "Do not attach to renamed table", discoveredAt: new Date(0) },
      { id: "deleted-id", dataSourceId: sourceId, schemaName: "public", tableName: "obsolete", context: "Deleted table context", discoveredAt: new Date(0) },
      { id: "other-source-id", dataSourceId: otherSourceId, schemaName: "public", tableName: "untouched", context: "Other source", discoveredAt: new Date(0) },
    ];
    const database = new FakeCatalogDatabase(rows);
    const snapshot: DiscoveredTable[] = [
      { schemaName: "public", tableName: "orders" },
      { schemaName: "public", tableName: "orders_renamed" },
    ];

    const result = await reconcileDataSourceCatalog(database, sourceId, snapshot, discoveredAt);

    expect(result).toEqual({ upserted: 2, removed: 2 });
    expect(database.transactionCount).toBe(1);
    expect(database.rows).toHaveLength(3);
    expect(database.rows.find(({ id }) => id === "stable-id")).toMatchObject({
      context: "Keep this context",
      discoveredAt,
    });
    expect(database.rows.find(({ tableName }) => tableName === "orders_renamed")).toMatchObject({
      context: "",
      schemaName: "public",
    });
    expect(database.rows.some(({ id }) => id === "renamed-old-id" || id === "deleted-id")).toBe(false);
    expect(database.rows.find(({ id }) => id === "other-source-id")).toBeDefined();
  });

  it("reconcilia uma descoberta vazia removendo todas as tabelas daquele servidor", async () => {
    const database = new FakeCatalogDatabase([
      { id: "one", dataSourceId: sourceId, schemaName: "public", tableName: "one", context: "one", discoveredAt },
      { id: "two", dataSourceId: sourceId, schemaName: "sales", tableName: "two", context: "two", discoveredAt },
    ]);

    await reconcileDataSourceCatalog(database, sourceId, [], discoveredAt);

    expect(database.rows).toEqual([]);
  });

  it("grava a troca de destino e invalida contextos antigos na mesma transação", async () => {
    const database = new FakeCatalogDatabase([
      { id: "same-name", dataSourceId: sourceId, schemaName: "public", tableName: "orders", context: "Context of old database", discoveredAt: new Date(0) },
    ]);
    const sourceUpdate = {
      name: "Analytics",
      host: "new-host.internal",
      port: 5433,
      databaseName: "analytics_v2",
      username: "readonly_v2",
      encryptedPassword: "encrypted-value",
      context: "New database context",
      updatedAt: discoveredAt,
    };

    await reconcileDataSourceCatalog(
      database,
      sourceId,
      [{ schemaName: "public", tableName: "orders" }],
      discoveredAt,
      { sourceUpdate, resetTableContexts: true },
    );

    expect(database.transactionCount).toBe(1);
    expect(database.sourceUpdates).toEqual([{ dataSourceId: sourceId, update: sourceUpdate }]);
    expect(database.rows[0]).toMatchObject({ id: "same-name", context: "", discoveredAt });
  });

  it("descarta snapshot de refresh quando target ou versão mudou antes de adquirir o lock", async () => {
    const oldSnapshot: CatalogSourceSnapshot = {
      name: "Analytics",
      host: "db.internal",
      port: 5432,
      databaseName: "analytics",
      username: "readonly",
      encryptedPassword: "encrypted-v1",
      context: "Analytics context",
      updatedAt: new Date(0),
    };
    const changedSnapshots = [
      { ...oldSnapshot, host: "db-v2.internal", updatedAt: discoveredAt },
      { ...oldSnapshot, updatedAt: discoveredAt },
    ];

    for (const changedSnapshot of changedSnapshots) {
      const initialRows: CatalogRow[] = [
        { id: "current-table", dataSourceId: sourceId, schemaName: "public", tableName: "orders", context: "Keep", discoveredAt: new Date(0) },
      ];
      const database = new FakeCatalogDatabase(initialRows, changedSnapshot);

      await expect(reconcileDataSourceCatalog(
        database,
        sourceId,
        [{ schemaName: "public", tableName: "old-snapshot-table" }],
        discoveredAt,
        { expectedSourceSnapshot: oldSnapshot },
      )).rejects.toBeInstanceOf(DataSourceCatalogSnapshotChangedError);

      expect(database.lockCount).toBe(1);
      expect(database.rows).toEqual(initialRows);
      expect(database.sourceUpdates).toEqual([]);
    }
  });

  it("limita o snapshot e a leitura do catálogo existente a 10 mil sem mutação parcial", async () => {
    const tooManyNewTables = Array.from({ length: MAX_DATA_SOURCE_CATALOG_TABLES + 1 }, (_, index) => ({
      schemaName: "public",
      tableName: `table_${index}`,
    }));
    const emptyDatabase = new FakeCatalogDatabase([]);
    await expect(reconcileDataSourceCatalog(emptyDatabase, sourceId, tooManyNewTables))
      .rejects.toThrow("O catálogo excede o limite de 10000 tabelas.");
    expect(emptyDatabase.transactionCount).toBe(0);

    const oversizedExisting = Array.from({ length: MAX_DATA_SOURCE_CATALOG_TABLES + 1 }, (_, index) => ({
      id: `existing-${index}`,
      dataSourceId: sourceId,
      schemaName: "public",
      tableName: `table_${index}`,
      context: "unchanged",
      discoveredAt,
    }));
    const databaseWithLegacyCatalog = new FakeCatalogDatabase(oversizedExisting);
    await expect(reconcileDataSourceCatalog(databaseWithLegacyCatalog, sourceId, []))
      .rejects.toThrow("O catálogo salvo excede o limite de 10000 tabelas.");
    expect(databaseWithLegacyCatalog.rows).toHaveLength(MAX_DATA_SOURCE_CATALOG_TABLES + 1);
    expect(databaseWithLegacyCatalog.rows.every(({ context }) => context === "unchanged")).toBe(true);
  });

  it("rejeita identidades duplicadas e reverte falhas dentro da transação", async () => {
    const duplicateSnapshot = [
      { schemaName: "public", tableName: "orders" },
      { schemaName: "public", tableName: "orders" },
    ];
    const database = new FakeCatalogDatabase([
      { id: "stable", dataSourceId: sourceId, schemaName: "public", tableName: "orders", context: "preserve", discoveredAt: new Date(0) },
    ]);
    await expect(reconcileDataSourceCatalog(database, sourceId, duplicateSnapshot))
      .rejects.toThrow("O catálogo recebido contém tabelas duplicadas.");
    expect(database.transactionCount).toBe(0);

    database.failUpsert = true;
    const update = {
      name: "New source",
      host: "new-host",
      port: 5432,
      databaseName: "new-db",
      username: "readonly",
      encryptedPassword: "encrypted",
      context: "New context",
      updatedAt: discoveredAt,
    };
    await expect(reconcileDataSourceCatalog(
      database,
      sourceId,
      [{ schemaName: "public", tableName: "orders" }],
      discoveredAt,
      { sourceUpdate: update, resetTableContexts: true },
    ))
      .rejects.toThrow("simulated failure");
    expect(database.rows).toHaveLength(1);
    expect(database.rows[0]).toMatchObject({ id: "stable", context: "preserve", discoveredAt: new Date(0) });
    expect(database.sourceUpdates).toEqual([]);
  });
});
