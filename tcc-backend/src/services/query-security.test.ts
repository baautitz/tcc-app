import { describe, expect, it } from "vitest";
import {
  assertReadOnlySql,
  assertSqlParameters,
  bindQueryParameters,
} from "./query-security.js";
import type { ParameterDefinition } from "../lib/contracts.js";

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
