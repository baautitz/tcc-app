import { Client, type QueryResultRow } from "pg";

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
    const result = await client.query<{ schema_name: string; table_name: string }>(`
      SELECT table_schema AS schema_name, table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT LIKE 'pg_%'
        AND table_schema <> 'information_schema'
      ORDER BY table_schema, table_name
      LIMIT 10001
    `);
    if (result.rows.length > 10_000) {
      throw new Error("O catálogo do servidor excede o limite de tabelas para consulta assistida.");
    }
    return result.rows.map((row) => ({
      schemaName: row.schema_name,
      tableName: row.table_name,
    }));
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
    }>(`
      SELECT column_name, data_type, udt_name, is_nullable, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
      LIMIT 1001
    `, [schemaName, tableName]);
    if (result.rows.length > 1_000) {
      throw new Error("A tabela excede o limite de colunas para consulta assistida.");
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
    `);
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
