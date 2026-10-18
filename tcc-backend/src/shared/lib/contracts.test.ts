import { describe, expect, it } from "vitest";
import {
  dashboardCreateSchema,
  dashboardDocumentSchema,
  queryCreateInputSchema,
  queryInputSchema,
  queryPreviewInputSchema,
  queryUpdateInputSchema,
} from "./contracts.js";

const queryInput = {
  dataSourceId: "00000000-0000-4000-8000-000000000001",
  name: "Resumo mensal",
  sqlText: "SELECT 1 AS valor",
  parameters: [],
};

describe("contratos de dashboard e query", () => {
  it("aceita queries sem usuários e rejeita o campo userIds", () => {
    expect(queryInputSchema.parse(queryInput)).toEqual(queryInput);
    expect(
      queryInputSchema.safeParse({ ...queryInput, userIds: [] }).success,
    ).toBe(false);
  });

  it("exige recibo para salvar e vínculo de query para prévia de edição", () => {
    expect(queryCreateInputSchema.safeParse(queryInput).success).toBe(false);
    expect(queryUpdateInputSchema.safeParse(queryInput).success).toBe(false);
    expect(queryPreviewInputSchema.safeParse({
      dataSourceId: queryInput.dataSourceId,
      sqlText: queryInput.sqlText,
      parameters: [],
      mode: "update",
      queryId: "00000000-0000-4000-8000-000000000002",
    }).success).toBe(false);
    expect(queryPreviewInputSchema.safeParse({
      dataSourceId: queryInput.dataSourceId,
      sqlText: queryInput.sqlText,
      parameters: [],
      mode: "update",
      queryId: "00000000-0000-4000-8000-000000000002",
      expectedUpdatedAt: "2026-09-29T12:00:00.000Z",
    }).success).toBe(true);
    expect(queryPreviewInputSchema.safeParse({
      dataSourceId: queryInput.dataSourceId,
      sqlText: queryInput.sqlText,
      parameters: [],
      mode: "create",
      queryId: "00000000-0000-4000-8000-000000000002",
    }).success).toBe(false);
  });

  it("limita os valores de teste que são devolvidos na prévia", () => {
    expect(queryPreviewInputSchema.safeParse({
      dataSourceId: queryInput.dataSourceId,
      sqlText: queryInput.sqlText,
      parameters: [],
      mode: "create",
      values: { filtro: "x".repeat(2_049) },
    }).success).toBe(false);
  });

  it("cria documentos vazios de dashboard a partir de nome e descrição", () => {
    expect(
      dashboardCreateSchema.parse({
        name: "Resumo",
        description: "Indicadores mensais",
      }),
    ).toEqual({
      name: "Resumo",
      description: "Indicadores mensais",
    });
    expect(
      dashboardCreateSchema.safeParse({
        name: "Resumo",
        id: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);

    const dashboard = dashboardDocumentSchema.parse({
      id: "00000000-0000-4000-8000-000000000002",
      name: "Resumo",
    });
    expect(dashboard.workspace.params).toEqual([]);
    expect(dashboard.queryBindings).toEqual([]);
    expect(dashboard.ui.components).toEqual([]);
  });
});
