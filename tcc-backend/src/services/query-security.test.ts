import { describe, expect, it } from "vitest";
import {
  assertAiReadOnlySql,
  assertAiCatalogTableReferences,
  assertReadOnlySql,
  assertSqlParameters,
  bindQueryParameters,
  QueryInputValidationError,
} from "./query-security.js";
import type { ParameterDefinition } from "../shared/lib/contracts.js";

const parameters: ParameterDefinition[] = [
  { name: "start_date", label: "Data inicial", type: "date", required: true },
  {
    name: "categories",
    label: "Categorias",
    type: "multi_select",
    required: false,
  },
];

describe("query security", () => {
  it("aceita SELECT simples", () => {
    expect(() =>
      assertReadOnlySql("SELECT id, name FROM products"),
    ).not.toThrow();
  });

  it("rejeita escrita e múltiplas instruções", () => {
    expect(() => assertReadOnlySql("UPDATE products SET name = 'x'")).toThrow(
      "SELECT",
    );
    expect(() => assertReadOnlySql("SELECT 1; DELETE FROM products")).toThrow(
      "somente uma instrução",
    );
    expect(() =>
      assertReadOnlySql(
        "WITH changed AS (UPDATE products SET name = 'x' RETURNING id) SELECT * FROM changed",
      ),
    ).toThrow("não permitida");
  });

  it("ignora palavras e ponto-e-vírgula dentro de literais e comentários SQL", () => {
    expect(() =>
      assertReadOnlySql(
        "SELECT 'delete; update' AS message /* DROP TABLE x; */ -- ; DELETE\nFROM products; -- final comment",
      ),
    ).not.toThrow();
    expect(() => assertReadOnlySql("SELECT 1 /* comentário sem fim")).toThrow(
      "incompleto",
    );
    expect(() =>
      assertReadOnlySql("SELECT 1; /* comentário */ DELETE FROM products"),
    ).toThrow("somente uma instrução");
  });

  it("rejeita mutações em comentários/CTEs e funções PostgreSQL com efeitos", () => {
    expect(() =>
      assertReadOnlySql(
        "WITH changed AS (/* c */ DELETE FROM products RETURNING id) SELECT * FROM changed",
      ),
    ).toThrow("não permitida");
    expect(() => assertReadOnlySql("SELECT nextval('orders_id_seq')")).toThrow(
      "não é permitida",
    );
    expect(() => assertAiReadOnlySql("SELECT pg_catalog.pg_sleep(10)")).toThrow(
      "não é permitida",
    );
    expect(() =>
      assertAiReadOnlySql("SELECT dblink_exec('foreign', 'DROP TABLE x')"),
    ).toThrow("não é permitida");
    expect(() =>
      assertAiReadOnlySql("SELECT pg_read_file('/etc/passwd')"),
    ).toThrow("não é permitida");
    expect(() => assertAiReadOnlySql("SELECT random()")).toThrow(
      "lista segura",
    );
    expect(() => assertAiReadOnlySql('SELECT "PG_CATALOG"."count"(*)')).toThrow(
      "lista segura",
    );
    expect(() => assertAiReadOnlySql('SELECT pg_catalog."COUNT"(*)')).toThrow(
      "lista segura",
    );
    expect(() =>
      assertAiReadOnlySql('SELECT "pg_catalog"."count"(*)'),
    ).not.toThrow();
    expect(() =>
      assertAiReadOnlySql(
        "SELECT public.custom_reporting_function(order_id) FROM public.orders",
      ),
    ).toThrow("lista segura");
    expect(() =>
      assertReadOnlySql("SELECT * FROM orders FOR KEY SHARE"),
    ).toThrow("bloqueio");
  });

  it("preserva UDFs read-only para consultas existentes, mas aplica allowlist estrita ao preview IA", () => {
    expect(() =>
      assertReadOnlySql(
        "SELECT public.custom_reporting_function(order_id) FROM public.orders",
      ),
    ).not.toThrow();
    expect(() =>
      assertAiReadOnlySql(
        "SELECT public.custom_reporting_function(order_id) FROM public.orders",
      ),
    ).toThrow("lista segura");
  });

  it("restringe casts e literais tipados da IA a tipos built-in", () => {
    const rejected = [
      "SELECT CAST('payload' AS evil.widget)",
      "SELECT 'payload'::evil.widget",
      "SELECT CAST('payload' AS public.custom_domain)",
      "SELECT 'payload'::public.order_state",
      "SELECT CAST('payload' AS public.custom_composite[])",
      'SELECT CAST(1 AS "evil"."widget")',
      'SELECT 1::"public"."custom_domain"[]',
      "SELECT evil.widget 'payload'",
      'SELECT "public"."custom_domain" \'payload\'',
    ];
    for (const sqlText of rejected)
      expect(() => assertAiReadOnlySql(sqlText), sqlText).toThrow("tipo");

    const accepted = [
      "SELECT CAST('42' AS integer)",
      "SELECT CAST('42.50' AS pg_catalog.numeric(10, 2))",
      'SELECT CAST(1 AS "pg_catalog"."int4"[])',
      "SELECT CAST(ARRAY[1] AS integer ARRAY[4])",
      "SELECT '2026-01-31'::date",
      "SELECT '2026-01-31 10:00:00+00'::timestamp(3) with time zone",
      "SELECT DATE '2026-01-31', INTERVAL '1 day'",
      "SELECT now() AT TIME ZONE 'UTC'",
      "SELECT to_char(now(), 'YYYY-MM')",
      "SELECT B'1010', X'FF'",
    ];
    for (const sqlText of accepted)
      expect(() => assertAiReadOnlySql(sqlText), sqlText).not.toThrow();
  });

  it("limita referências do preview às tabelas base catalogadas, respeitando CTEs e JOINs", () => {
    const knownTables = [
      { schemaName: "public", tableName: "orders" },
      { schemaName: "sales", tableName: "regions" },
    ];
    expect(
      assertAiCatalogTableReferences(
        "WITH totals(total) AS (SELECT count(*) FROM public.orders) SELECT * FROM totals t JOIN sales.regions r ON true",
        knownTables,
      ),
    ).toEqual([
      { schemaName: "public", tableName: "orders" },
      { schemaName: "sales", tableName: "regions" },
    ]);
    expect(() =>
      assertAiCatalogTableReferences(
        "SELECT * FROM public.orders o, public.unregistered_view v",
        knownTables,
      ),
    ).toThrow("não pertence ao catálogo base");
    expect(() =>
      assertAiCatalogTableReferences("SELECT * FROM orders", knownTables),
    ).toThrow("Qualifique o schema");
  });

  it("preserva identificadores quoted ao resolver referências usadas", () => {
    const knownTables = [{ schemaName: "Sales", tableName: "Orders" }];
    expect(
      assertAiCatalogTableReferences(
        'SELECT * FROM "Sales"."Orders"',
        knownTables,
      ),
    ).toEqual([{ schemaName: "Sales", tableName: "Orders" }]);
    expect(() =>
      assertAiCatalogTableReferences("SELECT * FROM sales.orders", knownTables),
    ).toThrow("não pertence ao catálogo base");
  });

  it("converte apenas parâmetros declarados em bind values", () => {
    const bound = bindQueryParameters(
      "SELECT * FROM sales WHERE created_at >= {{start_date}} AND category_id = ANY({{categories}})",
      parameters,
      { start_date: "2026-01-01", categories: ["a", "b"] },
    );

    expect(bound.sqlText).toBe(
      "SELECT * FROM sales WHERE created_at >= $1 AND category_id = ANY($2)",
    );
    expect(bound.values).toEqual(["2026-01-01", ["a", "b"]]);
  });

  it("rejeita parâmetros não declarados", () => {
    expect(() =>
      bindQueryParameters("SELECT 1", parameters, { injected: "x" }),
    ).toThrow("não foi declarado");
  });

  it("aplica binds apenas em placeholders SQL, nunca dentro de strings/comentários", () => {
    const bound = bindQueryParameters(
      "SELECT '{{start_date}}' AS label, created_at FROM sales WHERE created_at >= {{start_date}} -- {{categories}}",
      [parameters[0]!],
      { start_date: "2026-01-01" },
    );
    expect(bound.sqlText).toBe(
      "SELECT '{{start_date}}' AS label, created_at FROM sales WHERE created_at >= $1 -- {{categories}}",
    );
    expect(bound.values).toEqual(["2026-01-01"]);
  });

  it("valida datas de calendário e limita payloads e arrays de parâmetros", () => {
    expect(() =>
      bindQueryParameters("SELECT {{start_date}}", [parameters[0]!], {
        start_date: "2025-02-29",
      }),
    ).toThrow("data válida");
    expect(() =>
      bindQueryParameters("SELECT {{start_date}}", [parameters[0]!], {
        start_date: "0000-01-01",
      }),
    ).toThrow("data válida");
    expect(() =>
      bindQueryParameters("SELECT {{start_date}}", [parameters[0]!], {
        start_date: "2024-02-29",
      }),
    ).not.toThrow();
    expect(() =>
      bindQueryParameters("SELECT {{categories}}", [parameters[1]!], {
        categories: Array.from({ length: 51 }, (_, index) => String(index)),
      }),
    ).toThrow("limites");
    expect(() =>
      bindQueryParameters("SELECT {{categories}}", [parameters[1]!], {
        categories: ["x".repeat(2049)],
      }),
    ).toThrow("limites");
    expect(() =>
      bindQueryParameters("SELECT {{start_date}}", [parameters[0]!], {
        start_date: "2026-01-01",
        unexpected: "x",
      }),
    ).toThrow("não foi declarado");
  });

  it("marca parâmetro obrigatório ausente para que o agente pergunte em vez de gerar SQL inválido", () => {
    try {
      bindQueryParameters("SELECT {{start_date}}", [parameters[0]!], {});
      throw new Error("expected validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryInputValidationError);
      expect((error as QueryInputValidationError).code).toBe(
        "MISSING_PARAMETERS",
      );
    }
  });

  it("valida que os placeholders e parâmetros declarados correspondem", () => {
    expect(() =>
      assertSqlParameters("SELECT {{start_date}}", parameters),
    ).toThrow("categories");
    expect(() => assertSqlParameters("SELECT {{unknown}}", parameters)).toThrow(
      "unknown",
    );
    expect(() =>
      assertSqlParameters("SELECT {{start_date}}, {{categories}}", parameters),
    ).not.toThrow();
  });
});
