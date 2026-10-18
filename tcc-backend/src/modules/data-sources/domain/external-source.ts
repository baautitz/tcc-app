import { DomainError } from "../../../shared/lib/domain-error.js";
import type { dataSources } from "../../../shared/db/schema.js";
import type { AiCatalogTableReference } from "../../../shared/security/query-security.js";
import type { DiscoveredTable } from "./data-source-catalog.js";

export interface ExternalPostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export const AI_QUERY_CONNECTION_TIMEOUT_MS = 5_000;
export const AI_QUERY_STATEMENT_TIMEOUT_MS = 10_000;
export const AI_QUERY_MAX_ROWS = 500;
export const AI_QUERY_MAX_BYTES = 48_000;
export const AI_QUERY_RETRY_MIN_DELAY_MS = 100;
export const AI_QUERY_RETRY_JITTER_MS = 100;

export interface BoundedReadOnlyQueryResult {
  rows: Record<string, unknown>[];
  rowLimit: number;
  byteLimit: number;
  bytes: number;
  truncated: boolean;
  truncationReason: "row_limit" | "byte_limit" | null;
}

export interface CursorQuery {
  read(count: number): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

export interface BoundedReadOnlyClient {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  query(cursor: CursorQuery): Promise<unknown>;
  end(): Promise<void>;
}

export interface BoundedReadOnlyQueryOptions {
  rowLimit?: number;
  byteLimit?: number;
  preserveConfiguredSearchPath?: boolean;
  allowGeneralReadOnlySql?: boolean;
  retrySignal?: AbortSignal;
  createClient?: (config: ExternalPostgresConfig) => BoundedReadOnlyClient;
  createCursor?: (sqlText: string, values: unknown[]) => CursorQuery;
}

export class ExternalQueryExecutionError extends DomainError {
  constructor(
    public readonly category: "timeout" | "connection" | "database",
    public readonly sqlState: string | null,
    public readonly retryable: boolean,
  ) {
    super(
      category === "timeout"
        ? "A consulta excedeu o tempo limite. Simplifique a query e tente novamente."
        : category === "connection"
          ? "Não foi possível conectar ao servidor de dados. Verifique a disponibilidade e tente novamente."
          : "O PostgreSQL rejeitou a consulta. Revise as tabelas, colunas, tipos e parâmetros informados.",
      `EXTERNAL_${category.toUpperCase()}`,
      "bad_request",
    );
    this.name = "ExternalQueryExecutionError";
  }
}

export interface DiscoveredColumn {
  columnName: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  ordinalPosition: number;
}

export interface UnsafeAiColumnType extends AiCatalogTableReference {
  columnName: string;
  typeSchema: string;
  typeName: string;
  typeKind: string;
}



/** Porta de acesso ao Postgres externo; implementada em data-sources/infrastructure e injetada na composicao. */
export interface ExternalSourcePort {
  sourceConnection(source: typeof dataSources.$inferSelect): ExternalPostgresConfig;
  runReadOnlyQuery(config: ExternalPostgresConfig, sqlText: string, values: unknown[]): Promise<Record<string, unknown>[]>;
  runBoundedReadOnlyQuery(config: ExternalPostgresConfig, sqlText: string, values: unknown[], options?: BoundedReadOnlyQueryOptions): Promise<BoundedReadOnlyQueryResult>;
  runBoundedReadOnlyQueryWithRetry(
    config: ExternalPostgresConfig,
    sqlText: string,
    values: unknown[],
    options?: BoundedReadOnlyQueryOptions & { beforeAttempt?: (attempt: number) => boolean | Promise<boolean> },
  ): Promise<BoundedReadOnlyQueryResult>;
  listPostgresBaseTables(config: ExternalPostgresConfig): Promise<DiscoveredTable[]>;
  findUnsafeAiColumnTypes(config: ExternalPostgresConfig, tables: AiCatalogTableReference[]): Promise<UnsafeAiColumnType[]>;
  getPostgresTableColumns(config: ExternalPostgresConfig, schemaName: string, tableName: string): Promise<DiscoveredColumn[]>;
}
