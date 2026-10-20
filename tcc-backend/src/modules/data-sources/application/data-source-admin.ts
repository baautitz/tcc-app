import type {
  dataSources,
  dataSourceTables,
} from "../../../shared/db/schema.js";
import { getEnvironment } from "../../../shared/config/config.js";
import { encryptCredential } from "../../../shared/lib/credentials.js";
import {
  DrizzleDataSourcesRepository,
  type DataSourcesRepository,
} from "../infrastructure/data-sources-repository.js";
import { sourceConnection } from "../infrastructure/source-connection.js";

import { inspectReadOnlyPostgres } from "../infrastructure/external-pg/index.js";

import {
  DataSourceCatalogSnapshotChangedError,
  hasDataSourceTargetChanged,
  MAX_DATA_SOURCE_CATALOG_TABLES,
  reconcileDataSourceCatalog,
  type CatalogSourceSnapshot,
  type CatalogSourceUpdate,
} from "../domain/data-source-catalog.js";
import {
  DataSourceContextSourceNotFoundError,
  DataSourceContextVersionConflictError,
  DataSourceTableContextVersionConflictError,
  sourceContextRevisionChanged,
  updateTableContextIfSourceVersionMatches,
} from "../domain/data-source-context.js";

import { ApiError } from "../../../shared/lib/domain-error.js";

export type SourceRow = typeof dataSources.$inferSelect;
type InspectedTables = Awaited<ReturnType<typeof inspectReadOnlyPostgres>>;

export interface SourceInput {
  name: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  context: string;
}

export type SourceUpdateInput = Omit<SourceInput, "password"> & {
  password?: string;
};

export function catalogSourceSnapshot(
  source: SourceRow,
): CatalogSourceSnapshot {
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

export function safeSource(source: SourceRow) {
  const { encryptedPassword: _encryptedPassword, ...safe } = source;
  return safe;
}

export class DataSourceAdminService {
  constructor(
    private readonly repo: DataSourcesRepository,
    private readonly inspect: typeof inspectReadOnlyPostgres,
    private readonly encryptionKey: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async listSources() {
    return (await this.repo.listAll()).map(safeSource);
  }

  async getSourceOrThrow(sourceId: string) {
    const source = await this.repo.findById(sourceId);
    if (!source) throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
    return source;
  }

  async getSource(sourceId: string) {
    const source = await this.getSourceOrThrow(sourceId);
    const tables = await this.repo.listTables(
      source.id,
      MAX_DATA_SOURCE_CATALOG_TABLES + 1,
    );
    if (tables.length > MAX_DATA_SOURCE_CATALOG_TABLES) {
      throw new ApiError(
        409,
        `O catálogo excede o limite de ${MAX_DATA_SOURCE_CATALOG_TABLES} tabelas; contate um administrador.`,
      );
    }
    return { ...safeSource(source), tables };
  }

  async testSource(input: SourceInput) {
    return { valid: true, tables: await this.inspectInput(input) };
  }

  async createSource(input: SourceInput, createdBy: string) {
    const tables = await this.inspectInput(input);
    const source = await this.repo.insert({
      name: input.name,
      host: input.host,
      port: input.port,
      databaseName: input.databaseName,
      username: input.username,
      encryptedPassword: encryptCredential(input.password, this.encryptionKey),
      context: input.context,
      createdBy,
    });
    if (!source)
      throw new ApiError(500, "Não foi possível salvar o servidor PostgreSQL.");
    await this.catalogSourceTables(source.id, tables);
    return { ...safeSource(source), tables };
  }

  async updateSource(sourceId: string, input: SourceUpdateInput) {
    const existing = await this.getSourceOrThrow(sourceId);
    const expectedSourceSnapshot = catalogSourceSnapshot(existing);
    const password = input.password ?? sourceConnection(existing).password;
    const discovered = await this.inspectInput({ ...input, password });
    const targetChanged = hasDataSourceTargetChanged(existing, input);
    const sourceUpdate: CatalogSourceUpdate = {
      name: input.name,
      host: input.host,
      port: input.port,
      databaseName: input.databaseName,
      username: input.username,
      encryptedPassword: encryptCredential(password, this.encryptionKey),
      context: input.context,
      contextVersion:
        existing.contextVersion +
        (sourceContextRevisionChanged(
          existing,
          input,
          input.password !== undefined,
        )
          ? 1
          : 0),
      // Keep this token strictly increasing even when edits land within one ms.
      updatedAt: new Date(
        Math.max(this.now(), expectedSourceSnapshot.updatedAt.getTime() + 1),
      ),
    };
    // A changed endpoint/database can have different semantics behind identical table names.
    // Clear table contexts together with the source update and catalog reconciliation.
    await this.catalogSourceTables(sourceId, discovered, {
      sourceUpdate,
      expectedSourceSnapshot,
      resetTableContexts: targetChanged,
    });
    return safeSource(await this.getSourceOrThrow(sourceId));
  }

  async refreshSource(sourceId: string) {
    const source = await this.getSourceOrThrow(sourceId);
    const expectedSourceSnapshot = catalogSourceSnapshot(source);
    const tables = await this.inspect(sourceConnection(source));
    await this.catalogSourceTables(source.id, tables, {
      expectedSourceSnapshot,
    });
    return { tables };
  }

  async deleteSource(sourceId: string): Promise<void> {
    await this.getSourceOrThrow(sourceId);
    const deleted = await this.repo.deleteWithQueries(sourceId);
    if (deleted.length === 0)
      throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
  }

  private inspectInput(input: SourceInput) {
    return this.inspect({
      host: input.host,
      port: input.port,
      database: input.databaseName,
      user: input.username,
      password: input.password,
    });
  }

  private async catalogSourceTables(
    sourceId: string,
    tables: InspectedTables,
    options: {
      sourceUpdate?: CatalogSourceUpdate;
      expectedSourceSnapshot?: CatalogSourceSnapshot;
      resetTableContexts?: boolean;
    } = {},
  ): Promise<void> {
    try {
      await reconcileDataSourceCatalog(
        { transaction: this.repo.catalogTransaction },
        sourceId,
        tables,
        new Date(),
        options,
      );
    } catch (error) {
      if (error instanceof DataSourceCatalogSnapshotChangedError) {
        throw new ApiError(
          409,
          "O servidor foi alterado durante a operação. Tente atualizar o catálogo novamente.",
        );
      }
      throw error;
    }
  }

  async updateTableContext(
    sourceId: string,
    tableId: string,
    input: {
      context: string;
      expectedSourceUpdatedAt: string;
      expectedContextVersion: number;
    },
  ) {
    let table: typeof dataSourceTables.$inferSelect | undefined;
    try {
      table = await updateTableContextIfSourceVersionMatches<
        typeof dataSourceTables.$inferSelect
      >(
        { transaction: this.repo.contextTransaction },
        sourceId,
        tableId,
        input.context,
        input.expectedSourceUpdatedAt,
        input.expectedContextVersion,
      );
    } catch (error) {
      if (error instanceof DataSourceContextVersionConflictError) {
        throw new ApiError(
          409,
          "O servidor foi alterado. Recarregue os dados antes de salvar o contexto.",
        );
      }
      if (error instanceof DataSourceContextSourceNotFoundError) {
        throw new ApiError(404, "Servidor PostgreSQL não encontrado.");
      }
      if (error instanceof DataSourceTableContextVersionConflictError) {
        const tableExists = await this.repo.tableExists(sourceId, tableId);
        if (!tableExists)
          throw new ApiError(404, "Tabela catalogada não encontrada.");
        throw new ApiError(409, error.message);
      }
      throw error;
    }
    if (!table) throw new ApiError(404, "Tabela catalogada não encontrada.");
    return table;
  }
}

export const dataSourceAdminService = new DataSourceAdminService(
  new DrizzleDataSourcesRepository(),
  inspectReadOnlyPostgres,
  getEnvironment().CREDENTIAL_ENCRYPTION_KEY,
);
