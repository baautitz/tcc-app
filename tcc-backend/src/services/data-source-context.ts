export interface DataSourceContextTransaction {
  lockSourceUpdatedAt(dataSourceId: string): Promise<Date | undefined>;
  updateTableContext(
    dataSourceId: string,
    tableId: string,
    context: string,
  ): Promise<unknown | undefined>;
}

export interface DataSourceContextDatabase {
  transaction<T>(work: (tx: DataSourceContextTransaction) => Promise<T>): Promise<T>;
}

export class DataSourceContextSourceNotFoundError extends Error {
  constructor() {
    super("Servidor PostgreSQL não encontrado.");
    this.name = "DataSourceContextSourceNotFoundError";
  }
}

export class DataSourceContextVersionConflictError extends Error {
  constructor() {
    super("O servidor foi alterado. Recarregue os dados antes de salvar o contexto.");
    this.name = "DataSourceContextVersionConflictError";
  }
}

/**
 * Serialize manual context edits against source changes. The database adapter
 * must lock the source row before reading its version and updating the table,
 * so a concurrent endpoint/database change either clears this context after
 * this transaction or makes this transaction reject the stale version.
 */
export async function updateTableContextIfSourceVersionMatches<T>(
  database: DataSourceContextDatabase,
  dataSourceId: string,
  tableId: string,
  context: string,
  expectedSourceUpdatedAt: string,
): Promise<T | undefined> {
  const expectedVersion = new Date(expectedSourceUpdatedAt).getTime();

  return database.transaction(async (tx) => {
    const currentVersion = await tx.lockSourceUpdatedAt(dataSourceId);
    if (!currentVersion) throw new DataSourceContextSourceNotFoundError();
    if (currentVersion.getTime() !== expectedVersion) {
      throw new DataSourceContextVersionConflictError();
    }

    return await tx.updateTableContext(dataSourceId, tableId, context) as T | undefined;
  });
}
