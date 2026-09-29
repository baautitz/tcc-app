import { beforeEach, describe, expect, it, vi } from "vitest";

const pgState = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ sql: string; values?: unknown[] }>,
  rows: [] as Array<Record<string, unknown>>,
  rowSets: [] as Array<Array<Record<string, unknown>>>,
}));

vi.mock("pg", () => ({
  Client: class MockClient {
    constructor(options: Record<string, unknown>) {
      pgState.options.push(options);
    }
    async connect() {}
    async end() {}
    async query(sql: string, values?: unknown[]) {
      pgState.queries.push({ sql, values });
      return { rows: pgState.rowSets.shift() ?? pgState.rows };
    }
  },
}));

import { getPostgresTableColumns, inspectReadOnlyPostgres, listPostgresBaseTables } from "./external-postgres.js";

const connection = {
  host: "database.internal",
  port: 5432,
  database: "analytics",
  user: "readonly",
  password: "secret",
};

beforeEach(() => {
  pgState.options.length = 0;
  pgState.queries.length = 0;
  pgState.rows = [];
  pgState.rowSets = [];
});

describe("introspecção PostgreSQL sem leitura de dados", () => {
  it("consulta colunas por parâmetros e preserva tipos enum, array e JSON", async () => {
    pgState.rows = [
      { column_name: "status", data_type: "USER-DEFINED", udt_name: "order_state", is_nullable: "NO", ordinal_position: 1 },
      { column_name: "labels", data_type: "ARRAY", udt_name: "_text", is_nullable: "YES", ordinal_position: 2 },
      { column_name: "payload", data_type: "jsonb", udt_name: "jsonb", is_nullable: "YES", ordinal_position: 3 },
    ];

    const result = await getPostgresTableColumns(connection, "sales schema", "order's facts");

    expect(pgState.queries).toHaveLength(1);
    expect(pgState.queries[0]?.sql).toContain("FROM information_schema.columns");
    expect(pgState.queries[0]?.sql).toContain("table_schema = $1 AND table_name = $2");
    expect(pgState.queries[0]?.values).toEqual(["sales schema", "order's facts"]);
    expect(pgState.queries[0]?.sql).not.toContain("column_default");
    expect(pgState.queries[0]?.sql).not.toContain("SELECT *");
    expect(result).toEqual([
      { columnName: "status", dataType: "USER-DEFINED", udtName: "order_state", nullable: false, ordinalPosition: 1 },
      { columnName: "labels", dataType: "ARRAY", udtName: "_text", nullable: true, ordinalPosition: 2 },
      { columnName: "payload", dataType: "jsonb", udtName: "jsonb", nullable: true, ordinalPosition: 3 },
    ]);
    expect(pgState.options[0]).toMatchObject({ connectionTimeoutMillis: 5_000, statement_timeout: 5_000 });
  });

  it("lista somente tabelas base visíveis e exclui schemas de sistema", async () => {
    pgState.rows = [{ schema_name: "public", table_name: "orders" }];

    const result = await listPostgresBaseTables(connection);

    expect(pgState.queries[0]?.sql).toContain("table_type = 'BASE TABLE'");
    expect(pgState.queries[0]?.sql).toContain("table_schema NOT LIKE 'pg_%'");
    expect(pgState.queries[0]?.sql).toContain("table_schema <> 'information_schema'");
    expect(pgState.queries[0]?.sql).toContain("LIMIT 10001");
    expect(result).toEqual([{ schemaName: "public", tableName: "orders" }]);
  });

  it("limita a descoberta usada no cadastro, edição e refresh a 10 mil tabelas", async () => {
    pgState.rowSets = [
      [{
        is_superuser: false,
        bypass_rls: false,
        can_create_database: false,
        can_create_temp: false,
        can_create_schema: false,
        can_write_table: false,
      }],
      Array.from({ length: 10_001 }, (_, index) => ({ schema_name: "public", table_name: `table_${index}` })),
    ];

    await expect(inspectReadOnlyPostgres(connection))
      .rejects.toThrow("O catálogo do servidor excede o limite de 10000 tabelas.");
    expect(pgState.queries[1]?.sql).toContain("LIMIT 10001");
  });
});
