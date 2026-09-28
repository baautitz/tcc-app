import { describe, expect, it } from "vitest";
import { dashboardCreateSchema, dashboardDocumentSchema, queryInputSchema } from "./contracts.js";

const queryInput = {
  dataSourceId: "00000000-0000-4000-8000-000000000001",
  name: "Resumo mensal",
  sqlText: "SELECT 1 AS valor",
  parameters: [],
};

describe("contratos de dashboard e query", () => {
  it("aceita queries sem usuários e rejeita o campo userIds", () => {
    expect(queryInputSchema.parse(queryInput)).toEqual(queryInput);
    expect(queryInputSchema.safeParse({ ...queryInput, userIds: [] }).success).toBe(false);
  });

  it("cria documentos vazios de dashboard a partir de nome e descrição", () => {
    expect(dashboardCreateSchema.parse({ name: "Resumo", description: "Indicadores mensais" })).toEqual({
      name: "Resumo",
      description: "Indicadores mensais",
    });
    expect(dashboardCreateSchema.safeParse({ name: "Resumo", id: "00000000-0000-4000-8000-000000000001" }).success).toBe(false);

    const dashboard = dashboardDocumentSchema.parse({
      id: "00000000-0000-4000-8000-000000000002",
      name: "Resumo",
    });
    expect(dashboard.workspace.params).toEqual([]);
    expect(dashboard.queryBindings).toEqual([]);
    expect(dashboard.ui.components).toEqual([]);
  });
});
