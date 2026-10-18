import { Client, type QueryResultRow } from "pg";
import { MAX_DATA_SOURCE_CATALOG_TABLES } from "../../domain/data-source-catalog.js";
import { type AiCatalogTableReference } from "../../../../shared/security/query-security.js";
import { type ExternalPostgresConfig } from "./pg-exec.js";

import type { DiscoveredTable } from "../../domain/data-source-catalog.js";
export type { DiscoveredTable };

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
