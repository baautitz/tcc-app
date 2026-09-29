import { Client, type QueryResultRow } from "pg";
import Cursor from "pg-cursor";
import { MAX_DATA_SOURCE_CATALOG_TABLES } from "./data-source-catalog.js";
import {
  normalizeGeneralReadOnlySql,
  normalizeReadOnlySql,
  type AiCatalogTableReference,
} from "./query-security.js";

export interface ExternalPostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface DiscoveredTable {
  schemaName: string;
  tableName: string;
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

export const AI_QUERY_CONNECTION_TIMEOUT_MS = 5_000;
export const AI_QUERY_STATEMENT_TIMEOUT_MS = 10_000;
export const AI_QUERY_MAX_ROWS = 50;
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

interface CursorQuery {
  read(count: number): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

interface BoundedReadOnlyClient {
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

export class ExternalQueryExecutionError extends Error {
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
    );
    this.name = "ExternalQueryExecutionError";
  }
}

export function classifyExternalQueryError(
  error: unknown,
): ExternalQueryExecutionError {
  const source =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown })
      : {};
  const code = typeof source.code === "string" ? source.code : "";
  const message = typeof source.message === "string" ? source.message : "";
  const timeout =
    code === "57014" || (!code && /timeout|timed out/i.test(message));
  const retryableTransportCodes = new Set([
    "08000",
    "08001",
    "08003",
    "08006",
    "08007",
    "08P01",
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EAI_AGAIN",
    "ETIMEDOUT",
  ]);
  if (timeout)
    return new ExternalQueryExecutionError("timeout", code || null, false);
  if (retryableTransportCodes.has(code) || code.startsWith("08")) {
    return new ExternalQueryExecutionError("connection", code || null, true);
  }
  return new ExternalQueryExecutionError(
    "database",
    /^[0-9A-Z]{5}$/.test(code) ? code : null,
    false,
  );
}

function defaultBoundedClient(
  config: ExternalPostgresConfig,
): BoundedReadOnlyClient {
  return new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: AI_QUERY_CONNECTION_TIMEOUT_MS,
    statement_timeout: AI_QUERY_STATEMENT_TIMEOUT_MS,
  }) as unknown as BoundedReadOnlyClient;
}

function rowByteLength(row: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(row), "utf8");
}

/** Executes an AI query in a read-only transaction, fetching one bounded row at a time. */
export async function runBoundedReadOnlyQuery(
  config: ExternalPostgresConfig,
  sqlText: string,
  values: unknown[],
  options: BoundedReadOnlyQueryOptions = {},
): Promise<BoundedReadOnlyQueryResult> {
  const rowLimit = options.rowLimit ?? AI_QUERY_MAX_ROWS;
  const byteLimit = options.byteLimit ?? AI_QUERY_MAX_BYTES;
  if (
    !Number.isSafeInteger(rowLimit) ||
    rowLimit < 1 ||
    rowLimit > AI_QUERY_MAX_ROWS
  )
    throw new Error("Limite de linhas inválido.");
  if (
    !Number.isSafeInteger(byteLimit) ||
    byteLimit < 1 ||
    byteLimit > AI_QUERY_MAX_BYTES
  )
    throw new Error("Limite de bytes inválido.");
  const safeSql = options.allowGeneralReadOnlySql
    ? normalizeGeneralReadOnlySql(sqlText)
    : normalizeReadOnlySql(sqlText);
  const boundedSql = `
    SELECT
      CASE WHEN octet_length(encoded.row_json) <= ${byteLimit} THEN encoded.row_json ELSE NULL END AS "__ai_row_json",
      octet_length(encoded.row_json) AS "__ai_row_bytes"
    FROM (${safeSql}) AS "__ai_query_source"
    CROSS JOIN LATERAL (SELECT to_jsonb("__ai_query_source")::text AS row_json) AS encoded
    LIMIT ${rowLimit + 1}
  `;
  const client = (options.createClient ?? defaultBoundedClient)(config);
  const createCursor =
    options.createCursor ??
    ((query, queryValues) =>
      new Cursor(query, queryValues) as unknown as CursorQuery);
  let connected = false;
  let transactionOpen = false;
  let cursor: CursorQuery | undefined;
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN READ ONLY");
    transactionOpen = true;
    await client.query(
      `SET LOCAL statement_timeout = '${AI_QUERY_STATEMENT_TIMEOUT_MS}ms'`,
    );
    if (!options.preserveConfiguredSearchPath) {
      // Only pg_catalog functions/operators are resolvable implicitly. User tables must be schema-qualified.
      await client.query("SET LOCAL search_path = pg_catalog");
    }
    // pg-cursor has no stable AbortSignal cancellation API. An active fetch remains
    // bounded by statement_timeout; the caller discards its result after an abort.
    cursor = createCursor(boundedSql, values);
    await client.query(cursor);

    const rows: Record<string, unknown>[] = [];
    let bytes = 2; // JSON array brackets.
    let truncated = false;
    let truncationReason: BoundedReadOnlyQueryResult["truncationReason"] = null;
    while (true) {
      const nextRows = await cursor.read(1);
      if (nextRows.length === 0) break;
      const encodedRow = nextRows[0]!;
      if (rows.length >= rowLimit) {
        truncated = true;
        truncationReason = "row_limit";
        break;
      }
      const rowJson = encodedRow.__ai_row_json;
      const encodedBytes = Number(encodedRow.__ai_row_bytes);
      if (
        rowJson === null ||
        typeof rowJson !== "string" ||
        !Number.isSafeInteger(encodedBytes) ||
        encodedBytes > byteLimit
      ) {
        truncated = true;
        truncationReason = "byte_limit";
        break;
      }
      let row: Record<string, unknown>;
      try {
        row = parseJsonPreservingNumbers(rowJson);
      } catch {
        throw new Error(
          "O servidor retornou uma linha que não pôde ser interpretada.",
        );
      }
      let nextRowBytes: number;
      try {
        nextRowBytes = rowByteLength(row) + (rows.length > 0 ? 1 : 0);
      } catch {
        throw new Error(
          "O resultado contém valores que não podem ser serializados com segurança.",
        );
      }
      if (bytes + nextRowBytes > byteLimit) {
        truncated = true;
        truncationReason = "byte_limit";
        break;
      }
      rows.push(row);
      bytes += nextRowBytes;
    }

    await cursor.close();
    cursor = undefined;
    await client.query("COMMIT");
    transactionOpen = false;
    return { rows, rowLimit, byteLimit, bytes, truncated, truncationReason };
  } catch (error) {
    if (error instanceof ExternalQueryExecutionError) throw error;
    throw classifyExternalQueryError(error);
  } finally {
    if (cursor) await cursor.close().catch(() => undefined);
    if (connected && transactionOpen)
      await client.query("ROLLBACK").catch(() => undefined);
    if (connected) await client.end().catch(() => undefined);
  }
}

/** Preserves PostgreSQL JSON numeric lexemes as strings, avoiding JS precision loss for int8/numeric. */
function parseJsonPreservingNumbers(jsonText: string): Record<string, unknown> {
  let quoted = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < jsonText.length; ) {
    const character = jsonText[index]!;
    if (inString) {
      quoted += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      index += 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      quoted += character;
      index += 1;
      continue;
    }
    if (character === "-" || /[0-9]/.test(character)) {
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
        jsonText.slice(index),
      )?.[0];
      if (number) {
        quoted += JSON.stringify(number);
        index += number.length;
        continue;
      }
    }
    quoted += character;
    index += 1;
  }
  const parsed: unknown = JSON.parse(quoted);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Expected a JSON object");
  return parsed as Record<string, unknown>;
}

export async function runBoundedReadOnlyQueryWithRetry(
  config: ExternalPostgresConfig,
  sqlText: string,
  values: unknown[],
  options: BoundedReadOnlyQueryOptions & {
    beforeAttempt?: (attempt: number) => boolean | Promise<boolean>;
  } = {},
): Promise<BoundedReadOnlyQueryResult> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    if (options.retrySignal?.aborted)
      throw (
        options.retrySignal.reason ?? new DOMException("Aborted", "AbortError")
      );
    if (options.beforeAttempt && !(await options.beforeAttempt(attempt))) {
      throw new ExternalQueryExecutionError("connection", null, false);
    }
    try {
      return await runBoundedReadOnlyQuery(config, sqlText, values, options);
    } catch (error) {
      const classified =
        error instanceof ExternalQueryExecutionError
          ? error
          : classifyExternalQueryError(error);
      if (attempt >= 2 || !classified.retryable) throw classified;
      await waitBeforeTechnicalRetry(options.retrySignal);
    }
  }
}

function waitBeforeTechnicalRetry(signal?: AbortSignal): Promise<void> {
  const delayMs =
    AI_QUERY_RETRY_MIN_DELAY_MS +
    Math.floor(Math.random() * (AI_QUERY_RETRY_JITTER_MS + 1));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const complete = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(complete, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

const METADATA_CONNECTION_TIMEOUT_MS = 5_000;
const METADATA_STATEMENT_TIMEOUT_MS = 5_000;

function createMetadataClient(config: ExternalPostgresConfig): Client {
  return new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: METADATA_CONNECTION_TIMEOUT_MS,
    statement_timeout: METADATA_STATEMENT_TIMEOUT_MS,
  });
}

/** Lists live base tables for catalog freshness checks without reading table rows. */
export async function listPostgresBaseTables(
  config: ExternalPostgresConfig,
): Promise<DiscoveredTable[]> {
  const client = createMetadataClient(config);
  try {
    await client.connect();
    const result = await client.query<{
      schema_name: string;
      table_name: string;
    }>(`
      SELECT table_schema AS schema_name, table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT LIKE 'pg_%'
        AND table_schema <> 'information_schema'
      ORDER BY table_schema, table_name
      LIMIT ${MAX_DATA_SOURCE_CATALOG_TABLES + 1}
    `);
    if (result.rows.length > MAX_DATA_SOURCE_CATALOG_TABLES) {
      throw new Error(
        `O catálogo do servidor excede o limite de ${MAX_DATA_SOURCE_CATALOG_TABLES} tabelas.`,
      );
    }
    return result.rows.map((row) => ({
      schemaName: row.schema_name,
      tableName: row.table_name,
    }));
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Finds user-defined, domain, enum, composite, or pseudo types in referenced
 * tables, recursively including array element types. AI previews reject the
 * whole referenced table if any column has one of these types.
 */
export async function findUnsafeAiColumnTypes(
  config: ExternalPostgresConfig,
  tables: AiCatalogTableReference[],
): Promise<UnsafeAiColumnType[]> {
  if (tables.length === 0) return [];
  const client = createMetadataClient(config);
  try {
    await client.connect();
    const result = await client.query<UnsafeAiColumnType>(
      `
      WITH RECURSIVE requested(schema_name, table_name) AS (
        SELECT * FROM unnest($1::text[], $2::text[])
      ), table_columns AS (
        SELECT
          relation_namespace.nspname AS schema_name,
          relation.relname AS table_name,
          attribute.attname AS column_name,
          attribute.atttypid AS type_oid
        FROM requested
        JOIN pg_catalog.pg_namespace AS relation_namespace
          ON relation_namespace.nspname = requested.schema_name
        JOIN pg_catalog.pg_class AS relation
          ON relation.relnamespace = relation_namespace.oid
          AND relation.relname = requested.table_name
          AND relation.relkind IN ('r', 'p', 'f')
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = relation.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      ), type_tree AS (
        SELECT
          table_columns.schema_name,
          table_columns.table_name,
          table_columns.column_name,
          type.oid AS type_oid,
          type.typnamespace,
          type.typtype,
          type.typelem,
          type.typname
        FROM table_columns
        JOIN pg_catalog.pg_type AS type ON type.oid = table_columns.type_oid
        UNION ALL
        SELECT
          type_tree.schema_name,
          type_tree.table_name,
          type_tree.column_name,
          element.oid AS type_oid,
          element.typnamespace,
          element.typtype,
          element.typelem,
          element.typname
        FROM type_tree
        JOIN pg_catalog.pg_type AS current_type ON current_type.oid = type_tree.type_oid
        JOIN pg_catalog.pg_type AS element ON element.oid = current_type.typelem
        WHERE current_type.typelem <> 0
      )
      SELECT DISTINCT
        type_tree.schema_name AS "schemaName",
        type_tree.table_name AS "tableName",
        type_tree.column_name AS "columnName",
        type_namespace.nspname AS "typeSchema",
        type_tree.typname AS "typeName",
        type_tree.typtype AS "typeKind"
      FROM type_tree
      JOIN pg_catalog.pg_namespace AS type_namespace
        ON type_namespace.oid = type_tree.typnamespace
      WHERE type_namespace.nspname <> 'pg_catalog'
        OR type_tree.typtype NOT IN ('b', 'r', 'm')
      LIMIT 1001
      `,
      [
        tables.map((table) => table.schemaName),
        tables.map((table) => table.tableName),
      ],
    );
    return result.rows;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Reads only column names and public type metadata; values/defaults are excluded. */
export async function getPostgresTableColumns(
  config: ExternalPostgresConfig,
  schemaName: string,
  tableName: string,
): Promise<DiscoveredColumn[]> {
  const client = createMetadataClient(config);
  try {
    await client.connect();
    const result = await client.query<{
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: "YES" | "NO";
      ordinal_position: number;
    }>(
      `
      SELECT column_name, data_type, udt_name, is_nullable, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
      LIMIT 1001
    `,
      [schemaName, tableName],
    );
    if (result.rows.length > 1_000) {
      throw new Error(
        "A tabela excede o limite de colunas para consulta assistida.",
      );
    }
    return result.rows.map((row) => ({
      columnName: row.column_name,
      dataType: row.data_type,
      udtName: row.udt_name,
      nullable: row.is_nullable === "YES",
      ordinalPosition: Number(row.ordinal_position),
    }));
  } finally {
    await client.end().catch(() => undefined);
  }
}

interface PrivilegeCheckRow extends QueryResultRow {
  is_superuser: boolean;
  bypass_rls: boolean;
  can_create_database: boolean;
  can_create_temp: boolean;
  can_create_schema: boolean;
  can_create_pg_catalog: boolean;
  can_write_table: boolean;
}

export async function inspectReadOnlyPostgres(
  config: ExternalPostgresConfig,
): Promise<DiscoveredTable[]> {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  });

  try {
    await client.connect();
    const privilegeResult = await client.query<PrivilegeCheckRow>(`
      SELECT
        current_setting('is_superuser')::boolean AS is_superuser,
        (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls,
        has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database,
        has_database_privilege(current_user, current_database(), 'TEMP') AS can_create_temp,
        has_schema_privilege(current_user, 'pg_catalog', 'CREATE') AS can_create_pg_catalog,
        EXISTS (
          SELECT 1 FROM pg_namespace n
          WHERE n.nspname NOT LIKE 'pg_%'
            AND n.nspname <> 'information_schema'
            AND has_schema_privilege(current_user, n.oid, 'CREATE')
        ) AS can_create_schema,
        EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND n.nspname NOT LIKE 'pg_%'
            AND n.nspname <> 'information_schema'
            AND (
              has_table_privilege(current_user, c.oid, 'INSERT') OR
              has_table_privilege(current_user, c.oid, 'UPDATE') OR
              has_table_privilege(current_user, c.oid, 'DELETE') OR
              has_table_privilege(current_user, c.oid, 'TRUNCATE') OR
              has_table_privilege(current_user, c.oid, 'REFERENCES') OR
              has_table_privilege(current_user, c.oid, 'TRIGGER')
            )
        ) AS can_write_table
    `);
    const privilege = privilegeResult.rows[0];
    if (!privilege)
      throw new Error(
        "Não foi possível verificar os privilégios do usuário externo.",
      );
    if (Object.values(privilege).some((value) => value === true)) {
      throw new Error(
        "O usuário PostgreSQL precisa possuir somente acesso de leitura (SELECT), sem superusuário, escrita, DDL ou TEMP.",
      );
    }

    const tableResult = await client.query<{
      schema_name: string;
      table_name: string;
    }>(`
      SELECT table_schema AS schema_name, table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT LIKE 'pg_%'
        AND table_schema <> 'information_schema'
      ORDER BY table_schema, table_name
      LIMIT ${MAX_DATA_SOURCE_CATALOG_TABLES + 1}
    `);
    if (tableResult.rows.length > MAX_DATA_SOURCE_CATALOG_TABLES) {
      throw new Error(
        `O catálogo do servidor excede o limite de ${MAX_DATA_SOURCE_CATALOG_TABLES} tabelas.`,
      );
    }
    return tableResult.rows.map((table) => ({
      schemaName: table.schema_name,
      tableName: table.table_name,
    }));
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function runReadOnlyQuery(
  config: ExternalPostgresConfig,
  sqlText: string,
  values: unknown[],
): Promise<Record<string, unknown>[]> {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  try {
    await client.connect();
    const result = await client.query(sqlText, values);
    return result.rows;
  } finally {
    await client.end().catch(() => undefined);
  }
}
