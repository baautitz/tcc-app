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

interface PrivilegeCheckRow extends QueryResultRow {
  is_superuser: boolean;
  bypass_rls: boolean;
  can_create_database: boolean;
  can_create_temp: boolean;
  can_create_schema: boolean;
  can_write_table: boolean;
}

export async function inspectReadOnlyPostgres(config: ExternalPostgresConfig): Promise<DiscoveredTable[]> {
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
    if (!privilege) throw new Error("Não foi possível verificar os privilégios do usuário externo.");
    if (Object.values(privilege).some((value) => value === true)) {
      throw new Error("O usuário PostgreSQL precisa possuir somente acesso de leitura (SELECT), sem superusuário, escrita, DDL ou TEMP.");
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
    return tableResult.rows.map((table) => ({ schemaName: table.schema_name, tableName: table.table_name }));
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
