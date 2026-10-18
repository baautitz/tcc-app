import { DomainError } from "../shared/lib/domain-error.js";
export interface DataSourceContextTransaction {
  lockSourceUpdatedAt(dataSourceId: string): Promise<Date | undefined>;
  updateTableContext(
    dataSourceId: string,
    tableId: string,
    context: string,
    expectedContextVersion: number,
  ): Promise<unknown | undefined>;
}

export interface DataSourceContextDatabase {
  transaction<T>(work: (tx: DataSourceContextTransaction) => Promise<T>): Promise<T>;
}

export class DataSourceContextSourceNotFoundError extends DomainError {
  constructor() {
    super("Servidor PostgreSQL não encontrado.", "SOURCE_NOT_FOUND", "not_found");
    this.name = "DataSourceContextSourceNotFoundError";
  }
}

export class DataSourceContextVersionConflictError extends DomainError {
  constructor() {
    super("O servidor foi alterado. Recarregue os dados antes de salvar o contexto.", "VERSION_CONFLICT", "conflict");
    this.name = "DataSourceContextVersionConflictError";
  }
}

export class DataSourceTableContextVersionConflictError extends DomainError {
  constructor() {
    super("O contexto da tabela mudou. Recarregue os dados antes de salvar novamente.", "TABLE_VERSION_CONFLICT", "conflict");
    this.name = "DataSourceTableContextVersionConflictError";
  }
}

export function sourceContextRevisionChanged(
  current: { name: string; host: string; port: number; databaseName: string; username: string; context: string },
  next: { name: string; host: string; port: number; databaseName: string; username: string; context: string },
  credentialChanged: boolean,
): boolean {
  return current.name !== next.name ||
    current.host !== next.host ||
    current.port !== next.port ||
    current.databaseName !== next.databaseName ||
    current.username !== next.username ||
    current.context !== next.context ||
    credentialChanged;
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
  expectedContextVersion: number,
): Promise<T | undefined> {
  const expectedVersion = new Date(expectedSourceUpdatedAt).getTime();

  return database.transaction(async (tx) => {
    const currentVersion = await tx.lockSourceUpdatedAt(dataSourceId);
    if (!currentVersion) throw new DataSourceContextSourceNotFoundError();
    if (currentVersion.getTime() !== expectedVersion) {
      throw new DataSourceContextVersionConflictError();
    }

    const updated = await tx.updateTableContext(dataSourceId, tableId, context, expectedContextVersion);
    if (!updated) throw new DataSourceTableContextVersionConflictError();
    return updated as T;
  });
}
